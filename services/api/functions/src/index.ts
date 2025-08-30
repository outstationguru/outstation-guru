import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { z } from "zod";

/** ---- Cloud setup (no emulator) ---- */
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  "og-guru-dev";

try { admin.app(); } catch { admin.initializeApp({ projectId: PROJECT_ID }); }

const db = admin.firestore();
const auth = admin.auth();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/** ---------- Helpers ---------- */
async function nextSeq(name: string): Promise<number> {
  const ref = db.collection("counters").doc(name);
  return await db.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    const cur = (snap.exists && (snap.get("value") as number)) || 0;
    const nxt = cur + 1;
    trx.set(ref, { value: nxt }, { merge: true });
    return nxt;
  });
}

function rolePrefix(role: string): string {
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
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "api",
    ts: new Date().toISOString(),
    projectId: PROJECT_ID
  });
});

/** ---------- Endpoints ---------- */

const ensureUserBody = z.object({
  phone: z.string().optional(),
  role: z.enum(["customer", "driver", "partner", "admin", "ops"]).default("customer"),
  displayName: z.string().optional()
});

app.post("/api/v1/auth/ensureUser", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ensureUserBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    const { phone, role, displayName } = parsed.data;

    let uid: string | null = null;

    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.slice(7);
      try {
        const decoded = await auth.verifyIdToken(idToken, true);
        uid = decoded.uid;
      } catch { /* ignore */ }
    }

    if (!uid && phone) {
      const normalized = phone.replace(/\s+/g, "");
      const existing = await auth.getUserByPhoneNumber(normalized).catch(() => null);
      uid = existing ? existing.uid : (await auth.createUser({ phoneNumber: normalized, displayName })).uid;
    }

    if (!uid) return res.status(401).json({ ok: false, error: "No auth token and no phone provided." });

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    let assignedId: string | null = (snap.exists && (snap.get("ids") as any)?.[role]) || null;
    const roles: Record<string, boolean> = (snap.exists && (snap.get("roles") as any)) || {};
    const profile: any = (snap.exists && (snap.get("profile") as any)) || {};

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
        ...((snap.exists && (snap.get("ids") as Record<string, string>)) || {}),
        [role]: assignedId
      },
      profile,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: snap.exists ? snap.get("createdAt") : FieldValue.serverTimestamp()
    }, { merge: true });

    try {
      const existingClaims = (await auth.getUser(uid)).customClaims || {};
      await auth.setCustomUserClaims(uid, { ...existingClaims, [role]: true });
    } catch { /* ok */ }

    res.json({ ok: true, uid, role, id: assignedId });
  } catch (err) {
    next(err);
  }
});

const quoteBody = z.object({
  origin: z.string(),
  destination: z.string(),
  km: z.number().positive().optional(),
  vehicleType: z.enum(["sedan", "suv", "tempo"]).default("sedan"),
  waypoints: z.array(z.string()).optional()
});

app.post("/api/v1/fares/quote", (req: Request, res: Response) => {
  const parsed = quoteBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const { km = 100, vehicleType } = parsed.data;

  const rates = {
    sedan: { base: 250, perKm: 12 },
    suv: { base: 350, perKm: 15 },
    tempo: { base: 500, perKm: 20 }
  } as const;

  const r = rates[vehicleType];
  const distanceFare = km * r.perKm;
  const subtotal = r.base + distanceFare;
  const taxes = Math.round(subtotal * 0.05);
  const total = subtotal + taxes;

  res.json({ ok: true, currency: "INR", vehicleType, breakdown: { base: r.base, perKm: r.perKm, km, distanceFare, taxes }, total });
});

const createDraftBody = z.object({
  customerUid: z.string().optional(),
  pickup: z.string(),
  drop: z.string(),
  when: z.string(),
  vehicleType: z.enum(["sedan", "suv", "tempo"]).default("sedan"),
  quoteTotal: z.number().positive().optional()
});

app.post("/api/v1/rides/createDraft", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createDraftBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    await rideRef.set(ride);
    res.json({ ok: true, rideId: rideRef.id, status: "draft" });
  } catch (err) {
    next(err);
  }
});

/** Error handler */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("API ERROR", err);
  res.status(500).json({ ok: false, error: String(err && err.message || err) });
});

export const api = onRequest({ region: "us-central1" }, app);
