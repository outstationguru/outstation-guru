"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const zod_1 = require("zod");
/** ---- Cloud setup (no emulator) ---- */
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    "og-guru-dev";
try {
    admin.app();
}
catch {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const auth = admin.auth();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json());
/** ---------- Helpers ---------- */
async function nextSeq(name) {
    const ref = db.collection("counters").doc(name);
    return await db.runTransaction(async (trx) => {
        const snap = await trx.get(ref);
        const cur = (snap.exists && snap.get("value")) || 0;
        const nxt = cur + 1;
        trx.set(ref, { value: nxt }, { merge: true });
        return nxt;
    });
}
function rolePrefix(role) {
    switch (role) {
        case "customer": return "OGC";
        case "driver": return "OGD";
        case "partner": return "OGP";
        case "admin": return "OGA";
        case "ops": return "OGO";
        default: return "OGX";
    }
}
/** ---------- Health ---------- */
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "api",
        ts: new Date().toISOString(),
        projectId: PROJECT_ID
    });
});
/** ---------- Endpoints ---------- */
const ensureUserBody = zod_1.z.object({
    phone: zod_1.z.string().optional(),
    role: zod_1.z.enum(["customer", "driver", "partner", "admin", "ops"]).default("customer"),
    displayName: zod_1.z.string().optional()
});
app.post("/api/v1/auth/ensureUser", async (req, res, next) => {
    try {
        const parsed = ensureUserBody.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, error: parsed.error.flatten() });
        const { phone, role, displayName } = parsed.data;
        let uid = null;
        const authHeader = req.headers.authorization || "";
        if (authHeader.startsWith("Bearer ")) {
            const idToken = authHeader.slice(7);
            try {
                const decoded = await auth.verifyIdToken(idToken, true);
                uid = decoded.uid;
            }
            catch { /* ignore */ }
        }
        if (!uid && phone) {
            const normalized = phone.replace(/\s+/g, "");
            const existing = await auth.getUserByPhoneNumber(normalized).catch(() => null);
            uid = existing ? existing.uid : (await auth.createUser({ phoneNumber: normalized, displayName })).uid;
        }
        if (!uid)
            return res.status(401).json({ ok: false, error: "No auth token and no phone provided." });
        const userRef = db.collection("users").doc(uid);
        const snap = await userRef.get();
        let assignedId = (snap.exists && snap.get("ids")?.[role]) || null;
        const roles = (snap.exists && snap.get("roles")) || {};
        const profile = (snap.exists && snap.get("profile")) || {};
        if (!assignedId) {
            const seq = await nextSeq(role);
            assignedId = `${rolePrefix(role)}${String(seq).padStart(6, "0")}`;
        }
        roles[role] = true;
        profile.displayName = displayName || profile.displayName || null;
        await userRef.set({
            uid,
            roles,
            ids: {
                ...((snap.exists && snap.get("ids")) || {}),
                [role]: assignedId
            },
            profile,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            createdAt: snap.exists ? snap.get("createdAt") : firestore_1.FieldValue.serverTimestamp()
        }, { merge: true });
        try {
            const existingClaims = (await auth.getUser(uid)).customClaims || {};
            await auth.setCustomUserClaims(uid, { ...existingClaims, [role]: true });
        }
        catch { /* ok */ }
        res.json({ ok: true, uid, role, id: assignedId });
    }
    catch (err) {
        next(err);
    }
});
const quoteBody = zod_1.z.object({
    origin: zod_1.z.string(),
    destination: zod_1.z.string(),
    km: zod_1.z.number().positive().optional(),
    vehicleType: zod_1.z.enum(["sedan", "suv", "tempo"]).default("sedan"),
    waypoints: zod_1.z.array(zod_1.z.string()).optional()
});
app.post("/api/v1/fares/quote", (req, res) => {
    const parsed = quoteBody.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    const { km = 100, vehicleType } = parsed.data;
    const rates = {
        sedan: { base: 250, perKm: 12 },
        suv: { base: 350, perKm: 15 },
        tempo: { base: 500, perKm: 20 }
    };
    const r = rates[vehicleType];
    const distanceFare = km * r.perKm;
    const subtotal = r.base + distanceFare;
    const taxes = Math.round(subtotal * 0.05);
    const total = subtotal + taxes;
    res.json({ ok: true, currency: "INR", vehicleType, breakdown: { base: r.base, perKm: r.perKm, km, distanceFare, taxes }, total });
});
const createDraftBody = zod_1.z.object({
    customerUid: zod_1.z.string().optional(),
    pickup: zod_1.z.string(),
    drop: zod_1.z.string(),
    when: zod_1.z.string(),
    vehicleType: zod_1.z.enum(["sedan", "suv", "tempo"]).default("sedan"),
    quoteTotal: zod_1.z.number().positive().optional()
});
app.post("/api/v1/rides/createDraft", async (req, res, next) => {
    try {
        const parsed = createDraftBody.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, error: parsed.error.flatten() });
        const { customerUid, pickup, drop, when, vehicleType, quoteTotal } = parsed.data;
        const rideRef = db.collection("rides").doc();
        const ride = {
            status: "draft",
            pickup,
            drop,
            when,
            vehicleType,
            quoteTotal: quoteTotal || null,
            customerUid: customerUid || null,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp()
        };
        await rideRef.set(ride);
        res.json({ ok: true, rideId: rideRef.id, status: "draft" });
    }
    catch (err) {
        next(err);
    }
});
/** Error handler */
app.use((err, _req, res, _next) => {
    console.error("API ERROR", err);
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
});
exports.api = (0, https_1.onRequest)({ region: "us-central1" }, app);
