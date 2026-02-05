import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { apiPost } from "./api";
import { getFirebaseAuth, getFirestoreDb } from "./firebase";
import { normalizeEmail } from "./identifiers";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, phone?: string | null) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setInitializing(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setInitializing(false);
    });
    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      initializing,
      login: async (email, password) => {
        const auth = getFirebaseAuth();
        if (!auth) throw new Error("missing_auth");
        const em = normalizeEmail(email);
        await signInWithEmailAndPassword(auth, em, String(password || ""));
        if (auth.currentUser?.uid) {
          await touchUserDoc(auth.currentUser.uid, { email: em }).catch(() => null);
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
        await signOut(auth);
      },
    };
  }, [initializing, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
