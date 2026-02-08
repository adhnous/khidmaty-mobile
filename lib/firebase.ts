import { initializeApp, getApp, getApps, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FirebaseAuth from "firebase/auth";
import { type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";

type FirebaseClient = { app: FirebaseApp; db: Firestore; auth: Auth; functions: Functions };

let cached: FirebaseClient | null = null;
let warnedMissingConfig = false;

function cleanEnv(v: unknown): string {
  let s = typeof v === "string" ? v.trim() : "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
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
        `Firebase client config missing (${missing.join(", ")}). Run: npm run env:sync (or fill .env from .env.example).`,
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

  // React Native needs explicit persistence setup.
  // On web we can rely on the default Auth initialization.
  const auth =
    Platform.OS === "web"
      ? FirebaseAuth.getAuth(app)
      : (() => {
          const anyAuth = FirebaseAuth as any;
          try {
            const getReactNativePersistence =
              typeof anyAuth.getReactNativePersistence === "function" ? anyAuth.getReactNativePersistence : null;
            if (getReactNativePersistence) {
              return FirebaseAuth.initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
            }
          } catch {
            // ignore
          }
          return FirebaseAuth.getAuth(app);
        })();
  const functions = getFunctions(app);

  cached = { app, db, auth, functions };
  return cached;
}

export function getFirestoreDb(): Firestore | null {
  return getFirebaseClient()?.db ?? null;
}

export function getFirebaseAuth(): Auth | null {
  return getFirebaseClient()?.auth ?? null;
}

export function getFirebaseFunctions(): Functions | null {
  return getFirebaseClient()?.functions ?? null;
}

