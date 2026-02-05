import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { doc, onSnapshot } from "firebase/firestore";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useAuth } from "../lib/auth";
import { startAlarm, stopAlarm } from "../lib/alarm";
import { getFirestoreDb } from "../lib/firebase";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "IncomingSOS">;

type SosEvent = {
  senderUid: string;
  message: string;
  lat: number;
  lon: number;
  createdAt?: any;
};

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsLabel(ts: any): string {
  const ms = typeof ts?.toMillis === "function" ? ts.toMillis() : null;
  if (!ms || !Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

function buildMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

export default function IncomingSosScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const eventId = route.params.eventId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<SosEvent | null>(null);

  const mapsUrl = useMemo(() => {
    if (!event) return "";
    return buildMapsUrl(event.lat, event.lon);
  }, [event]);

  useEffect(() => {
    void startAlarm({ vibration: true });
    return () => {
      void stopAlarm();
    };
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      setError("Login required to view SOS details.");
      return;
    }
    const db = getFirestoreDb();
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    setLoading(true);
    setError(null);

    const ref = doc(db, "sos_events", eventId);
    return onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setError("SOS not found (or you don't have access).");
          setEvent(null);
          return;
        }

        const data = snap.data() as any;
        const senderUid = cleanString(data?.senderUid);
        const message = cleanString(data?.message);
        const lat = cleanNumber(data?.lat);
        const lon = cleanNumber(data?.lon);
        if (!senderUid || !message || lat == null || lon == null) {
          setError("SOS data is invalid.");
          setEvent(null);
          return;
        }

        setEvent({ senderUid, message, lat, lon, createdAt: data?.createdAt });
      },
      () => {
        setLoading(false);
        setError("Could not load SOS. Check your internet and try again.");
        setEvent(null);
      },
    );
  }, [eventId, user?.uid]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>🚨 SOS Alert</Text>
          <Text style={styles.heroSub}>Siren + vibration are active until you stop them.</Text>
        </View>

        {!user?.uid ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Login required</Text>
            <Text style={styles.metaText}>Sign in to view SOS details.</Text>
            <Pressable
              onPress={() => navigation.navigate("Login")}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryBtnText}>Login</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <ActivityIndicator />
              <Text style={styles.metaText}>Loading SOS…</Text>
            </View>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : event ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Message</Text>
            <Text style={styles.messageText}>{event.message}</Text>

            <Text style={styles.metaText}>
              {event.createdAt ? `Created: ${tsLabel(event.createdAt)}` : ""}
            </Text>

            <View style={styles.row}>
              <Pressable
                onPress={() => void Linking.openURL(mapsUrl)}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>Open Maps</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void stopAlarm();
                  navigation.goBack();
                }}
                style={({ pressed }) => [styles.dangerBtn, pressed && styles.dangerBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.dangerBtnText}>Stop Alarm</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.metaText}>No data.</Text>
          </View>
        )}
      </View>
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
  messageText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  metaText: { fontSize: 12, fontWeight: "700", color: theme.colors.text2 },
  errorText: { fontSize: 12, fontWeight: "800", color: theme.colors.danger },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  primaryBtn: {
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
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
  dangerBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.danger,
  },
  dangerBtnPressed: { opacity: 0.92 },
  dangerBtnText: { fontSize: 13, fontWeight: "900", color: "#fff" },
});

