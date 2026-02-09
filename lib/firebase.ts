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
let warnedSuspiciousConfig = false;

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanEnv(v: unknown): string {
  let s = cleanString(v);
  if (!s) return "";
  // Some platforms/tools store newlines as literal escape sequences.
  // Normalize them so `trim()` removes them.
  s = s.replace(/\\r/g, "\r").replace(/\\n/g, "\n").trim();
  const lower = s.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\\r/g, "\r").replace(/\\n/g, "\n").trim();
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

  if (!warnedSuspiciousConfig) {
    const suspicious: string[] = [];

    // Default Firebase web config patterns.
    if (authDomain.endsWith(".firebaseapp.com") && !authDomain.startsWith(`${projectId}.`)) {
      suspicious.push(`authDomain (${authDomain}) doesn't match projectId (${projectId})`);
    }
    if (
      (storageBucket.endsWith(".appspot.com") || storageBucket.endsWith(".firebasestorage.app")) &&
      !storageBucket.startsWith(`${projectId}.`)
    ) {
      suspicious.push(`storageBucket (${storageBucket}) doesn't match projectId (${projectId})`);
    }

    // appId includes the project number (same as messagingSenderId).
    const m = appId.match(/^1:(\d+):/);
    const appProjectNumber = m?.[1] ?? "";
    if (appProjectNumber && appProjectNumber !== messagingSenderId) {
      suspicious.push("messagingSenderId doesn't match appId project number");
    }

    if (suspicious.length > 0) {
      warnedSuspiciousConfig = true;
      console.warn(
        `Firebase client config looks inconsistent. Double-check you pasted the *Web app* config from the same Firebase project:\n- ${suspicious.join(
          "\n- ",
        )}`,
      );
    }
  }

  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

function getFirebaseClientAuth(app: FirebaseApp): Auth {
  if (Platform.OS === "web") return FirebaseAuth.getAuth(app);

  const anyAuth = FirebaseAuth as any;
  const getReactNativePersistence =
    typeof anyAuth.getReactNativePersistence === "function" ? anyAuth.getReactNativePersistence : null;

  if (!getReactNativePersistence) {
    return FirebaseAuth.getAuth(app);
  }

  try {
    return FirebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (e) {
    const msg = cleanString((e as any)?.message);

    // Can happen during fast refresh / repeated initialization attempts.
    if (msg.includes("already-initialized")) return FirebaseAuth.getAuth(app);

    // This usually means Metro bundled multiple copies of @firebase/app.
    if (msg.includes("Component auth has not been registered yet")) {
      console.warn(
        "Firebase Auth init failed (Component auth not registered). If you just added metro.config.js, restart Metro with: npx expo start -c",
      );
    }

    console.warn("Firebase Auth init failed; falling back to getAuth().", msg || e);
    return FirebaseAuth.getAuth(app);
  }
}

export function getFirebaseClient(): FirebaseClient | null {
  if (cached) return cached;
  const opts = getFirebaseOptions();
  if (!opts) return null;

  const app = getApps().length ? getApp() : initializeApp(opts);
  const db = getFirestore(app);

  // React Native needs explicit persistence setup.
  // On web we can rely on the default Auth initialization.
  const auth = getFirebaseClientAuth(app);
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

