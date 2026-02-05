import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  deviceId: "khidmaty:deviceId:v1",
  recentQueries: "khidmaty:recentQueries:v1",
  favorites: "khidmaty:favorites:v1",
  sosContacts: "khidmaty:sos:contacts:v1",
  sosLastSentAt: "khidmaty:sos:lastSentAt:v1",
  sosShakeEnabled: "khidmaty:sos:shakeEnabled:v1",
} as const;

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function uniqPreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const v = String(it || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function uuidv4(): string {
  // RFC4122-ish UUID v4 (good enough for a persisted client id).
  // Uses Math.random for broad compatibility in Expo without extra deps.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string | null> {
  const v = (await AsyncStorage.getItem(KEYS.deviceId).catch(() => null)) || null;
  return v && v.trim() ? v.trim() : null;
}

export async function ensureDeviceId(): Promise<string> {
  const existing = await getDeviceId();
  if (existing) return existing;
  const next = uuidv4();
  await AsyncStorage.setItem(KEYS.deviceId, next);
  return next;
}

export async function getRecentQueries(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.recentQueries).catch(() => null);
  const parsed = safeJsonParse<string[]>(raw);
  return Array.isArray(parsed) ? parsed.map((x) => String(x || "")).filter(Boolean) : [];
}

export async function addRecentQuery(q: string, max = 20): Promise<void> {
  const v = String(q || "").trim();
  if (!v) return;
  const prev = await getRecentQueries();
  const next = uniqPreserveOrder([v, ...prev]).slice(0, Math.max(1, Math.min(50, max)));
  await AsyncStorage.setItem(KEYS.recentQueries, JSON.stringify(next));
}

export async function clearRecentQueries(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.recentQueries).catch(() => null);
}

export async function getFavorites(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.favorites).catch(() => null);
  const parsed = safeJsonParse<string[]>(raw);
  return Array.isArray(parsed) ? uniqPreserveOrder(parsed) : [];
}

export async function isFavorite(key: string): Promise<boolean> {
  const v = String(key || "").trim();
  if (!v) return false;
  const favs = await getFavorites();
  return favs.includes(v);
}

export async function toggleFavorite(key: string): Promise<boolean> {
  const v = String(key || "").trim();
  if (!v) return false;
  const favs = await getFavorites();
  const set = new Set(favs);
  const nextVal = !set.has(v);
  if (nextVal) set.add(v);
  else set.delete(v);
  await AsyncStorage.setItem(KEYS.favorites, JSON.stringify(Array.from(set)));
  return nextVal;
}

export type SosContact = {
  id: string;
  name: string;
  phone: string;
};

export async function getSosContacts(): Promise<SosContact[]> {
  const raw = await AsyncStorage.getItem(KEYS.sosContacts).catch(() => null);
  const parsed = safeJsonParse<SosContact[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((c) => ({
      id: String((c as any)?.id || "").trim(),
      name: String((c as any)?.name || "").trim(),
      phone: String((c as any)?.phone || "").trim(),
    }))
    .filter((c) => c.id && c.name && c.phone)
    .slice(0, 10);
}

export async function saveSosContacts(next: SosContact[]): Promise<void> {
  const clean = (Array.isArray(next) ? next : [])
    .map((c) => ({
      id: String((c as any)?.id || "").trim(),
      name: String((c as any)?.name || "").trim(),
      phone: String((c as any)?.phone || "").trim(),
    }))
    .filter((c) => c.id && c.name && c.phone)
    .slice(0, 10);
  await AsyncStorage.setItem(KEYS.sosContacts, JSON.stringify(clean));
}

export async function getSosLastSentAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(KEYS.sosLastSentAt).catch(() => null);
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function setSosLastSentAt(tsMs: number): Promise<void> {
  const v = Number(tsMs);
  if (!Number.isFinite(v) || v <= 0) return;
  await AsyncStorage.setItem(KEYS.sosLastSentAt, String(Math.trunc(v)));
}

export async function getSosShakeEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEYS.sosShakeEnabled).catch(() => null);
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function setSosShakeEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.sosShakeEnabled, enabled ? "1" : "0");
}

