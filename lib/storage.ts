import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  deviceId: "khidmaty:deviceId:v1",
  recentQueries: "khidmaty:recentQueries:v1",
  favorites: "khidmaty:favorites:v1",
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

