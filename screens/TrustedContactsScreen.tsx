import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isProbablyEmail, normalizeEmail, normalizePhone } from "../lib/identifiers";
import { getFirestoreDb } from "../lib/firebase";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "TrustedContacts">;

type TrustedContactRow = {
  uid: string;
  status: "pending" | "accepted" | "rejected";
  trustedEmail?: string;
  trustedPhone?: string;
  requestedAt?: any;
  respondedAt?: any;
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

export default function TrustedContactsScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TrustedContactRow[]>([]);

  const ownerUid = user?.uid || "";
  const ownerEmail = useMemo(() => normalizeEmail(user?.email || ""), [user?.email]);

  useEffect(() => {
    if (!ownerUid) return;
    const db = getFirestoreDb();
    if (!db) return;
    const qy = query(collection(db, "trusted", ownerUid, "contacts"), orderBy("requestedAt", "desc"));
    return onSnapshot(
      qy,
      (snap) => {
        const next: TrustedContactRow[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          const statusRaw = String(data?.status || "pending");
          const status: TrustedContactRow["status"] =
            statusRaw === "accepted" ? "accepted" : statusRaw === "rejected" ? "rejected" : "pending";
          next.push({
            uid: d.id,
            status,
            trustedEmail: typeof data?.trustedEmail === "string" ? data.trustedEmail : undefined,
            trustedPhone: typeof data?.trustedPhone === "string" ? data.trustedPhone : undefined,
            requestedAt: data?.requestedAt,
            respondedAt: data?.respondedAt,
          });
        });
        setRows(next);
      },
      () => {
        // ignore
      },
    );
  }, [ownerUid]);

  async function lookupUidByEmail(inputEmail: string): Promise<string | null> {
    if (!user) throw new Error("missing_auth");
    const token = await user.getIdToken();
    const res = await apiPost<{ uid: string | null }>(
      "/api/sos/lookup-user",
      { email: inputEmail },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const uid = typeof res?.uid === "string" ? res.uid : null;
    return uid && uid.trim() ? uid.trim() : null;
  }

  async function lookupUidByPhone(inputPhone: string): Promise<string | null> {
    if (!user) throw new Error("missing_auth");
    const token = await user.getIdToken();
    const res = await apiPost<{ uid: string | null }>(
      "/api/sos/lookup-user",
      { phone: inputPhone },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const uid = typeof res?.uid === "string" ? res.uid : null;
    return uid && uid.trim() ? uid.trim() : null;
  }

  async function createRequest() {
    setError(null);
    if (!ownerUid) {
      navigation.navigate("Login");
      return;
    }

    const raw = String(identifier || "").trim();
    if (!raw) {
      setError("Enter an email or phone number.");
      return;
    }

    const isEmail = isProbablyEmail(raw);
    const em = isEmail ? normalizeEmail(raw) : "";
    const phone = !isEmail ? normalizePhone(raw) : null;
    if (!isEmail && !phone) {
      setError("Phone number must include country code, e.g. +218... (or 00...).");
      return;
    }

    setBusy(true);
    try {
      const trustedUid = isEmail ? await lookupUidByEmail(em) : await lookupUidByPhone(phone!);
      if (!trustedUid) {
        setError(isEmail ? "No user found with that email." : "No user found with that phone number.");
        return;
      }
      if (trustedUid === ownerUid) {
        setError("You cannot add yourself.");
        return;
      }

      const db = getFirestoreDb();
      if (!db) throw new Error("missing_firestore");

      const batch = writeBatch(db);
      const requestedAt = serverTimestamp();

      batch.set(doc(db, "trusted", ownerUid, "contacts", trustedUid), {
        status: "pending",
        requestedAt,
        respondedAt: null,
        ownerUid,
        trustedUid,
        trustedEmail: isEmail ? em : null,
        trustedPhone: isEmail ? null : phone,
      });

      batch.set(doc(db, "incoming", trustedUid, "requests", ownerUid), {
        status: "pending",
        requestedAt,
        respondedAt: null,
        ownerUid,
        trustedUid,
        ownerEmail: ownerEmail || null,
      });

      await batch.commit();
      setIdentifier("");
      Alert.alert("Request sent", "They must accept before they can receive your SOS alerts.");
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Could not send request.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(trustedUid: string) {
    if (!ownerUid) return;
    const db = getFirestoreDb();
    if (!db) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "trusted", ownerUid, "contacts", trustedUid));
      batch.delete(doc(db, "incoming", trustedUid, "requests", ownerUid));
      await batch.commit();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Trusted Contacts</Text>
          <Text style={styles.hint}>
            Only contacts you add and they accept can receive your SOS alerts.
          </Text>

          <View style={styles.row}>
            <Pressable
              onPress={() => navigation.navigate("IncomingRequests")}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
            >
              <Text style={styles.secondaryBtnText}>Incoming Requests</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add by email or phone</Text>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
            placeholder="Email or phone (+218...)"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />
          <Text style={styles.metaText}>Phone numbers must include country code (+... or 00...).</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={() => void createRequest()}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && !busy && styles.primaryBtnPressed,
              busy && styles.primaryBtnDisabled,
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.primaryBtnText}>{busy ? "Please wait..." : "Send request"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your contacts</Text>
          {rows.length === 0 ? (
            <Text style={styles.metaText}>No contacts yet.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {rows.map((r) => (
                <View key={r.uid} style={styles.contactRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactEmail} numberOfLines={1}>
                      {r.trustedEmail || r.trustedPhone || r.uid}
                    </Text>
                    <Text style={styles.contactMeta}>
                      Status: {r.status}
                      {r.requestedAt ? ` • Requested: ${tsLabel(r.requestedAt)}` : ""}
                      {r.respondedAt ? ` • Responded: ${tsLabel(r.respondedAt)}` : ""}
                    </Text>
                  </View>

                  {r.status === "pending" ? (
                    <Pressable
                      onPress={() => void cancelRequest(r.uid)}
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.dangerBtn,
                        pressed && !busy && styles.dangerBtnPressed,
                        busy && styles.dangerBtnDisabled,
                      ]}
                    >
                      <Text style={styles.dangerBtnText}>Cancel</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={async () => {
                        await cancelRequest(r.uid);
                      }}
                      style={styles.secondaryBtn}
                    >
                      <Text style={styles.secondaryBtnText}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              ))}
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
  cardTitle: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: {
    height: 44,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
  },
  metaText: { fontSize: 12, fontWeight: "700", color: theme.colors.text2 },
  errorText: { fontSize: 12, fontWeight: "800", color: theme.colors.danger },
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
    height: 40,
    paddingHorizontal: 12,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryBtnPressed: { opacity: 0.92 },
  secondaryBtnText: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#F9FAFB",
  },
  contactEmail: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  contactMeta: { marginTop: 4, fontSize: 11, fontWeight: "700", color: theme.colors.text2 },
  dangerBtn: {
    height: 40,
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
