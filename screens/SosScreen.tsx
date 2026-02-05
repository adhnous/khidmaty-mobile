import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Vibration,
} from "react-native";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { startAlarm, stopAlarm } from "../lib/alarm";
import { getFirestoreDb } from "../lib/firebase";
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

  const [alarmModalOpen, setAlarmModalOpen] = useState(false);
  const [alarmStarting, setAlarmStarting] = useState(false);

  const mapsUrl = useMemo(() => (coords ? buildMapsUrl(coords.lat, coords.lon) : ""), [coords]);

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
      const res = await apiPost<{ sent?: number }>("/api/sos/send", { eventId: ref.id }, { headers: { Authorization: `Bearer ${token}` } });

      Alert.alert("SOS sent", `Notified ${Number(res?.sent ?? 0)} trusted contact device(s).`);
    } catch (err: any) {
      const detail = typeof err?.detail === "string" ? err.detail.trim() : "";
      const msg = detail || (typeof err?.message === "string" ? err.message : "Could not send SOS.");
      setSendError(msg || "Could not send SOS.");
    } finally {
      setSending(false);
    }
  }

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
});
