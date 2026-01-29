import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { createLead } from "../lib/api";
import { useChat, createMessageId } from "../lib/chat";
import { ensureDeviceId, isFavorite, toggleFavorite } from "../lib/storage";
import { getFirestoreDb } from "../lib/firebase";
import { doc, getDocFromServer } from "firebase/firestore";
import { theme } from "../lib/theme";
import { getApiBaseUrl } from "../lib/apiBase";

type Props = NativeStackScreenProps<RootStackParamList, "ListingDetail">;

function formatMoney(priceFrom?: number): string {
  if (typeof priceFrom !== "number" || !Number.isFinite(priceFrom) || priceFrom <= 0) return "—";
  return `${Math.round(priceFrom)} LYD`;
}

function formatRating(rating?: number): string {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0) return "—";
  return `${rating.toFixed(1)}*`;
}

type RemoteDetails = { description?: string; thumb?: string };

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function resolveAssetUrl(input: unknown): string | undefined {
  const url = cleanString(input);
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("file:")) return url;
  if (url.startsWith("/")) return `${getApiBaseUrl()}${url}`;
  return url;
}

function firstImageUrl(images: any): string | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const first = images[0];
  if (typeof first === "string") return resolveAssetUrl(first);
  return (
    resolveAssetUrl(first?.url) ||
    resolveAssetUrl(first?.displayUrl) ||
    resolveAssetUrl(first?.src) ||
    undefined
  );
}

export default function ListingDetailScreen({ navigation, route }: Props) {
  const result = route.params.result;
  const { append } = useChat();

  const isStatic = typeof result.source === "string" && result.source.startsWith("static:");

  const favoriteKey = useMemo(() => `${result.type}:${result.id}`, [result.id, result.type]);

  const [fav, setFav] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [remoteDetails, setRemoteDetails] = useState<RemoteDetails | null>(null);
  const [heroError, setHeroError] = useState(false);

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const v = await isFavorite(favoriteKey);
      if (alive) setFav(v);
    })();
    return () => {
      alive = false;
    };
  }, [favoriteKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isStatic) return;
      if (result.type === "provider") return;
      const db = getFirestoreDb();
      if (!db) return;

      const collectionName = result.type === "item" ? "sale_items" : "services";

      try {
        const snap = await getDocFromServer(doc(db, collectionName, result.id));
        if (!alive) return;
        if (!snap.exists()) return;

        const data = snap.data() as any;
        const description = cleanString(data?.description) || undefined;
        const thumb =
          firstImageUrl(data?.images) ||
          resolveAssetUrl(data?.thumb) ||
          resolveAssetUrl(data?.imageUrl) ||
          resolveAssetUrl(data?.photoURL) ||
          undefined;

        if (description || thumb) setRemoteDetails({ description, thumb });
      } catch {
        // Optional enhancement only; ignore failures and keep UI functional.
      }
    })();
    return () => {
      alive = false;
    };
  }, [isStatic, result.id, result.type]);

  async function onToggleFavorite() {
    const next = await toggleFavorite(favoriteKey);
    setFav(next);
  }

  async function onSubmitQuote() {
    const nm = name.trim();
    const ct = contact.trim();
    const msg = message.trim();

    setModalError(null);
    if (!nm || !ct || !msg) {
      setModalError("Please fill name, contact, and message.");
      return;
    }

    setSubmitting(true);
    try {
      const deviceId = await ensureDeviceId();
      const listingId = `${result.type}:${result.id}`;
      const res = await createLead({ listingId, name: nm, contact: ct, message: msg, deviceId });

      const leadId = res?.leadId ? String(res.leadId) : "";
      append({
        id: createMessageId(),
        role: "bot",
        kind: "status",
        text: leadId ? `Request sent ✅\nLead: ${leadId}` : "Request sent ✅",
        createdAt: Date.now(),
      });

      setModalError(null);
      setModalOpen(false);
      setName("");
      setContact("");
      setMessage("");
      navigation.goBack();
    } catch {
      setModalError("Could not send. Try again.");
      append({
        id: createMessageId(),
        role: "bot",
        kind: "status",
        text: "Could not send. Try again.",
        createdAt: Date.now(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const displayThumb = remoteDetails?.thumb ?? resolveAssetUrl(result.thumb);
  const displayDescription = remoteDetails?.description ?? result.description;
  const coords =
    typeof result.lat === "number" &&
    typeof result.lon === "number" &&
    Number.isFinite(result.lat) &&
    Number.isFinite(result.lon)
      ? { lat: result.lat, lon: result.lon }
      : null;
  // Apple blocks `maps.apple.com` on many non-Apple desktop browsers (403).
  // So only use Apple Maps on native iOS; use Google Maps everywhere else (including web).
  const preferAppleMaps = Platform.OS === "ios";

  useEffect(() => {
    setHeroError(false);
  }, [displayThumb]);

  async function openInMaps() {
    if (!coords) return;
    const lat = coords.lat;
    const lon = coords.lon;
    const title = encodeURIComponent(result.title || "Khidmaty");

    const url = preferAppleMaps
      ? `http://maps.apple.com/?ll=${lat},${lon}&q=${title}`
      : `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

    try {
      await Linking.openURL(url);
    } catch {
      // ignore
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {displayThumb && !heroError ? (
            <Image
              source={{ uri: displayThumb }}
              style={styles.heroImg}
              resizeMode="cover"
              onError={() => setHeroError(true)}
            />
          ) : (
            <View style={styles.heroFallback}>
              <Text style={styles.heroFallbackText}>{result.type.toUpperCase()}</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{result.title}</Text>
            <Pressable
              onPress={onToggleFavorite}
              style={[styles.favBtn, fav && styles.favBtnOn]}
            >
              <Text style={[styles.favText, fav && styles.favTextOn]}>{fav ? "♥" : "♡"}</Text>
            </Pressable>
          </View>

          <View style={styles.badgeRow}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{result.type}</Text>
            </View>
            {result.city ? <Text style={styles.metaText}>{result.city}</Text> : null}
            {result.category ? <Text style={styles.metaText}>{result.category}</Text> : null}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Price from</Text>
              <Text style={styles.statValue}>{formatMoney(result.priceFrom)}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Rating</Text>
              <Text style={styles.statValue}>{formatRating(result.rating)}</Text>
            </View>
          </View>

          {coords ? (
            <View style={styles.coordBox}>
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Lat</Text>
                <Text style={styles.coordValue}>{coords.lat.toFixed(6)}</Text>
              </View>
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Lon</Text>
                <Text style={styles.coordValue}>{coords.lon.toFixed(6)}</Text>
              </View>
              <Pressable onPress={() => void openInMaps()} style={styles.mapsBtn}>
                <Text style={styles.mapsBtnText}>
                  {preferAppleMaps ? "Open in Apple Maps" : "Open in Google Maps"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.descBox}>
            <Text style={styles.descTitle}>Description</Text>
            <Text style={styles.descText}>{displayDescription || "No description available."}</Text>
          </View>

          {!isStatic ? (
            <Pressable
              onPress={() => {
                setModalError(null);
                setModalOpen(true);
              }}
              style={styles.quoteBtn}
            >
              <Text style={styles.quoteBtnText}>Request Quote</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setModalOpen(false);
          setModalError(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Quote</Text>
              <Pressable
                onPress={() => {
                  setModalOpen(false);
                  setModalError(null);
                }}
                hitSlop={10}
              >
                <Text style={styles.modalClose}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.modalHint}>Send your request via n8n (no login).</Text>

            {modalError ? (
              <View style={styles.modalError}>
                <Text style={styles.modalErrorText}>{modalError}</Text>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor="#9CA3AF"
                style={styles.fieldInput}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Phone / Email</Text>
              <TextInput
                value={contact}
                onChangeText={setContact}
                placeholder="Contact"
                placeholderTextColor="#9CA3AF"
                style={styles.fieldInput}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Message</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="What do you need?"
                placeholderTextColor="#9CA3AF"
                style={[styles.fieldInput, styles.fieldInputMultiline]}
                multiline
              />
            </View>

            <Pressable
              onPress={() => void onSubmitQuote()}
              disabled={submitting}
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            >
              <Text style={styles.submitBtnText}>{submitting ? "Sending..." : "Send request"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 12, gap: 12 },
  hero: {
    height: 220,
    borderRadius: theme.radii.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heroImg: { width: "100%", height: "100%" },
  heroFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroFallbackText: { fontSize: 14, fontWeight: "900", color: theme.colors.text2, letterSpacing: 1 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
    ...theme.shadow,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  title: { flex: 1, fontSize: 18, fontWeight: "900", color: theme.colors.text },
  favBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  favBtnOn: { backgroundColor: "rgba(220,38,38,0.10)", borderColor: "rgba(220,38,38,0.18)" },
  favText: { fontSize: 18, color: theme.colors.text, fontWeight: "900" },
  favTextOn: { color: theme.colors.danger },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
  },
  typeBadgeText: { fontSize: 12, fontWeight: "900", color: theme.colors.primary },
  metaText: { fontSize: 12, fontWeight: "800", color: theme.colors.text2 },
  statsRow: { flexDirection: "row", gap: 10 },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: theme.radii.md,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statLabel: { fontSize: 11, fontWeight: "900", color: theme.colors.text2 },
  statValue: { marginTop: 4, fontSize: 16, fontWeight: "900", color: theme.colors.text },
  coordBox: {
    padding: 12,
    borderRadius: theme.radii.md,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  coordRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  coordLabel: { fontSize: 12, fontWeight: "900", color: theme.colors.text2 },
  coordValue: { fontSize: 12, fontWeight: "900", color: theme.colors.text, writingDirection: "ltr" },
  mapsBtn: {
    height: 42,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.chatBubbleOut,
  },
  mapsBtnText: { fontSize: 13, fontWeight: "900", color: theme.colors.snow },
  descBox: {
    padding: 12,
    borderRadius: theme.radii.md,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  descTitle: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  descText: { fontSize: 13, color: theme.colors.text },
  quoteBtn: {
    height: 48,
    borderRadius: theme.radii.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  quoteBtnText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  modalClose: { fontSize: 28, fontWeight: "900", color: theme.colors.text2 },
  modalHint: { fontSize: 12, color: theme.colors.text2 },
  modalError: {
    padding: 10,
    borderRadius: theme.radii.md,
    backgroundColor: "rgba(220,38,38,0.08)",
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.18)",
  },
  modalErrorText: { fontSize: 12, fontWeight: "800", color: theme.colors.danger },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  fieldInput: {
    height: 44,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
  },
  fieldInputMultiline: {
    height: 100,
    paddingTop: 10,
    textAlignVertical: "top",
  },
  submitBtn: {
    height: 48,
    borderRadius: theme.radii.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  submitBtnDisabled: { opacity: 0.65 },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "900" },
});
