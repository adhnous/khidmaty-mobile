import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirestoreDb } from "./firebase";
import { ensureDeviceId } from "./storage";

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

export async function registerDeviceForPush(uid: string): Promise<{ expoPushToken?: string }> {
  if (!uid) throw new Error("missing_uid");
  if (Platform.OS === "web") return {};
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

