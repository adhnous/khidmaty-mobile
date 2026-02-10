import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useAuth } from "../lib/auth";
import { getAuthLastEmail, setAuthLastEmail } from "../lib/storage";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export default function LoginScreen({ navigation }: Props) {
  const { user, authError, clearAuthError, login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function leaveAuthScreen() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Search");
  }

  useEffect(() => {
    if (!user) return;
    leaveAuthScreen();
  }, [navigation, user]);

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
    clearAuthError();
    const em = clean(email);
    const pw = clean(password);
    if (!em || !pw) {
      setError("Enter email and password.");
      return;
    }
    void setAuthLastEmail(em);
    setBusy(true);
    try {
      await login(em, pw);
    } catch (err: any) {
      const code = typeof err?.code === "string" ? err.code : "";
      const msg = typeof err?.message === "string" ? err.message : "Could not login.";
      setError(code && !msg.includes(code) ? `${msg} (${code})` : msg);
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setError(null);
    clearAuthError();
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      const code = typeof err?.code === "string" ? err.code : "";
      const raw = typeof err?.message === "string" ? err.message : "";
      if (raw === "cancel" || raw === "dismiss") setError("Sign-in cancelled.");
      else {
        const base = raw || "Could not sign in with Google.";
        setError(code && !base.includes(code) ? `${base} (${code})` : base);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Login</Text>
        <Text style={styles.hint}>Sign in to send/receive trusted SOS alerts.</Text>

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
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />
        </View>

        {error || authError ? <Text style={styles.error}>{error || authError}</Text> : null}

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
          <Text style={styles.primaryBtnText}>{busy ? "Signing in..." : "Login"}</Text>
        </Pressable>

        <Pressable
          onPress={() => void onGoogle()}
          disabled={busy}
          style={({ pressed }) => [styles.secondaryBtn, pressed && !busy && styles.secondaryBtnPressed, busy && styles.secondaryBtnDisabled]}
        >
          <Text style={styles.secondaryBtnText}>Continue with Google</Text>
        </Pressable>

        <Pressable onPress={() => navigation.navigate("Register")} style={styles.linkBtn}>
          <Text style={styles.linkText}>Create account</Text>
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
  secondaryBtn: {
    height: 46,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  secondaryBtnPressed: { opacity: 0.92 },
  secondaryBtnDisabled: { opacity: 0.7 },
  secondaryBtnText: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  linkBtn: { alignSelf: "center", paddingVertical: 6 },
  linkText: { color: theme.colors.primary, fontWeight: "900", fontSize: 13 },
});
