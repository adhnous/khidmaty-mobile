import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useAuth } from "../lib/auth";
import { getFirestoreDb } from "../lib/firebase";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "IncomingRequests">;

type IncomingRow = {
  ownerUid: string;
  status: "pending" | "accepted" | "rejected";
  ownerEmail?: string;
  requestedAt?: any;
};

function tsLabel(ts: any): string {
  const ms = typeof ts?.toMillis === "function" ? ts.toMillis() : null;
  if (!ms || !Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

export default function IncomingRequestsScreen({ navigation }: Props) {
  const { user } = useAuth();
  const uid = user?.uid || "";
  const [rows, setRows] = useState<IncomingRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = getFirestoreDb();
    if (!db) return;
    const qy = query(collection(db, "incoming", uid, "requests"), orderBy("requestedAt", "desc"));
    return onSnapshot(
      qy,
      (snap) => {
        const next: IncomingRow[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          const statusRaw = String(data?.status || "pending");
          const status: IncomingRow["status"] =
            statusRaw === "accepted" ? "accepted" : statusRaw === "rejected" ? "rejected" : "pending";
          next.push({
            ownerUid: d.id,
            status,
            ownerEmail: typeof data?.ownerEmail === "string" ? data.ownerEmail : undefined,
            requestedAt: data?.requestedAt,
          });
        });
        setRows(next);
      },
      () => {
        // ignore
      },
    );
  }, [uid]);

  async function respond(ownerUid: string, status: "accepted" | "rejected") {
    if (!uid) {
      navigation.navigate("Login");
      return;
    }
    const db = getFirestoreDb();
    if (!db) return;
    setBusyId(ownerUid);
    try {
      const respondedAt = serverTimestamp();
      const batch = writeBatch(db);
      batch.update(doc(db, "incoming", uid, "requests", ownerUid), { status, respondedAt });
      batch.update(doc(db, "trusted", ownerUid, "contacts", uid), { status, respondedAt });
      await batch.commit();
      Alert.alert(status === "accepted" ? "Accepted" : "Rejected", "Your response was saved.");
    } catch {
      Alert.alert("Error", "Could not update request. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Incoming Requests</Text>
          <Text style={styles.hint}>
            Accepting means you agree to receive SOS alerts from that person.
          </Text>
        </View>

        <View style={styles.card}>
          {rows.length === 0 ? (
            <Text style={styles.metaText}>No incoming requests.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {rows.map((r) => {
                const busy = busyId === r.ownerUid;
                return (
                  <View key={r.ownerUid} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ownerText} numberOfLines={1}>
                        {r.ownerEmail || r.ownerUid}
                      </Text>
                      <Text style={styles.metaText}>
                        Status: {r.status}
                        {r.requestedAt ? ` • Requested: ${tsLabel(r.requestedAt)}` : ""}
                      </Text>
                    </View>

                    {r.status === "pending" ? (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                          onPress={() => void respond(r.ownerUid, "accepted")}
                          disabled={busy}
                          style={({ pressed }) => [
                            styles.primaryBtn,
                            pressed && !busy && styles.primaryBtnPressed,
                            busy && styles.primaryBtnDisabled,
                          ]}
                        >
                          {busy ? <ActivityIndicator color="#fff" /> : null}
                          <Text style={styles.primaryBtnText}>Accept</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void respond(r.ownerUid, "rejected")}
                          disabled={busy}
                          style={({ pressed }) => [
                            styles.dangerBtn,
                            pressed && !busy && styles.dangerBtnPressed,
                            busy && styles.dangerBtnDisabled,
                          ]}
                        >
                          <Text style={styles.dangerBtnText}>Reject</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, gap: 12 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
    ...theme.shadow,
  },
  title: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  hint: { fontSize: 12, fontWeight: "700", color: theme.colors.text2 },
  metaText: { fontSize: 12, fontWeight: "700", color: theme.colors.text2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#F9FAFB",
  },
  ownerText: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  primaryBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnPressed: { opacity: 0.92 },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  dangerBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(229,33,23,0.10)",
    borderWidth: 1,
    borderColor: "rgba(229,33,23,0.22)",
  },
  dangerBtnPressed: { opacity: 0.92 },
  dangerBtnDisabled: { opacity: 0.7 },
  dangerBtnText: { fontSize: 12, fontWeight: "900", color: theme.colors.danger },
});
