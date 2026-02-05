import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useAuth } from "../lib/auth";
import { normalizePhone } from "../lib/identifiers";
import { getAuthLastEmail, setAuthLastEmail } from "../lib/storage";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export default function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getAuthLastEmail()
      .then((v) => {
        if (!alive || !v) return;
        setEmail((prev) => (prev ? prev : v));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit() {
    setError(null);
    const em = clean(email);
    const phoneRaw = clean(phone);
    const pw = clean(password);
    if (!em || !pw) {
      setError("Enter email and password.");
      return;
    }
    const phoneNormalized = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (phoneRaw && !phoneNormalized) {
      setError("Phone number must include country code, e.g. +218... (or 00...).");
      return;
    }
    if (pw.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    void setAuthLastEmail(em);
    setBusy(true);
    try {
      await register(em, pw, phoneNormalized);
      navigation.goBack();
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Could not register.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.hint}>Register to receive trusted SOS alerts.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="name@example.com"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            placeholder="+2189xxxxxxx"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />
          <Text style={styles.hintInline}>Use international format (+country code).</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Minimum 6 characters"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => void onSubmit()}
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && !busy && styles.primaryBtnPressed,
            busy && styles.primaryBtnDisabled,
          ]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : null}
          <Text style={styles.primaryBtnText}>{busy ? "Creating..." : "Create account"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg, padding: 16 },
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
  hintInline: { fontSize: 11, fontWeight: "700", color: theme.colors.text2 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  input: {
    height: 44,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
  },
  error: { fontSize: 12, fontWeight: "800", color: theme.colors.danger },
  primaryBtn: {
    height: 46,
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
});
