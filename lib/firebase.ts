import { initializeApp, getApp, getApps, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

type FirebaseClient = { app: FirebaseApp; db: Firestore };

let cached: FirebaseClient | null = null;
let warnedMissingConfig = false;

function cleanEnv(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function getFirebaseOptions(): FirebaseOptions | null {
  const apiKey = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  const authDomain = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN);
  const projectId = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const storageBucket = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const messagingSenderId = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID);
  const appId = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_APP_ID);

  const missing: string[] = [];
  if (!apiKey) missing.push("EXPO_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missing.push("EXPO_PUBLIC_FIREBASE_PROJECT_ID");
  if (!storageBucket) missing.push("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!messagingSenderId) missing.push("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  if (!appId) missing.push("EXPO_PUBLIC_FIREBASE_APP_ID");

  if (missing.length > 0) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        `Firebase client config missing (${missing.join(", ")}). Run: npm run env:sync (or fill khidmaty-mobile/.env).`,
      );
    }
    return null;
  }

  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

export function getFirebaseClient(): FirebaseClient | null {
  if (cached) return cached;
  const opts = getFirebaseOptions();
  if (!opts) return null;

  const app = getApps().length ? getApp() : initializeApp(opts);
  const db = getFirestore(app);

  cached = { app, db };
  return cached;
}

export function getFirestoreDb(): Firestore | null {
  return getFirebaseClient()?.db ?? null;
}

