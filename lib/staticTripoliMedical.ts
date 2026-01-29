import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SearchResult } from "./types";
import { doc, getDocFromServer } from "firebase/firestore";
import { getFirestoreDb } from "./firebase";

// Tripoli medical directory (bundled fallback + optional remote JSON from Firestore settings or URL).
// Remote allows updating data without redeploy; cache keeps it fast and offline-capable.
type TripoliMedicalRow = {
  id?: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  "الفئة"?: string;
  "الاسم"?: string;
  "النوع"?: string;
  "المدينة"?: string;
  "البلدية"?: string;
  "رمز_المرفق"?: string;
  "العنوان"?: string;
  "ملاحظات"?: string;
  "المصدر"?: string;
  [k: string]: any;
};

type CacheMeta = { fetchedAt: number; url?: string };

const CACHE_DATA_KEY = "khidmaty:dir:tripoli-medical:data:v1";
const CACHE_META_KEY = "khidmaty:dir:tripoli-medical:meta:v1";
const REMOTE_REFRESH_MS = 6 * 60 * 60 * 1000; // 6h
const REMOTE_TIMEOUT_MS = 7000;

// IMPORTANT: Expo only inlines `process.env.EXPO_PUBLIC_*` for direct property access.
const REMOTE_URL_OVERRIDE = cleanString(process.env.EXPO_PUBLIC_TRIPOLI_MEDICAL_URL);
const REMOTE_SETTINGS_DOC =
  cleanString(process.env.EXPO_PUBLIC_TRIPOLI_MEDICAL_SETTINGS_DOC) ||
  "tripoli_medical_directory";

// Bundled fallback (works even if Firebase rules/URL are not configured).
const BUNDLED_RAW: unknown = require("../data/tripoli_medical_services_ar.json");
const BUNDLED_ROWS: TripoliMedicalRow[] = Array.isArray(BUNDLED_RAW)
  ? (BUNDLED_RAW as TripoliMedicalRow[])
  : Array.isArray((BUNDLED_RAW as any)?.default)
    ? ((BUNDLED_RAW as any).default as TripoliMedicalRow[])
    : [];

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeNormalize(input: string): string {
  try {
    return input.normalize("NFKD");
  } catch {
    return input;
  }
}

function normalizeForSearch(input: unknown): string {
  const raw = cleanString(input);
  if (!raw) return "";

  let s = safeNormalize(raw);
  // Strip Arabic diacritics + tatweel, then normalize common letter variants.
  s = s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  s = s.replace(/\u0640/g, "");
  s = s
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");

  s = s.toLowerCase();
  // Keep Arabic + latin letters/numbers; replace everything else with spaces.
  s = s.replace(/[^0-9a-z\u0600-\u06FF]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

type IndexEntry = { row: TripoliMedicalRow; haystack: string };

function buildIndex(rows: TripoliMedicalRow[]): IndexEntry[] {
  return rows.map((row) => {
    const name = cleanString(row["الاسم"]);
    const type = cleanString(row["النوع"]);
    const city = cleanString(row["المدينة"]);
    const municipality = cleanString(row["البلدية"]);
    const address = cleanString(row["العنوان"]);
    const notes = cleanString(row["ملاحظات"]);
    const facilityCode = cleanString(row["رمز_المرفق"]);
    const category = cleanString(row["الفئة"]);

    const haystack = normalizeForSearch(
      [name, type, category, city, municipality, address, notes, facilityCode].join(" "),
    );
    return { row, haystack };
  });
}

const BUNDLED_INDEX = buildIndex(BUNDLED_ROWS);

let runtimeRows: TripoliMedicalRow[] | null = null;
let runtimeIndex: IndexEntry[] | null = null;
let runtimeMeta: CacheMeta | null = null;
let cacheLoaded = false;
let remoteRefreshPromise: Promise<void> | null = null;
let remoteRefreshedThisSession = false;
let lastRemoteAttemptAt = 0;
const REMOTE_RETRY_MS = 60 * 1000;

function setRuntime(rows: TripoliMedicalRow[], meta?: CacheMeta) {
  runtimeRows = rows;
  runtimeIndex = buildIndex(rows);
  if (meta) runtimeMeta = meta;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizeLatLon(lat: number, lon: number): { lat: number; lon: number } {
  // Basic sanity swaps (in case an API uses lon/lat ordering).
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) return { lat: lon, lon: lat };
  if (Math.abs(lon) > 180 && Math.abs(lat) <= 180) return { lat: lon, lon: lat };

  // Libya-specific swap heuristic (prevents RTL rendering from "looking swapped" and fixes data where stored as lon,lat).
  const inLibyaLat = (x: number) => x >= 19 && x <= 34.5;
  const inLibyaLon = (x: number) => x >= 9 && x <= 26;
  if (inLibyaLat(lat) && inLibyaLon(lon)) return { lat, lon };
  if (inLibyaLat(lon) && inLibyaLon(lat)) return { lat: lon, lon: lat };

  return { lat, lon };
}

function extractLatLonFromNotes(notesRaw: string): { lat?: number; lon?: number } {
  const notes = cleanString(notesRaw);
  if (!notes) return {};

  // Prefer explicit "الموقع:" field when available.
  const m =
    notes.match(/(?:الموقع|location)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)/i) ??
    notes.match(/([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)/);
  if (!m) return {};

  const a = cleanNumber(m[1]);
  const b = cleanNumber(m[2]);
  if (typeof a !== "number" || typeof b !== "number") return {};

  const norm = normalizeLatLon(a, b);
  return { lat: norm.lat, lon: norm.lon };
}

function extractLatLon(row: TripoliMedicalRow): { lat?: number; lon?: number } {
  const lat = cleanNumber((row as any).lat) ?? cleanNumber((row as any).latitude);
  const lon =
    cleanNumber((row as any).lon) ??
    cleanNumber((row as any).lng) ??
    cleanNumber((row as any).longitude);

  if (typeof lat === "number" && typeof lon === "number") {
    const norm = normalizeLatLon(lat, lon);
    return { lat: norm.lat, lon: norm.lon };
  }

  return extractLatLonFromNotes(cleanString(row["ملاحظات"]));
}

function sanitizeNotes(notesRaw: string): string {
  const notes = cleanString(notesRaw);
  if (!notes) return "";

  // We render coordinates in a dedicated UI section, so remove coord lines from the description
  // to avoid RTL bidi re-ordering making them look swapped.
  const lines = notes
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(?:الموقع|location)\s*[:：]/i.test(l))
    .filter((l) => !/^خط\s*العرض\s*[:：]/i.test(l))
    .filter((l) => !/^خط\s*الطول\s*[:：]/i.test(l));

  return lines.join("\n");
}

async function fetchJsonRowsFromUrl(
  url: string,
): Promise<{ rows: TripoliMedicalRow[]; meta: CacheMeta } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!Array.isArray(json)) return null;
    const rows = json as TripoliMedicalRow[];
    if (rows.length === 0) return null;
    return { rows, meta: { fetchedAt: Date.now(), url } };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadCacheOnce(): Promise<void> {
  if (cacheLoaded) return;
  cacheLoaded = true;

  const [rawData, rawMeta] = await Promise.all([
    AsyncStorage.getItem(CACHE_DATA_KEY).catch(() => null),
    AsyncStorage.getItem(CACHE_META_KEY).catch(() => null),
  ]);

  const rows = safeJsonParse<TripoliMedicalRow[]>(rawData);
  if (Array.isArray(rows) && rows.length > 0) {
    const meta = safeJsonParse<CacheMeta>(rawMeta) || null;
    setRuntime(rows, meta || undefined);
  }
}

async function writeCache(rows: TripoliMedicalRow[], meta: CacheMeta): Promise<void> {
  // Store as JSON string (small enough for AsyncStorage on web + mobile).
  await Promise.all([
    AsyncStorage.setItem(CACHE_DATA_KEY, JSON.stringify(rows)).catch(() => null),
    AsyncStorage.setItem(CACHE_META_KEY, JSON.stringify(meta)).catch(() => null),
  ]);
}

async function fetchRemoteRows(): Promise<{ rows: TripoliMedicalRow[]; meta: CacheMeta } | null> {
  // Option 1: explicit URL override (e.g., hosted on Vercel/GitHub).
  if (REMOTE_URL_OVERRIDE) {
    return fetchJsonRowsFromUrl(`${REMOTE_URL_OVERRIDE}${REMOTE_URL_OVERRIDE.includes("?") ? "&" : "?"}ts=${Date.now()}`);
  }

  // Option 2: Firestore settings document (public read via rules in this repo).
  const db = getFirestoreDb();
  if (!db) return null;

  try {
    const snap = await getDocFromServer(doc(db, "settings", REMOTE_SETTINGS_DOC));
    if (!snap.exists()) return null;

    const data = snap.data() as any;
    const url = cleanString(data?.url) || cleanString(data?.jsonUrl);
    if (url) {
      const remote = await fetchJsonRowsFromUrl(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`);
      if (remote) return remote;
    }

    const jsonString = cleanString(data?.json);
    if (jsonString) {
      const parsed = safeJsonParse<TripoliMedicalRow[]>(jsonString);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { rows: parsed, meta: { fetchedAt: Date.now(), url: `firestore:settings/${REMOTE_SETTINGS_DOC}` } };
      }
    }

    const rows = Array.isArray(data?.rows) ? (data.rows as TripoliMedicalRow[]) : null;
    if (rows && rows.length > 0) {
      return { rows, meta: { fetchedAt: Date.now(), url: `firestore:settings/${REMOTE_SETTINGS_DOC}` } };
    }

    return null;
  } catch {
    return null;
  }
}

async function refreshRemoteIfNeeded(opts: { force?: boolean } = {}): Promise<void> {
  const force = !!opts.force;
  if (remoteRefreshPromise) return remoteRefreshPromise;

  const now = Date.now();
  if (now - lastRemoteAttemptAt < REMOTE_RETRY_MS) return;

  const age = runtimeMeta?.fetchedAt ? Date.now() - runtimeMeta.fetchedAt : Infinity;
  const shouldRefresh = force || !remoteRefreshedThisSession || age >= REMOTE_REFRESH_MS;
  if (!shouldRefresh) return;

  remoteRefreshPromise = (async () => {
    lastRemoteAttemptAt = now;
    const remote = await fetchRemoteRows();
    if (!remote) return;
    setRuntime(remote.rows, remote.meta);
    await writeCache(remote.rows, remote.meta);
    remoteRefreshedThisSession = true;
  })().finally(() => {
    remoteRefreshPromise = null;
  });

  return remoteRefreshPromise;
}

export async function prefetchTripoliMedicalDirectory(): Promise<void> {
  await loadCacheOnce();
  // Refresh in background if cached is old/missing (do not block UI).
  void refreshRemoteIfNeeded({ force: false });
}

function toStaticResult(
  row: TripoliMedicalRow,
  userLocation?: { lat: number; lon: number },
): SearchResult {
  const id = cleanString(row.id) || cleanString(row["رمز_المرفق"]);
  const title = cleanString(row["الاسم"]) || id || "—";
  const city = cleanString(row["المدينة"]) || cleanString(row["البلدية"]) || "طرابلس";
  const category = cleanString(row["النوع"]) || cleanString(row["الفئة"]) || "الخدمات الطبية";

  const address = cleanString(row["العنوان"]);
  const notes = sanitizeNotes(cleanString(row["ملاحظات"]));
  const descriptionParts: string[] = [];
  if (address) descriptionParts.push(address);
  if (notes) descriptionParts.push(`ملاحظات: ${notes}`);
  const description = descriptionParts.join("\n") || undefined;

  const coords = extractLatLon(row);
  const distanceKm =
    userLocation &&
    typeof coords.lat === "number" &&
    typeof coords.lon === "number" &&
    Number.isFinite(userLocation.lat) &&
    Number.isFinite(userLocation.lon)
      ? haversineKm(userLocation, { lat: coords.lat, lon: coords.lon })
      : undefined;

  return {
    id: id || title,
    title,
    type: "service",
    city,
    category,
    description,
    source: "static:tripoli-medical",
    lat: coords.lat,
    lon: coords.lon,
    distanceKm,
  };
}

export async function searchTripoliMedicalDirectory(input: {
  q: string;
  page?: number;
  limit?: number;
  userLocation?: { lat: number; lon: number };
}): Promise<{ query: string; page: number; limit: number; total: number; results: SearchResult[] }> {
  const query = cleanString(input.q);
  const page = Math.max(1, Math.trunc(Number(input.page ?? 1)));
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(input.limit ?? 10))));

  await loadCacheOnce();
  // If we already have cached data, don't block search on remote refresh.
  if (runtimeIndex) void refreshRemoteIfNeeded({ force: false });
  else await refreshRemoteIfNeeded({ force: true });

  const needle = normalizeForSearch(query);
  const tokens = needle ? needle.split(" ").filter(Boolean) : [];
  if (!needle || tokens.length === 0) {
    return { query, page, limit, total: 0, results: [] };
  }

  const index = runtimeIndex || BUNDLED_INDEX;
  const matched = index.filter((x) => tokens.every((t) => x.haystack.includes(t))).map((x) => x.row);
  const resultsAll = matched.map((row) => toStaticResult(row, input.userLocation));

  // If we have a user location, sort by distance (near me). Unknown distances go last.
  if (input.userLocation && Number.isFinite(input.userLocation.lat) && Number.isFinite(input.userLocation.lon)) {
    resultsAll.sort((a, b) => {
      const da = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
      const db = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return String(a.title).localeCompare(String(b.title), "ar");
    });
  }

  const total = resultsAll.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const results = resultsAll.slice(start, end);

  return { query, page, limit, total, results };
}
