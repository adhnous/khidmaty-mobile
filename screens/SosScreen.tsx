import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { theme } from "../lib/theme";
import { arText } from "../lib/translations";
import { findNearestCity, formatCityLabel } from "../lib/cityData";
import {
  ensureDeviceId,
  getSosContacts,
  getSosLastSentAt,
  saveSosContacts,
  setSosLastSentAt,
  type SosContact,
} from "../lib/storage";
import { sendSosAlert } from "../lib/api";
import { searchTripoliMedicalDirectory } from "../lib/staticTripoliMedical";
import { ResultCard, ResultCardSkeleton } from "../components/ResultCard";
import type { SearchResult, UserLocation } from "../lib/types";

type Props = NativeStackScreenProps<RootStackParamList, "SOS">;

function now() {
  return Date.now();
}

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanPhoneForWa(phone: string): string {
  // WhatsApp wa.me expects only digits with country code (no +, spaces, or symbols).
  return phone.replace(/[^\d]+/g, "");
}

function buildMapsUrl(lat: number, lon: number): string {
  // Google Maps works everywhere (including iOS web). Keep it simple for SOS.
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function buildAutoInfo(opts: { lat?: number; lon?: number; city?: string }): string {
  const parts: string[] = [];
  if (opts.city) parts.push(`City: ${opts.city}`);
  if (typeof opts.lat === "number" && typeof opts.lon === "number") {
    parts.push(`Location: ${buildMapsUrl(opts.lat, opts.lon)}`);
    parts.push(`Coords: ${opts.lat.toFixed(6)}, ${opts.lon.toFixed(6)}`);
  }
  return parts.join("\n");
}

export default function SosScreen({ navigation }: Props) {
  const [coords, setCoords] = useState<UserLocation | null>(null);
  const [city, setCity] = useState<string>("");
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const [baseMessage, setBaseMessage] = useState<string>(
    "SOS: I need urgent help.\nالنجدة: أحتاج مساعدة عاجلة.",
  );
  const autoInfo = useMemo(() => buildAutoInfo({ lat: coords?.lat, lon: coords?.lon, city: city || "" }), [coords, city]);
  const fullMessage = useMemo(() => {
    const msg = cleanString(baseMessage);
    const info = cleanString(autoInfo);
    if (msg && info) return `${msg}\n\n${info}`;
    return msg || info;
  }, [baseMessage, autoInfo]);

  const [contacts, setContacts] = useState<SosContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const inLibya = !!findNearestCity(coords?.lat ?? NaN, coords?.lon ?? NaN);

  const [helpTab, setHelpTab] = useState<"hospitals" | "clinics" | "pharmacies">("hospitals");
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpResults, setHelpResults] = useState<SearchResult[]>([]);
  const [helpError, setHelpError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await getSosContacts();
        if (!alive) return;
        setContacts(rows);
      } finally {
        if (alive) setContactsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function persistContacts(next: SosContact[]) {
    setContacts(next);
    await saveSosContacts(next).catch(() => null);
  }

  async function refreshLocation() {
    setLocError(null);
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) throw new Error("Permission denied");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const nearest = findNearestCity(lat, lon);

      setCoords({ lat, lon });
      if (nearest) setCity(nearest.value);
      else setCity("");

      if (!nearest) setLocError(arText.locationNotNear);
    } catch (err: any) {
      const message =
        err?.message === "Permission denied" ? arText.locationPermission : arText.locationUnavailable;
      setLocError(message);
      setCoords(null);
      setCity("");
    } finally {
      setLocLoading(false);
    }
  }

  async function loadNearbyHelp(nextTab: typeof helpTab) {
    setHelpTab(nextTab);
    setHelpError(null);

    if (!coords || !inLibya) {
      setHelpResults([]);
      setHelpError("Enable GPS in Libya to see nearby help.");
      return;
    }

    // Currently we only have a bundled Tripoli medical directory. Keep it explicit.
    const isTripoli = city && city.toLowerCase() === "tripoli";
    if (!isTripoli) {
      setHelpResults([]);
      setHelpError("Nearby medical directory is currently available for Tripoli only.");
      return;
    }

    const q =
      nextTab === "pharmacies" ? "صيدلية" : nextTab === "clinics" ? "عيادة" : "مستشفى";

    setHelpLoading(true);
    try {
      const res = await searchTripoliMedicalDirectory({
        q,
        page: 1,
        limit: 5,
        userLocation: coords,
      });
      setHelpResults(res.results);
      if (res.total === 0) setHelpError("No nearby matches found.");
    } catch {
      setHelpResults([]);
      setHelpError("Could not load nearby help. Try again.");
    } finally {
      setHelpLoading(false);
    }
  }

  function openAddContact() {
    setEditingId(null);
    setFormName("");
    setFormPhone("");
    setContactModalOpen(true);
  }

  function openEditContact(c: SosContact) {
    setEditingId(c.id);
    setFormName(c.name);
    setFormPhone(c.phone);
    setContactModalOpen(true);
  }

  async function saveContact() {
    const name = cleanString(formName);
    const phone = cleanString(formPhone);
    if (!name || !phone) {
      Alert.alert("Missing info", "Please enter name and phone.");
      return;
    }

    if (editingId) {
      const next = contacts.map((c) => (c.id === editingId ? { ...c, name, phone } : c));
      await persistContacts(next);
    } else {
      const next: SosContact = { id: makeId(), name, phone };
      await persistContacts([next, ...contacts].slice(0, 10));
    }
    setContactModalOpen(false);
  }

  async function deleteContact(id: string) {
    const next = contacts.filter((c) => c.id !== id);
    await persistContacts(next);
  }

  async function shareSos() {
    const msg = cleanString(fullMessage);
    if (!msg) return;
    try {
      await Share.share({ message: msg });
    } catch {
      // ignore
    }
  }

  async function callPhone(phone: string) {
    const p = cleanString(phone);
    if (!p) return;
    try {
      await Linking.openURL(`tel:${p}`);
    } catch {
      // ignore
    }
  }

  async function smsPhone(phone: string) {
    const p = cleanString(phone);
    if (!p) return;
    const msg = encodeURIComponent(cleanString(fullMessage));
    const sep = Platform.OS === "ios" ? "&" : "?";
    const url = `sms:${p}${msg ? `${sep}body=${msg}` : ""}`;
    try {
      await Linking.openURL(url);
    } catch {
      // ignore
    }
  }

  async function whatsappPhone(phone: string) {
    const digits = cleanPhoneForWa(phone);
    if (!digits) return;
    const msg = encodeURIComponent(cleanString(fullMessage));
    const url = `https://wa.me/${digits}${msg ? `?text=${msg}` : ""}`;
    try {
      await Linking.openURL(url);
    } catch {
      // ignore
    }
  }

  async function sendToTelegram() {
    setSendError(null);
    const msg = cleanString(fullMessage);
    if (!msg) {
      setSendError("Message is empty.");
      return;
    }

    // Basic local rate limit to reduce accidental spam.
    const last = await getSosLastSentAt().catch(() => null);
    if (last && now() - last < 30_000) {
      setSendError("Please wait 30 seconds before sending another SOS.");
      return;
    }

    setSending(true);
    try {
      const deviceId = await ensureDeviceId();
      const res = await sendSosAlert({
        message: msg,
        city: city || undefined,
        lat: coords?.lat,
        lon: coords?.lon,
        deviceId,
        source: Platform.OS === "web" ? "khidmaty-web" : "khidmaty-mobile",
      });
      if (res.ok === false) throw new Error("not_ok");
      await setSosLastSentAt(now()).catch(() => null);
      Alert.alert("Sent", "Your SOS alert was sent to the community channel.");
    } catch {
      setSendError("Could not send SOS. Check your internet and try again.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    // Preload tab content after we have location.
    if (!coords) return;
    void loadNearbyHelp(helpTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lon]);

  const cityLabel = city ? formatCityLabel(city, "ar") : "";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>SOS</Text>
          <Text style={styles.heroSub}>
            This is a community tool. It does not connect to official emergency services.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location</Text>
          <Text style={styles.metaText}>
            {coords ? `Coords: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}` : "No GPS location yet."}
          </Text>
          {cityLabel ? <Text style={styles.metaText}>City: {cityLabel}</Text> : null}
          {locError ? <Text style={styles.errorText}>{locError}</Text> : null}

          <Pressable
            onPress={() => void refreshLocation()}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            disabled={locLoading}
          >
            {locLoading ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.primaryBtnText}>
              {locLoading ? "Getting location..." : arText.useLocation}
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>SOS Message</Text>
          <Text style={styles.hintText}>Edit the text below. We will append your GPS link automatically.</Text>
          <TextInput
            value={baseMessage}
            onChangeText={setBaseMessage}
            placeholder="Describe your emergency..."
            multiline
            style={[styles.input, styles.inputMulti]}
          />
          {autoInfo ? (
            <View style={styles.autoInfoBox}>
              <Text style={styles.autoInfoTitle}>Auto info</Text>
              <Text style={styles.autoInfoText}>{autoInfo}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <Pressable
              onPress={() => void shareSos()}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
            >
              <Text style={styles.secondaryBtnText}>Share</Text>
            </Pressable>
            <Pressable
              onPress={() => void sendToTelegram()}
              disabled={sending}
              style={({ pressed }) => [
                styles.sosBtn,
                pressed && !sending && styles.sosBtnPressed,
                sending && styles.sosBtnDisabled,
              ]}
            >
              {sending ? <ActivityIndicator color="#fff" /> : null}
              <Text style={styles.sosBtnText}>{sending ? "Sending..." : "Send SOS to Telegram"}</Text>
            </Pressable>
          </View>
          {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Emergency Contacts</Text>
            <Pressable onPress={openAddContact} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Add</Text>
            </Pressable>
          </View>

          {contactsLoading ? (
            <Text style={styles.metaText}>Loading...</Text>
          ) : contacts.length === 0 ? (
            <Text style={styles.metaText}>Add at least 1 contact for calling/WhatsApp/SMS.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {contacts.map((c) => (
                <View key={c.id} style={styles.contactRow}>
                  <Pressable onPress={() => openEditContact(c)} style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactPhone}>{c.phone}</Text>
                  </Pressable>
                  <View style={styles.contactActions}>
                    <Pressable onPress={() => void callPhone(c.phone)} style={styles.actionBtn}>
                      <Text style={styles.actionBtnText}>Call</Text>
                    </Pressable>
                    <Pressable onPress={() => void whatsappPhone(c.phone)} style={styles.actionBtn}>
                      <Text style={styles.actionBtnText}>WA</Text>
                    </Pressable>
                    <Pressable onPress={() => void smsPhone(c.phone)} style={styles.actionBtn}>
                      <Text style={styles.actionBtnText}>SMS</Text>
                    </Pressable>
                    <Pressable onPress={() => void deleteContact(c.id)} style={[styles.actionBtn, styles.actionBtnDanger]}>
                      <Text style={[styles.actionBtnText, { color: theme.colors.danger }]}>X</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nearby Medical Help (Tripoli)</Text>
          <Text style={styles.hintText}>Hospitals, clinics, and pharmacies from the Tripoli directory.</Text>

          <View style={styles.tabsRow}>
            {[
              { id: "hospitals" as const, label: "Hospitals" },
              { id: "clinics" as const, label: "Clinics" },
              { id: "pharmacies" as const, label: "Pharmacies" },
            ].map((t) => {
              const selected = t.id === helpTab;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => void loadNearbyHelp(t.id)}
                  style={[styles.tab, selected && styles.tabSelected]}
                >
                  <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {helpLoading ? (
            <View style={{ gap: 10, marginTop: 10 }}>
              <ResultCardSkeleton />
              <ResultCardSkeleton />
            </View>
          ) : helpError ? (
            <Text style={styles.errorText}>{helpError}</Text>
          ) : (
            <View style={{ gap: 10, marginTop: 10 }}>
              {helpResults.map((r) => (
                <ResultCard
                  key={r.id}
                  result={r}
                  onPress={() => navigation.navigate("ListingDetail", { result: r })}
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>

      <Modal visible={contactModalOpen} transparent animationType="fade" onRequestClose={() => setContactModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingId ? "Edit contact" : "Add contact"}</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput value={formName} onChangeText={setFormName} style={styles.modalInput} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput value={formPhone} onChangeText={setFormPhone} style={styles.modalInput} />
              <Text style={styles.hintText}>Tip: WhatsApp works best with country code (e.g. 218...).</Text>
            </View>

            <View style={styles.modalActions}>
              <Pressable onPress={() => setContactModalOpen(false)} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>{arText.cancel}</Text>
              </Pressable>
              <Pressable onPress={() => void saveContact()} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.chatBg },
  content: { padding: 12, gap: 12 },
  hero: {
    padding: 14,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  heroTitle: { fontSize: 22, fontWeight: "900", color: theme.colors.text },
  heroSub: { marginTop: 6, fontSize: 12, color: theme.colors.text2, fontWeight: "700" },
  card: {
    padding: 14,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 10,
    ...theme.shadow,
  },
  cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  metaText: { fontSize: 12, color: theme.colors.text2, fontWeight: "700" },
  hintText: { fontSize: 12, color: theme.colors.text2, fontWeight: "600" },
  errorText: { marginTop: 6, fontSize: 12, color: theme.colors.danger, fontWeight: "800" },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: "#F9FAFB",
  },
  inputMulti: { minHeight: 90, textAlignVertical: "top" },
  autoInfoBox: {
    padding: 10,
    borderRadius: theme.radii.md,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  autoInfoTitle: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  autoInfoText: { fontSize: 12, color: theme.colors.text2, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  primaryBtn: {
    marginTop: 8,
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
    flex: 1,
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
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: "rgba(42,171,238,0.10)",
    borderWidth: 1,
    borderColor: "rgba(42,171,238,0.30)",
  },
  smallBtnText: { fontSize: 12, fontWeight: "900", color: theme.colors.chatBubbleOut },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#F9FAFB",
  },
  contactName: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  contactPhone: { marginTop: 2, fontSize: 12, color: theme.colors.text2, fontWeight: "700" },
  contactActions: { flexDirection: "row", gap: 6, alignItems: "center" },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
  },
  actionBtnDanger: { backgroundColor: "rgba(229,33,23,0.08)", borderColor: "rgba(229,33,23,0.18)" },
  actionBtnText: { fontSize: 12, fontWeight: "900", color: theme.colors.primary },
  tabsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  tabSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tabText: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  tabTextSelected: { color: "#fff" },
  footerSpace: { height: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: 14,
    gap: 12,
    ...theme.shadow,
  },
  modalTitle: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  modalInput: {
    height: 44,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 6 },
});
