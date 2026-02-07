import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Vibration,
} from "react-native";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { startAlarm, stopAlarm } from "../lib/alarm";
import { getFirestoreDb } from "../lib/firebase";
import { registerDeviceForPush } from "../lib/push";
import { isIOSWeb, isStandalonePWA } from "../lib/pwa";
import { getSosShakeEnabled, setSosShakeEnabled } from "../lib/storage";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "SOS">;

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function buildMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

export default function SosScreen({ navigation }: Props) {
  const { user } = useAuth();

  const [message, setMessage] = useState("SOS: I need urgent help.");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const iosWeb = useMemo(() => isIOSWeb(), []);
  const standalonePwa = useMemo(() => isStandalonePWA(), []);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const [alarmModalOpen, setAlarmModalOpen] = useState(false);
  const [alarmStarting, setAlarmStarting] = useState(false);

  const shakeSupported = Platform.OS !== "web";
  const [shakeEnabled, setShakeEnabled] = useState(false);
  const shakeStateRef = useRef({ count: 0, lastShakeAt: 0, lastTriggerAt: 0 });
  const sendSosRef = useRef<() => void>(() => {});
  const sendingRef = useRef(false);
  const userUidRef = useRef("");
  sendingRef.current = sending;
  userUidRef.current = user?.uid || "";

  const mapsUrl = useMemo(() => (coords ? buildMapsUrl(coords.lat, coords.lon) : ""), [coords]);

  useEffect(() => {
    if (!shakeSupported) return;
    void getSosShakeEnabled()
      .then((v) => setShakeEnabled(!!v))
      .catch(() => null);
  }, [shakeSupported]);

  useEffect(() => {
    // Stop alarm if the user leaves the SOS screen.
    return () => {
      void stopAlarm();
      try {
        Vibration.cancel();
      } catch {
        // ignore
      }
    };
  }, []);

  async function refreshLocation(): Promise<{ lat: number; lon: number } | null> {
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        setLocError("Location permission is required to send an SOS with GPS.");
        setCoords(null);
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const next = { lat, lon };
      setCoords(next);
      return next;
    } catch {
      setLocError("Could not get location. Try again.");
      setCoords(null);
      return null;
    }
  }

  async function sendSos() {
    setSendError(null);

    if (!user?.uid) {
      navigation.navigate("Login");
      return;
    }

    const msg = cleanString(message);
    if (!msg) {
      setSendError("Message is empty.");
      return;
    }
    if (msg.length > 500) {
      setSendError("Message must be <= 500 characters.");
      return;
    }

    setSending(true);
    try {
      let c = coords;
      if (!c) c = await refreshLocation();
      if (!c) {
        setSendError("No GPS location yet. Tap Use Location and try again.");
        return;
      }

      const db = getFirestoreDb();
      if (!db) throw new Error("missing_firestore");

      const ref = await addDoc(collection(db, "sos_events"), {
        senderUid: user.uid,
        message: msg,
        lat: c.lat,
        lon: c.lon,
        createdAt: serverTimestamp(),
      });

      const token = await user.getIdToken();
      const res = await apiPost<{
        sent?: number;
        recipients?: number;
        tokens?: number;
        expoTokens?: number;
        webTokens?: number;
        errors?: number;
      }>("/api/sos/send", { eventId: ref.id }, { headers: { Authorization: `Bearer ${token}` } });

      const recipients = Number(res?.recipients ?? 0) || 0;
      const tokens = Number(res?.tokens ?? 0) || 0;
      const sent = Number(res?.sent ?? 0) || 0;

      if (recipients <= 0) {
        Alert.alert("No trusted contacts", "You have no accepted trusted contacts yet. Add a contact and wait for them to accept.");
      } else if (tokens <= 0) {
        Alert.alert(
          "No devices to notify",
          "Your trusted contact accepted, but they haven't enabled notifications yet. Ask them to log in and allow notifications on their phone/browser, then try again.",
        );
      } else {
        Alert.alert("SOS sent", `Notified ${sent} trusted contact device(s).`);
      }
    } catch (err: any) {
      const detail = typeof err?.detail === "string" ? err.detail.trim() : "";
      const msg = detail || (typeof err?.message === "string" ? err.message : "Could not send SOS.");
      setSendError(msg || "Could not send SOS.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    sendSosRef.current = () => {
      void sendSos();
    };
  });

  useEffect(() => {
    if (!shakeSupported) return;
    if (!shakeEnabled) return;

    const SHAKE_G_THRESHOLD = 2.7;
    const SHAKE_WINDOW_MS = 1400;
    const SHAKE_DEBOUNCE_MS = 350;
    const COOLDOWN_MS = 12_000;

    try {
      Accelerometer.setUpdateInterval(140);
    } catch {
      // ignore
    }

    const sub = Accelerometer.addListener((data) => {
      if (!data) return;
      if (!userUidRef.current) return;
      if (sendingRef.current) return;

      const x = typeof (data as any).x === "number" ? (data as any).x : 0;
      const y = typeof (data as any).y === "number" ? (data as any).y : 0;
      const z = typeof (data as any).z === "number" ? (data as any).z : 0;

      const g = Math.sqrt(x * x + y * y + z * z);
      if (!Number.isFinite(g) || g < SHAKE_G_THRESHOLD) return;

      const now = Date.now();
      const s = shakeStateRef.current;
      if (now - s.lastTriggerAt < COOLDOWN_MS) return;
      if (now - s.lastShakeAt < SHAKE_DEBOUNCE_MS) return;

      if (now - s.lastShakeAt > SHAKE_WINDOW_MS) s.count = 0;
      s.lastShakeAt = now;
      s.count += 1;

      if (s.count < 2) return;
      s.count = 0;
      s.lastTriggerAt = now;

      sendSosRef.current();
    });

    return () => {
      sub.remove();
    };
  }, [shakeEnabled, shakeSupported]);

  async function startPanicAlarm() {
    setAlarmStarting(true);
    try {
      await startAlarm({ vibration: true });
      setAlarmModalOpen(true);
    } catch {
      Alert.alert("Alarm", "Could not start the alarm on this device.");
    } finally {
      setAlarmStarting(false);
    }
  }

  async function stopPanicAlarm() {
    try {
      await stopAlarm();
    } finally {
      setAlarmModalOpen(false);
    }
  }

  async function toggleShake(next: boolean) {
    setShakeEnabled(next);
    void setSosShakeEnabled(next).catch(() => null);
  }

  async function enableSosAlerts() {
    setPushError(null);

    if (!user?.uid) {
      navigation.navigate("Login");
      return;
    }

    if (Platform.OS === "web") {
      if (iosWeb && !standalonePwa) {
        Alert.alert(
          "Install to Home Screen",
          "On iPhone (iOS 16.4+), SOS notifications work only when the app is installed to the Home Screen (PWA / standalone).\n\nSteps:\n1) Open this site in Safari\n2) Tap Share\n3) Add to Home Screen\n4) Open the app from the icon\n\nThen come back and tap Enable SOS Alerts.",
        );
        return;
      }

      try {
        if (typeof Notification !== "undefined" && Notification.permission === "denied") {
          Alert.alert(
            "Notifications blocked",
            "Notifications are blocked for this site. Enable them in your browser settings, then try again.",
          );
          return;
        }
      } catch {
        // ignore
      }
    }

    setPushBusy(true);
    try {
      const res = await registerDeviceForPush(user.uid);
      const ok = !!(res?.expoPushToken || res?.webPushToken);
      if (ok) {
        Alert.alert("SOS Alerts enabled", "This device can now receive trusted SOS notifications.");
      } else {
        Alert.alert(
          "Could not enable alerts",
          Platform.OS === "web"
            ? "This browser doesn't support web push notifications, or permission was not granted."
            : "Notification permission was not granted.",
        );
      }
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message.trim() : "";
      setPushError(msg || "Could not enable SOS alerts. Try again.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Trusted SOS</Text>
          <Text style={styles.heroSub}>Only accepted trusted contacts receive alerts.</Text>
        </View>

        {!user?.uid ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Login required</Text>
            <Text style={styles.hintText}>Create an account to send/receive trusted SOS alerts.</Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => navigation.navigate("Login")}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.primaryBtnText}>Login</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("Register")}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>Register</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Trusted contacts</Text>
            <Text style={styles.hintText}>Add contacts and wait for them to accept.</Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => navigation.navigate("TrustedContacts")}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>Manage</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("IncomingRequests")}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>Requests</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>SOS alerts</Text>
          <Text style={styles.hintText}>Enable notifications on this device to receive trusted SOS alerts.</Text>

          {Platform.OS === "web" && iosWeb && !standalonePwa ? (
            <Text style={styles.errorText}>On iPhone, install to Home Screen (PWA) to enable SOS alerts.</Text>
          ) : null}

          <Pressable
            onPress={() => void enableSosAlerts()}
            disabled={pushBusy}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && !pushBusy && styles.primaryBtnPressed,
              pushBusy && styles.primaryBtnDisabled,
            ]}
          >
            {pushBusy ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.primaryBtnText}>{pushBusy ? "Enabling..." : "Enable SOS Alerts"}</Text>
          </Pressable>
          {pushError ? <Text style={styles.errorText}>{pushError}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location</Text>
          <Text style={styles.metaText}>
            {coords ? `Coords: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}` : "No GPS location yet."}
          </Text>
          {mapsUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(mapsUrl)}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
            >
              <Text style={styles.secondaryBtnText}>Open Maps</Text>
            </Pressable>
          ) : null}
          {locError ? <Text style={styles.errorText}>{locError}</Text> : null}

          <Pressable
            onPress={() => void refreshLocation()}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          >
            <Text style={styles.primaryBtnText}>Use Location</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Message</Text>
          <Text style={styles.hintText}>Keep it short. Your GPS coordinates will be attached.</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your emergency..."
            placeholderTextColor="#9CA3AF"
            multiline
            style={[styles.input, styles.inputMulti]}
          />

          <View style={styles.shakeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shakeTitle}>Shake to send</Text>
              <Text style={styles.hintText}>
                {shakeSupported ? "Shake your phone twice to send SOS." : "Shake is not available on web."}
              </Text>
            </View>
            <Switch
              value={shakeEnabled}
              onValueChange={(v) => void toggleShake(v)}
              disabled={!shakeSupported}
              trackColor={{ false: "#D1D5DB", true: "rgba(229,33,23,0.35)" }}
              thumbColor={shakeEnabled ? theme.colors.danger : "#F9FAFB"}
            />
          </View>

          <Pressable
            onPress={() => void sendSos()}
            disabled={sending}
            style={({ pressed }) => [
              styles.sosBtn,
              pressed && !sending && styles.sosBtnPressed,
              sending && styles.sosBtnDisabled,
            ]}
          >
            {sending ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.sosBtnText}>{sending ? "Sending..." : "Send SOS to Trusted Contacts"}</Text>
          </Pressable>
          {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Panic Alarm</Text>
          <Text style={styles.hintText}>A loud siren + vibration to attract attention. Use only in real emergencies.</Text>

          <View style={styles.row}>
            <Pressable
              onPress={() => void startPanicAlarm()}
              disabled={alarmStarting}
              style={({ pressed }) => [
                styles.alarmBtn,
                pressed && !alarmStarting && styles.alarmBtnPressed,
                alarmStarting && styles.alarmBtnDisabled,
              ]}
            >
              {alarmStarting ? <ActivityIndicator color="#fff" /> : null}
              <Text style={styles.alarmBtnText}>{alarmStarting ? "Starting..." : "Start Alarm"}</Text>
            </Pressable>

            <Pressable
              onPress={() => void stopPanicAlarm()}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
            >
              <Text style={styles.secondaryBtnText}>Stop</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>

      <Modal visible={alarmModalOpen} transparent animationType="fade" onRequestClose={() => void stopPanicAlarm()}>
        <View style={styles.alarmOverlay}>
          <View style={styles.alarmCard}>
            <Text style={styles.alarmTitle}>ALARM ON</Text>
            <Text style={styles.alarmSubtitle}>If you are safe, press Stop. Otherwise, send SOS.</Text>

            <View style={styles.row}>
              <Pressable onPress={() => void stopPanicAlarm()} style={({ pressed }) => [styles.sosBtn, pressed && styles.sosBtnPressed]}>
                <Text style={styles.sosBtnText}>STOP ALARM</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, gap: 12 },
  hero: {
    padding: 14,
    borderRadius: theme.radii.lg,
    backgroundColor: "rgba(229,33,23,0.10)",
    borderWidth: 1,
    borderColor: "rgba(229,33,23,0.22)",
    gap: 6,
  },
  heroTitle: { fontSize: 20, fontWeight: "900", color: theme.colors.danger },
  heroSub: { fontSize: 12, fontWeight: "800", color: theme.colors.text2 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
    ...theme.shadow,
  },
  cardTitle: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  hintText: { fontSize: 12, fontWeight: "700", color: theme.colors.text2 },
  metaText: { fontSize: 12, fontWeight: "800", color: theme.colors.text2 },
  errorText: { fontSize: 12, fontWeight: "800", color: theme.colors.danger },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: {
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: 13,
  },
  inputMulti: { minHeight: 90, textAlignVertical: "top" },
  primaryBtn: {
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    flexDirection: "row",
    gap: 10,
  },
  primaryBtnPressed: { opacity: 0.92 },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  secondaryBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryBtnPressed: { opacity: 0.92 },
  secondaryBtnText: { fontSize: 13, fontWeight: "900", color: theme.colors.text },
  sosBtn: {
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.danger,
    flexDirection: "row",
    gap: 10,
  },
  sosBtnPressed: { opacity: 0.92 },
  sosBtnDisabled: { opacity: 0.7 },
  sosBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  alarmBtn: {
    flex: 1,
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    flexDirection: "row",
    gap: 10,
  },
  alarmBtnPressed: { opacity: 0.92 },
  alarmBtnDisabled: { opacity: 0.7 },
  alarmBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  footerSpace: { height: 12 },
  alarmOverlay: {
    flex: 1,
    backgroundColor: "rgba(229,33,23,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  alarmCard: {
    width: "100%",
    maxWidth: 520,
    padding: 16,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
    ...theme.shadow,
  },
  alarmTitle: { fontSize: 22, fontWeight: "900", color: theme.colors.danger },
  alarmSubtitle: { fontSize: 12, fontWeight: "800", color: theme.colors.text2 },
  shakeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  shakeTitle: { fontSize: 13, fontWeight: "900", color: theme.colors.text },
});
