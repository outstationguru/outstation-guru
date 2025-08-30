type RequiredEnv = {
  FIREBASE_PROJECT_ID: string;
};

export function getEnv(): RequiredEnv {
  const env = {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "demo-outstation-guru"
  };
  return env;
}