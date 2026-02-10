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
import { AppLanguage, getPreferredLanguage, getSosShakeEnabled, setPreferredLanguage, setSosShakeEnabled } from "../lib/storage";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "SOS">;

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function buildMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function detectDefaultLanguage(): AppLanguage {
  try {
    const browserLanguage =
      typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : "";
    const intlLocale =
      typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
        ? Intl.DateTimeFormat().resolvedOptions().locale
        : "";
    const locale = String(browserLanguage || intlLocale || "").toLowerCase();
    return locale.startsWith("ar") ? "ar" : "en";
  } catch {
    return "en";
  }
}

export default function SosScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("en");
  const isArabic = language === "ar";
  const t = (en: string, ar: string) => (isArabic ? ar : en);

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
    let alive = true;
    void getPreferredLanguage()
      .then((stored) => {
        if (!alive) return;
        setLanguage(stored || detectDefaultLanguage());
      })
      .catch(() => {
        if (!alive) return;
        setLanguage(detectDefaultLanguage());
      });
    return () => {
      alive = false;
    };
  }, []);

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
        setLocError(t("Location permission is required to send an SOS with GPS.", "مطلوب إذن الموقع لإرسال نداء استغاثة مع إحداثيات GPS."));
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
      setLocError(t("Could not get location. Try again.", "تعذر الحصول على الموقع. حاول مرة أخرى."));
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
      setSendError(t("Message is empty.", "الرسالة فارغة."));
      return;
    }
    if (msg.length > 500) {
      setSendError(t("Message must be <= 500 characters.", "يجب أن تكون الرسالة 500 حرف أو أقل."));
      return;
    }

    setSending(true);
    try {
      let c = coords;
      if (!c) c = await refreshLocation();
      if (!c) {
        setSendError(t("No GPS location yet. Tap Use Location and try again.", "لا توجد إحداثيات GPS حتى الآن. اضغط استخدام الموقع ثم حاول مرة أخرى."));
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
        Alert.alert(
          t("No trusted contacts", "لا توجد جهات موثوقة"),
          t(
            "You have no accepted trusted contacts yet. Add a contact and wait for them to accept.",
            "ليس لديك جهات اتصال موثوقة مقبولة بعد. أضف جهة اتصال وانتظر قبولها.",
          ),
        );
      } else if (tokens <= 0) {
        Alert.alert(
          t("No devices to notify", "لا توجد أجهزة للإشعار"),
          t(
            "Your trusted contact accepted, but they haven't enabled notifications yet. Ask them to log in and allow notifications on their phone/browser, then try again.",
            "جهة الاتصال الموثوقة قبلت الطلب، لكنها لم تُفعّل الإشعارات بعد. اطلب منهم تسجيل الدخول والسماح بالإشعارات على الهاتف/المتصفح ثم حاول مرة أخرى.",
          ),
        );
      } else {
        Alert.alert(
          t("SOS sent", "تم إرسال الاستغاثة"),
          isArabic ? `تم إشعار ${sent} جهازًا لجهات الاتصال الموثوقة.` : `Notified ${sent} trusted contact device(s).`,
        );
      }
    } catch (err: any) {
      const detail = typeof err?.detail === "string" ? err.detail.trim() : "";
      const msg = detail || (typeof err?.message === "string" ? err.message : t("Could not send SOS.", "تعذر إرسال الاستغاثة."));
      setSendError(msg || t("Could not send SOS.", "تعذر إرسال الاستغاثة."));
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
      Alert.alert(t("Alarm", "الإنذار"), t("Could not start the alarm on this device.", "تعذر تشغيل الإنذار على هذا الجهاز."));
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

  async function changeLanguage(next: AppLanguage) {
    if (next === language) return;
    setLanguage(next);
    void setPreferredLanguage(next).catch(() => null);
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
          t("Install to Home Screen", "التثبيت على الشاشة الرئيسية"),
          t(
            "On iPhone (iOS 16.4+), SOS notifications work only when the app is installed to the Home Screen (PWA / standalone).\n\nSteps:\n1) Open this site in Safari\n2) Tap Share\n3) Add to Home Screen\n4) Open the app from the icon\n\nThen come back and tap Enable SOS Alerts.",
            "على iPhone (iOS 16.4+)، تعمل إشعارات SOS فقط عند تثبيت التطبيق على الشاشة الرئيسية (PWA / standalone).\n\nالخطوات:\n1) افتح الموقع في Safari\n2) اضغط مشاركة\n3) إضافة إلى الشاشة الرئيسية\n4) افتح التطبيق من الأيقونة\n\nثم ارجع واضغط تفعيل تنبيهات SOS.",
          ),
        );
        return;
      }

      try {
        if (typeof Notification !== "undefined" && Notification.permission === "denied") {
          Alert.alert(
            t("Notifications blocked", "الإشعارات محظورة"),
            t("Notifications are blocked for this site. Enable them in your browser settings, then try again.", "الإشعارات محظورة لهذا الموقع. فعّلها من إعدادات المتصفح ثم حاول مرة أخرى."),
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
        Alert.alert(t("SOS Alerts enabled", "تم تفعيل تنبيهات SOS"), t("This device can now receive trusted SOS notifications.", "يمكن لهذا الجهاز الآن استقبال تنبيهات SOS الموثوقة."));
      } else {
        Alert.alert(
          t("Could not enable alerts", "تعذر تفعيل التنبيهات"),
          Platform.OS === "web"
            ? t("This browser doesn't support web push notifications, or permission was not granted.", "هذا المتصفح لا يدعم إشعارات الويب أو لم يتم منح الإذن.")
            : t("Notification permission was not granted.", "لم يتم منح إذن الإشعارات."),
        );
      }
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message.trim() : "";
      setPushError(msg || t("Could not enable SOS alerts. Try again.", "تعذر تفعيل تنبيهات SOS. حاول مرة أخرى."));
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.langRow}>
          <Pressable
            onPress={() => void changeLanguage("en")}
            style={({ pressed }) => [
              styles.langBtn,
              language === "en" && styles.langBtnActive,
              pressed && styles.langBtnPressed,
            ]}
          >
            <Text style={[styles.langBtnText, language === "en" && styles.langBtnTextActive]}>English</Text>
          </Pressable>
          <Pressable
            onPress={() => void changeLanguage("ar")}
            style={({ pressed }) => [
              styles.langBtn,
              language === "ar" && styles.langBtnActive,
              pressed && styles.langBtnPressed,
            ]}
          >
            <Text style={[styles.langBtnText, language === "ar" && styles.langBtnTextActive]}>العربية</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{t("Trusted SOS", "استغاثة موثوقة")}</Text>
          <Text style={styles.heroSub}>{t("Only accepted trusted contacts receive alerts.", "فقط جهات الاتصال الموثوقة المقبولة تستقبل التنبيهات.")}</Text>
        </View>

        {!user?.uid ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("Login required", "تسجيل الدخول مطلوب")}</Text>
            <Text style={styles.hintText}>{t("Create an account to send/receive trusted SOS alerts.", "أنشئ حسابًا لإرسال/استقبال تنبيهات SOS الموثوقة.")}</Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => navigation.navigate("Login")}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.primaryBtnText}>{t("Login", "تسجيل الدخول")}</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("Register")}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>{t("Register", "إنشاء حساب")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("Trusted contacts", "جهات الاتصال الموثوقة")}</Text>
            <Text style={styles.hintText}>{t("Add contacts and wait for them to accept.", "أضف جهات اتصال وانتظر قبولهم.")}</Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => navigation.navigate("TrustedContacts")}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>{t("Manage", "إدارة")}</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("IncomingRequests")}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed, { flex: 1 }]}
              >
                <Text style={styles.secondaryBtnText}>{t("Requests", "الطلبات")}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("SOS alerts", "تنبيهات SOS")}</Text>
          <Text style={styles.hintText}>{t("Enable notifications on this device to receive trusted SOS alerts.", "فعّل الإشعارات على هذا الجهاز لاستقبال تنبيهات SOS الموثوقة.")}</Text>

          {Platform.OS === "web" && iosWeb && !standalonePwa ? (
            <Text style={styles.errorText}>{t("On iPhone, install to Home Screen (PWA) to enable SOS alerts.", "على iPhone، ثبّت التطبيق على الشاشة الرئيسية (PWA) لتفعيل تنبيهات SOS.")}</Text>
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
            <Text style={styles.primaryBtnText}>{pushBusy ? t("Enabling...", "جارٍ التفعيل...") : t("Enable SOS Alerts", "تفعيل تنبيهات SOS")}</Text>
          </Pressable>
          {pushError ? <Text style={styles.errorText}>{pushError}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("Location", "الموقع")}</Text>
          <Text style={styles.metaText}>
            {coords
              ? isArabic
                ? `الإحداثيات: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`
                : `Coords: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`
              : t("No GPS location yet.", "لا توجد إحداثيات GPS حتى الآن.")}
          </Text>
          {mapsUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(mapsUrl)}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
            >
              <Text style={styles.secondaryBtnText}>{t("Open Maps", "فتح الخريطة")}</Text>
            </Pressable>
          ) : null}
          {locError ? <Text style={styles.errorText}>{locError}</Text> : null}

          <Pressable
            onPress={() => void refreshLocation()}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          >
            <Text style={styles.primaryBtnText}>{t("Use Location", "استخدام الموقع")}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("Message", "الرسالة")}</Text>
          <Text style={styles.hintText}>{t("Keep it short. Your GPS coordinates will be attached.", "اجعلها قصيرة. سيتم إرفاق إحداثيات GPS.")}</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t("Describe your emergency...", "صف حالتك الطارئة...")}
            placeholderTextColor="#9CA3AF"
            multiline
            style={[styles.input, styles.inputMulti]}
          />

          <View style={styles.shakeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shakeTitle}>{t("Shake to send", "الهز للإرسال")}</Text>
              <Text style={styles.hintText}>
                {shakeSupported
                  ? t("Shake your phone twice to send SOS.", "اهز هاتفك مرتين لإرسال الاستغاثة.")
                  : t("Shake is not available on web.", "الهز غير متاح على الويب.")}
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
            <Text style={styles.sosBtnText}>{sending ? t("Sending...", "جارٍ الإرسال...") : t("Send SOS to Trusted Contacts", "إرسال SOS إلى الجهات الموثوقة")}</Text>
          </Pressable>
          {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("Panic Alarm", "إنذار الطوارئ")}</Text>
          <Text style={styles.hintText}>{t("A loud siren + vibration to attract attention. Use only in real emergencies.", "صفارة عالية + اهتزاز لجذب الانتباه. استخدمها فقط في الطوارئ الحقيقية.")}</Text>

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
              <Text style={styles.alarmBtnText}>{alarmStarting ? t("Starting...", "جارٍ البدء...") : t("Start Alarm", "بدء الإنذار")}</Text>
            </Pressable>

            <Pressable
              onPress={() => void stopPanicAlarm()}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
            >
              <Text style={styles.secondaryBtnText}>{t("Stop", "إيقاف")}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>

      <Modal visible={alarmModalOpen} transparent animationType="fade" onRequestClose={() => void stopPanicAlarm()}>
        <View style={styles.alarmOverlay}>
          <View style={styles.alarmCard}>
            <Text style={styles.alarmTitle}>{t("ALARM ON", "الإنذار يعمل")}</Text>
            <Text style={styles.alarmSubtitle}>{t("If you are safe, press Stop. Otherwise, send SOS.", "إذا كنت بأمان اضغط إيقاف، وإلا أرسل SOS.")}</Text>

            <View style={styles.row}>
              <Pressable onPress={() => void stopPanicAlarm()} style={({ pressed }) => [styles.sosBtn, pressed && styles.sosBtnPressed]}>
                <Text style={styles.sosBtnText}>{t("STOP ALARM", "إيقاف الإنذار")}</Text>
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
  langRow: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  langBtn: {
    minWidth: 92,
    height: 36,
    borderRadius: theme.radii.md,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  langBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  langBtnPressed: { opacity: 0.92 },
  langBtnText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  langBtnTextActive: { color: "#fff" },
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
