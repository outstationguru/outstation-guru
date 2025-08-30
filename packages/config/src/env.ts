export type OgEnv = "dev" | "stage" | "prod";

/** Select environment from process env (works in Node, Next.js, and RN via babel/metro env) */
export const OG_ENV: OgEnv = (process.env.OG_ENV as OgEnv) || "dev";

/** App identifiers per platform */
export const appIds = {
  customer: {
    android: "com.outstationguru.customer",
    ios: "com.outstationguru.customer",
  },
  driver: {
    android: "com.outstationguru.driver",
    ios: "com.outstationguru.driver",
  },
  partner: {
    android: "com.outstationguru.partner",
    ios: "com.outstationguru.partner",
  },
  admin: {
    web: "admin.outstation.guru"
  }
} as const;

/** Firebase project configs (keys are placeholders for now) */
const firebaseByEnv = {
  dev: {
    projectId: "demo-outstation-guru",        // Emulators
    apiKey: "fake-dev-key",
    authDomain: "localhost",
  },
  stage: {
    projectId: "outstation-guru-stage",
    apiKey: "stage-api-key",
    authDomain: "stage.outstation.guru",
  },
  prod: {
    projectId: "outstation-guru-prod",
    apiKey: "prod-api-key",
    authDomain: "outstation.guru",
  }
} as const;

/** Firebase client options for apps */
export const firebaseClient = firebaseByEnv[OG_ENV];

/** Emulator helpers for dev (used by RN apps & Node) */
export const emulator = {
  enabled: OG_ENV === "dev",
  firestoreHost: "127.0.0.1:8080",
  authHost: "127.0.0.1:9099",
  functionsHost: "127.0.0.1:5001"
};

/** Resolve Functions base URL for client apps */
export function functionsBaseUrl(projectId = firebaseClient.projectId) {
  if (OG_ENV === "dev") {
    // When using ADB reverse on device, 127.0.0.1 maps back to host
    return `http://127.0.0.1:5001/${projectId}/us-central1`;
  }
  // For stage/prod, use HTTPS callable or hosted API domain (to be set later)
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

/** Small guard for places where we need stage/prod branching later */
export const isProd = OG_ENV === "prod";
export const isStage = OG_ENV === "stage";
export const isDev = OG_ENV === "dev";
