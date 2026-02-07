import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebaseClient, getFirestoreDb } from "./firebase";
import { isIOSWeb, isStandalonePWA } from "./pwa";
import { ensureDeviceId } from "./storage";

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

async function registerWebForPush(uid: string): Promise<{ webPushToken?: string }> {
  if (!uid) throw new Error("missing_uid");
  if (Platform.OS !== "web") return {};
  if (typeof window === "undefined") return {};

  const client = getFirebaseClient();
  if (!client) return {};

  const vapidKey = cleanString(process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY);
  if (!vapidKey) throw new Error("Web push disabled: missing EXPO_PUBLIC_FIREBASE_VAPID_KEY.");

  if (!("Notification" in window)) throw new Error("Notifications are not supported in this browser.");
  if (!("serviceWorker" in navigator)) throw new Error("Service Workers are not supported in this browser.");

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

  let token = "";
  let messaging: any = null;
  try {
    const mod = await import("firebase/messaging");
    messaging = mod.getMessaging(client.app);
    token = cleanString(
      await mod.getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: swReg,
      }),
    );
  } catch {
    throw new Error("Could not get web push token.");
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
  if (!Device.isDevice) return {};

  await configureSosNotificationChannel();

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
