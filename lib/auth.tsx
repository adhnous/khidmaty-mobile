import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { User } from "firebase/auth";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { apiPost } from "./api";
import { getFirebaseAuth, getFirestoreDb } from "./firebase";
import { normalizeEmail } from "./identifiers";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  authError: string | null;
  clearAuthError: () => void;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string, phone?: string | null) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isIgnorableWebRedirectError(code: string): boolean {
  return code === "auth/no-auth-event" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

function getExpoProjectFullName(): string | null {
  const anyConstants = Constants as any;
  const originalFullName = cleanString(anyConstants?.expoConfig?.originalFullName);
  if (originalFullName) return originalFullName;

  const owner = cleanString(anyConstants?.expoConfig?.owner);
  const slug = cleanString(anyConstants?.expoConfig?.slug);
  if (owner && slug) return `@${owner}/${slug}`;

  return null;
}

function getExpoAuthProxyBaseUrl(): string | null {
  const fullName = getExpoProjectFullName();
  if (!fullName) return null;
  return `https://auth.expo.io/${fullName}`;
}

async function signInWithGoogleViaExpoProxy(): Promise<{ idToken: string; accessToken?: string }> {
  const clientId = cleanString(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID);
  if (!clientId) throw new Error("Google Sign-In not configured (missing EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID).");

  const proxyBaseUrl = getExpoAuthProxyBaseUrl();
  if (!proxyBaseUrl) {
    throw new Error("Cannot determine Expo project name for AuthSession proxy (missing expoConfig.originalFullName).");
  }

  const returnUrl = AuthSession.getDefaultReturnUrl();
  if (!returnUrl) throw new Error("missing_return_url");

  const discovery = {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
  };

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri: proxyBaseUrl,
    responseType: AuthSession.ResponseType.Code,
    prompt: AuthSession.Prompt.SelectAccount,
    scopes: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });

  await request.makeAuthUrlAsync(discovery);
  const authUrl = request.url;
  if (!authUrl) throw new Error("missing_auth_url");

  const startUrl = `${proxyBaseUrl}/start?authUrl=${encodeURIComponent(authUrl)}&returnUrl=${encodeURIComponent(returnUrl)}`;
  const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
  if (result.type !== "success") throw new Error(result.type);

  const parsed = request.parseReturnUrl(result.url);
  if (parsed.type !== "success") {
    const maybeError = "error" in parsed ? parsed.error : null;
    const maybeErrorCode = "errorCode" in parsed ? parsed.errorCode : null;
    const msg =
      (maybeError && typeof maybeError.message === "string" && maybeError.message) ||
      (typeof maybeErrorCode === "string" && maybeErrorCode) ||
      "Google Sign-In failed.";
    throw new Error(msg);
  }

  const code = typeof parsed.params.code === "string" ? parsed.params.code : "";
  if (!code) throw new Error("missing_auth_code");

  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code,
      redirectUri: proxyBaseUrl,
      extraParams: { code_verifier: request.codeVerifier || "" },
    },
    { tokenEndpoint: discovery.tokenEndpoint },
  );

  const idToken = cleanString(tokenResponse.idToken);
  if (!idToken) throw new Error("missing_google_id_token");
  const accessToken = cleanString(tokenResponse.accessToken);
  return { idToken, accessToken: accessToken || undefined };
}

async function createUserDoc(uid: string, input: { email: string }) {
  const db = getFirestoreDb();
  if (!db) throw new Error("missing_firestore");
  await setDoc(
    doc(db, "users", uid),
    {
      email: normalizeEmail(input.email),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function touchUserDoc(uid: string, input: { email: string }) {
  const db = getFirestoreDb();
  if (!db) throw new Error("missing_firestore");
  await setDoc(
    doc(db, "users", uid),
    {
      email: normalizeEmail(input.email),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setInitializing(false);
      return;
    }

    if (Platform.OS === "web") {
      void getRedirectResult(auth)
        .then((cred) => {
          const em = cleanString(cred?.user?.email);
          if (cred?.user?.uid && em) return touchUserDoc(cred.user.uid, { email: em });
          return;
        })
        .catch((err: any) => {
          const code = cleanString(err?.code);
          const message = cleanString(err?.message);
          console.warn("[auth] getRedirectResult failed", { code, message });
          if (isIgnorableWebRedirectError(code)) return;
          setAuthError(code ? `${code}${message ? `: ${message}` : ""}` : message || "Google Sign-In failed.");
        });
    }

    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next);
      if (next?.uid) setAuthError(null);
      setInitializing(false);
    });
    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      initializing,
      authError,
      clearAuthError: () => setAuthError(null),
      login: async (email, password) => {
        const auth = getFirebaseAuth();
        if (!auth) throw new Error("missing_auth");
        const em = normalizeEmail(email);
        await signInWithEmailAndPassword(auth, em, String(password || ""));
        if (auth.currentUser?.uid) {
          await touchUserDoc(auth.currentUser.uid, { email: em }).catch(() => null);
        }
      },
      loginWithGoogle: async () => {
        const auth = getFirebaseAuth();
        if (!auth) throw new Error("missing_auth");
        setAuthError(null);

        // On web, use popup flow.
        // Redirect fallback caused loop-like behavior on some browsers when callback params were altered.
        if (Platform.OS === "web") {
          const provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          try {
            const userCred = await signInWithPopup(auth, provider);
            const em = cleanString(userCred.user.email);
            if (userCred.user.uid && em) await touchUserDoc(userCred.user.uid, { email: em }).catch(() => null);
            return;
          } catch (err: any) {
            const code = cleanString(err?.code);
            if (code === "auth/popup-blocked") throw new Error("Google popup was blocked. Allow popups for this site and try again.");
            throw err;
          }
        }

        // Native: use Expo auth session.
        {
          const { idToken, accessToken } = await signInWithGoogleViaExpoProxy();
          const firebaseCred = GoogleAuthProvider.credential(idToken, accessToken);
          const userCred = await signInWithCredential(auth, firebaseCred);
          const em = cleanString(userCred.user.email);
          if (userCred.user.uid && em) await touchUserDoc(userCred.user.uid, { email: em }).catch(() => null);
          return;
        }
      },
      register: async (email, password, phone) => {
        const auth = getFirebaseAuth();
        if (!auth) throw new Error("missing_auth");
        const em = normalizeEmail(email);
        const cred = await createUserWithEmailAndPassword(auth, em, String(password || ""));
        try {
          await createUserDoc(cred.user.uid, { email: em });
        } catch (e) {
          // Avoid leaving an Auth user without a matching profile doc (needed for trusted lookup).
          try {
            await cred.user.delete();
          } catch {
            // ignore
          }
          throw e;
        }

        const phoneNormalized = typeof phone === "string" && phone.trim() ? phone.trim() : "";
        if (phoneNormalized) {
          try {
            const idToken = await cred.user.getIdToken();
            await apiPost("/api/sos/set-phone", { phone: phoneNormalized }, { headers: { Authorization: `Bearer ${idToken}` } });
          } catch {
            // Best-effort: phone lookup is optional for MVP; user can still be found by email.
          }
        }
      },
      logout: async () => {
        const auth = getFirebaseAuth();
        if (!auth) return;
        setAuthError(null);
        await signOut(auth);
      },
    };
  }, [authError, initializing, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
