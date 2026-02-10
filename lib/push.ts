import Constants from "expo-constants";
import { Platform } from "react-native";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebaseClient, getFirestoreDb } from "./firebase";
import { isIOSWeb, isStandalonePWA } from "./pwa";
import { ensureDeviceId } from "./storage";

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanKey(v: unknown): string {
  // Keys should never contain whitespace, but copy/paste can introduce it.
  return cleanString(v).replace(/\\r/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa exists on web; this code path is only used on web.
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecodeToBytes(base64Url: string): Uint8Array {
  const s = cleanKey(base64Url);
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getPushSubscriptionKey(sub: any, name: "auth" | "p256dh"): string {
  try {
    const buf = sub?.getKey?.(name);
    if (!buf) return "";
    return base64UrlEncodeBytes(new Uint8Array(buf));
  } catch {
    return "";
  }
}

async function manualFcmRegistration(input: { app: any; swReg: any; vapidKey: string }): Promise<string> {
  const projectId = cleanString(input?.app?.options?.projectId);
  const apiKey = cleanString(input?.app?.options?.apiKey);
  if (!projectId || !apiKey) throw new Error("missing_firebase_web_config");

  let sub = null as any;
  try {
    sub = await input?.swReg?.pushManager?.getSubscription?.();
  } catch {
    sub = null;
  }
  if (!sub) {
    try {
      const keyBytes = base64UrlDecodeToBytes(input.vapidKey);
      sub = await input?.swReg?.pushManager?.subscribe?.({ userVisibleOnly: true, applicationServerKey: keyBytes });
    } catch {
      sub = null;
    }
  }
  if (!sub) throw new Error("missing_push_subscription");

  const endpoint = cleanString(sub?.endpoint);
  const auth = getPushSubscriptionKey(sub, "auth");
  const p256dh = getPushSubscriptionKey(sub, "p256dh");
  if (!endpoint || !auth || !p256dh) throw new Error("missing_push_subscription_keys");

  const body: any = { web: { endpoint, auth, p256dh } };
  const vapidKey = cleanKey(input.vapidKey);
  if (vapidKey) body.web.applicationPubKey = vapidKey;

  const inst = await import("firebase/installations");
  const installations = inst.getInstallations(input.app);
  const fisToken = cleanString(await inst.getToken(installations, true));
  if (!fisToken) throw new Error("missing_firebase_installations_auth_token");

  const url = `https://fcmregistrations.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/registrations`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-firebase-installations-auth": `FIS ${fisToken}`,
    },
    body: JSON.stringify(body),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  const token = cleanString(json?.token);
  if (res.ok && token) return token;

  const msg = cleanString(json?.error?.message) || `HTTP ${res.status}`;
  const err: any = new Error(`manual_fcmregistrations_failed: ${msg}`);
  err.status = res.status;
  err.serverResponse = json;
  throw err;
}

function isFcmRegistrationsAuthError(err: any): boolean {
  const code = cleanString(err?.code).toLowerCase();
  const msg = cleanString(err?.message).toLowerCase();
  const serverResponse = cleanString(err?.customData?.serverResponse).toLowerCase();

  if (code && !code.includes("token-subscribe-failed")) return false;

  const hay = `${msg} ${serverResponse}`;
  return hay.includes("missing required authentication credential") || hay.includes("unauthenticated");
}

function isTokenUnsubscribeRecoverableError(err: any): boolean {
  const code = cleanString(err?.code).toLowerCase();
  const msg = cleanString(err?.message).toLowerCase();
  const serverResponse = cleanString(err?.customData?.serverResponse).toLowerCase();
  const hay = `${msg} ${serverResponse}`;
  return code.includes("token-unsubscribe-failed") || hay.includes("unsubscribing the user from fcm");
}

function deleteIndexedDbDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve();
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearFirebaseWebStateCaches() {
  await Promise.allSettled([
    deleteIndexedDbDatabase("firebase-messaging-database"),
    deleteIndexedDbDatabase("firebase-installations-database"),
    deleteIndexedDbDatabase("fcm_token_details_db"),
    deleteIndexedDbDatabase("fcm_vapid_details_db"),
  ]);
}

async function repairWebPushState(input: { app: any; messaging: any; swReg: any }) {
  // Best-effort cleanup. This targets the most common cause of the confusing
  // fcmregistrations 401: a corrupted/blocked Firebase Installation state in the browser.
  try {
    const sub = await input?.swReg?.pushManager?.getSubscription?.();
    await sub?.unsubscribe?.();
  } catch {
    // ignore
  }

  try {
    const inst = await import("firebase/installations");
    await inst.deleteInstallations(inst.getInstallations(input.app));
  } catch {
    // ignore
  }

  // Avoid calling deleteToken() here; stale server tokens can trigger noisy 400s.
  // Clearing local IndexedDB caches is enough for a clean re-register attempt.
  await clearFirebaseWebStateCaches();
}

let webOnMessageAttached = false;

async function attachWebOnMessageListener(input: { messaging: any; swReg: any }) {
  if (webOnMessageAttached) return;
  webOnMessageAttached = true;

  try {
    const mod = await import("firebase/messaging");
    mod.onMessage(input.messaging, (payload: any) => {
      const data = (payload?.data ?? {}) as any;
      const title = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : "🚨 SOS Alert";
      const body = typeof data?.body === "string" && data.body.trim() ? data.body.trim() : "Tap to view location";
      const type = typeof data?.type === "string" ? data.type : "sos";
      const eventId = typeof data?.eventId === "string" ? data.eventId.trim() : "";

      try {
        if (typeof input?.swReg?.showNotification === "function") {
          void input.swReg.showNotification(title, {
            body,
            data: { type, eventId },
            requireInteraction: true,
          });
          return;
        }
      } catch {
        // ignore
      }

      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const n = new Notification(title, { body, data: { type, eventId } } as any);
          n.onclick = () => {
            try {
              window.focus();
            } catch {
              // ignore
            }
            const url = eventId ? `/?sosEventId=${encodeURIComponent(eventId)}` : "/";
            window.location.assign(url);
          };
        }
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

function describeWebTokenError(err: any, ctx: { origin?: string; projectId?: string } = {}): string {
  const code = cleanString(err?.code);
  const msg = cleanString(err?.message);
  const serverResponse = cleanString(err?.customData?.serverResponse);

  const base = msg || serverResponse || "Could not get web push token.";
  const lower = `${code} ${base} ${serverResponse}`.toLowerCase();

  // Common (and confusing) auth error from the FCM registrations API.
  if (lower.includes("missing required authentication credential") || lower.includes("unauthenticated")) {
    const origin = cleanString(ctx.origin);
    const originHint = origin ? ` Current origin: ${origin}.` : "";
    const pid = cleanString(ctx.projectId);
    const pidHint = pid ? ` Firebase projectId: ${pid}.` : "";
    return (
      `${base} Verify your Firebase Web config (apiKey/appId/projectId) and VAPID key are from the same Firebase project, ` +
      `and that the Web API key isn't restricted (HTTP referrers / API restrictions). Then redeploy and clear site data.` +
      `${originHint}${pidHint}${code ? ` (${code})` : ""}`
    );
  }

  // Keep a single, user-friendly message for common Firebase Messaging failures.
  if (
    code === "messaging/token-subscribe-failed" ||
    lower.includes("fcmregistrations") ||
    lower.includes("token-subscribe-failed")
  ) {
    const origin = cleanString(ctx.origin);
    const originHint = origin ? ` (origin: ${origin})` : "";
    return (
      "Could not get web push token. Firebase rejected the subscription request. " +
      "Check that Firebase Installations API + Firebase Cloud Messaging API are enabled, " +
      "and that your Firebase Web API key is allowed for this domain." +
      originHint +
      (code ? ` (${code})` : "")
    );
  }

  return code ? `${base} (${code})` : base;
}

async function registerWebForPush(uid: string): Promise<{ webPushToken?: string }> {
  if (!uid) throw new Error("missing_uid");
  if (Platform.OS !== "web") return {};
  if (typeof window === "undefined") return {};

  const client = getFirebaseClient();
  if (!client) return {};

  let vapidKey = cleanKey(process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY);
  if ((vapidKey.startsWith('"') && vapidKey.endsWith('"')) || (vapidKey.startsWith("'") && vapidKey.endsWith("'"))) {
    vapidKey = cleanKey(vapidKey.slice(1, -1));
  }
  if (!vapidKey) throw new Error("Web push disabled: missing EXPO_PUBLIC_FIREBASE_VAPID_KEY.");

  if (!("Notification" in window)) throw new Error("Notifications are not supported in this browser.");
  if (!("serviceWorker" in navigator)) throw new Error("Service Workers are not supported in this browser.");

  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]";
  const isSecureContext = typeof window.isSecureContext === "boolean" ? window.isSecureContext : window.location.protocol === "https:";
  if (!isSecureContext && !isLocalhost) {
    throw new Error("Web push requires HTTPS (secure context).");
  }

  // iOS web push is only meaningful in standalone "Add to Home Screen" PWAs.
  // In a normal Safari tab, avoid prompting since it won't work reliably.
  if (isIOSWeb() && !isStandalonePWA()) {
    throw new Error("On iPhone, install to Home Screen (PWA) to enable SOS alerts.");
  }

  // Permission prompt must be triggered by a user gesture.
  // Call requestPermission before any awaits (like dynamic imports) to avoid browsers blocking it.
  let permission: NotificationPermission = "default";
  try {
    permission = Notification.permission;
  } catch {
    // ignore
  }
  if (permission === "denied") {
    throw new Error("Notifications are blocked for this site. Enable them in browser settings and try again.");
  }
  if (permission !== "granted") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      throw new Error("Could not request notification permission.");
    }
  }
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  let supported = true;
  try {
    const mod = await import("firebase/messaging");
    if (typeof mod.isSupported === "function") supported = await mod.isSupported();
  } catch {
    supported = false;
  }
  if (!supported) throw new Error("Web push is not supported in this browser.");

  let swReg: any = null;
  try {
    swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  } catch {
    throw new Error("Could not register service worker for web push.");
  }

  try {
    const ready = await navigator.serviceWorker.ready;
    if (ready) swReg = ready;
  } catch {
    // ignore; continue with registration returned above
  }

  let token = "";
  let messaging: any = null;
  try {
    const mod = await import("firebase/messaging");
    messaging = mod.getMessaging(client.app);
    const opts: any = { serviceWorkerRegistration: swReg };

    const getTokenOnce = async () => {
      // Prefer a project-specific VAPID key when provided, but allow fallback to
      // Firebase's default key (helps debug misconfigured keys / copy issues).
      if (vapidKey) {
        try {
          return cleanString(await mod.getToken(messaging, { ...opts, vapidKey }));
        } catch (err: any) {
          try {
            const t = cleanString(await mod.getToken(messaging, opts));
            console.warn("[push] Web push token: custom VAPID key failed; fell back to default.", {
              code: cleanString(err?.code),
              msg: cleanString(err?.message),
            });
            return t;
          } catch {
            throw err;
          }
        }
      }
      return cleanString(await mod.getToken(messaging, opts));
    };

    // Prefer a project-specific VAPID key when provided, but allow fallback to
    // Firebase's default key (helps debug misconfigured keys / copy issues).
    try {
      token = await getTokenOnce();
    } catch (err: any) {
      const recoverableAuth = isFcmRegistrationsAuthError(err);
      const recoverableUnsubscribe = isTokenUnsubscribeRecoverableError(err);
      if (!recoverableAuth && !recoverableUnsubscribe) throw err;

      // If fcmregistrations rejects the request with a 401, try resetting the local
      // Firebase Installation + push subscription state and retry once.
      console.warn("[push] Web push token: repairing local state and retrying once.", {
        reason: recoverableAuth ? "fcmregistrations_unauthenticated" : "token_unsubscribe_failed",
        code: cleanString(err?.code),
        msg: cleanString(err?.message),
      });
      await repairWebPushState({ app: client.app, messaging, swReg });

      try {
        token = await getTokenOnce();
      } catch (err2: any) {
        if (!isFcmRegistrationsAuthError(err2)) throw err2;

        // Some environments appear to send the Installations auth header in a way
        // that fcmregistrations rejects (still 401 after repairs). As a last resort,
        // call the registrations API directly and store the returned token.
        console.warn("[push] Web push token: retry still unauthenticated; attempting manual fcmregistrations.", {
          code: cleanString(err2?.code),
          msg: cleanString(err2?.message),
        });
        token = await manualFcmRegistration({ app: client.app, swReg, vapidKey });
      }
    }
  } catch (err: any) {
    const code = cleanString(err?.code);
    const msg = cleanString(err?.message);
    const serverResponse = cleanString(err?.customData?.serverResponse);
    console.warn("[push] getToken failed", { code, msg, serverResponse });

    const origin = (() => {
      try {
        return typeof window !== "undefined" ? window.location.origin : "";
      } catch {
        return "";
      }
    })();
    const projectId = cleanString((client.app.options as any)?.projectId);

    const e: any = new Error(describeWebTokenError(err, { origin, projectId }));
    if (code) e.code = code;
    throw e;
  }
  if (!token) return {};

  void attachWebOnMessageListener({ messaging, swReg }).catch(() => null);

  const db = getFirestoreDb();
  if (!db) throw new Error("missing_firestore");
  const deviceId = await ensureDeviceId();
  await setDoc(
    doc(db, "devices", uid, "tokens", deviceId),
    {
      webPushToken: token,
      platform: "web",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return { webPushToken: token };
}

function getProjectId(): string | null {
  // Prefer EAS project id if present (required for getExpoPushTokenAsync in standalone builds).
  const anyConstants = Constants as any;
  const fromEas = cleanString(anyConstants?.easConfig?.projectId);
  if (fromEas) return fromEas;
  const fromExpoConfig = cleanString(anyConstants?.expoConfig?.extra?.eas?.projectId);
  if (fromExpoConfig) return fromExpoConfig;
  const fromEnv = cleanString(process.env.EXPO_PUBLIC_EAS_PROJECT_ID);
  return fromEnv || null;
}

export async function configureSosNotificationChannel() {
  if (Platform.OS !== "android") return;
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.setNotificationChannelAsync("sos", {
      name: "SOS",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 500, 500],
      lightColor: "#E52117",
      sound: "default",
    });
  } catch {
    // ignore
  }
}

export async function registerDeviceForPush(uid: string): Promise<{ expoPushToken?: string; webPushToken?: string }> {
  if (!uid) throw new Error("missing_uid");
  if (Platform.OS === "web") return await registerWebForPush(uid);
  const Device = await import("expo-device");
  if (!Device.isDevice) return {};

  await configureSosNotificationChannel();

  const Notifications = await import("expo-notifications");
  const perms = await Notifications.getPermissionsAsync();
  let status = perms.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return {};

  const projectId = getProjectId();
  const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const expoPushToken = cleanString(tokenRes?.data);
  if (!expoPushToken) return {};

  const db = getFirestoreDb();
  if (!db) throw new Error("missing_firestore");

  const deviceId = await ensureDeviceId();
  await setDoc(
    doc(db, "devices", uid, "tokens", deviceId),
    {
      expoPushToken,
      platform: Platform.OS === "android" ? "android" : "ios",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return { expoPushToken };
}
