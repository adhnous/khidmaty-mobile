import type { SearchFilters, SearchResponse, SearchResult, UserLocation } from "./types";
import { getApiBaseUrl, getN8nBaseUrl } from "./apiBase";
import { searchTripoliMedicalDirectory } from "./staticTripoliMedical";
import { cityList } from "./cityData";

type QueryParams = Record<string, string | number | boolean | null | undefined>;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(err: any): boolean {
  const status = Number(err?.status ?? NaN);
  if (Number.isFinite(status)) return status >= 500 || status === 0;
  if (err?.name === "AbortError") return true;
  // RN fetch often throws TypeError on network failures.
  if (err instanceof TypeError) return true;
  return false;
}

function cleanString(v: any): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function normalizeAssetUrl(input: any): string | undefined {
  const url = cleanString(input);
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("file:")) return url;
  if (url.startsWith("/")) return joinUrl(getApiBaseUrl(), url);
  return url;
}

function cleanNumber(v: any): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeResult(raw: any): SearchResult {
  const typeRaw = String(raw?.type || "").toLowerCase();
  const type: SearchResult["type"] =
    typeRaw === "provider" ? "provider" : typeRaw === "item" ? "item" : "service";

  return {
    id: String(raw?.id || ""),
    title: String(raw?.title || ""),
    type,
    city: cleanString(raw?.city),
    category: cleanString(raw?.category),
    priceFrom: cleanNumber(raw?.priceFrom),
    rating: cleanNumber(raw?.rating),
    thumb: normalizeAssetUrl(raw?.thumb),
    description: cleanString(raw?.description),
    source: cleanString(raw?.source),
    lat: cleanNumber(raw?.lat ?? raw?.latitude),
    lon: cleanNumber(raw?.lon ?? raw?.lng ?? raw?.longitude),
    distanceKm: cleanNumber(raw?.distanceKm ?? raw?.distance_km),
  };
}

function normalizeSearchResponse(json: any): SearchResponse {
  const query = String(json?.query || "");
  const page = Number(json?.page ?? 1) || 1;
  const limit = Number(json?.limit ?? 10) || 10;
  const total = Number(json?.total ?? 0) || 0;
  const resultsRaw = Array.isArray(json?.results) ? json.results : [];
  const results = resultsRaw
    .map(normalizeResult)
    .filter((r: SearchResult) => r.id && r.title);
  return { query, page, limit, total, results };
}

function joinUrl(base: string, path: string): string {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "");
  if (!p) return b;
  if (p.startsWith("/")) return `${b}${p}`;
  return `${b}/${p}`;
}

function toSearchParams(params?: QueryParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (!params) return sp;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const str = typeof v === "string" ? v : String(v);
    sp.set(k, str);
  }
  return sp;
}

async function fetchJson<T>(
  url: string,
  opts: { method?: "GET" | "POST"; timeoutMs?: number; body?: any; headers?: Record<string, string> } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = {
      ...(opts.headers || {}),
    };
    let body: string | undefined;
    if (method !== "GET" && opts.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const err = new Error(typeof json?.error === "string" ? json.error : res.statusText || "request_failed");
      (err as any).status = res.status;
      (err as any).detail = typeof json?.detail === "string" ? json.detail : undefined;
      throw err;
    }
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiGet<T = any>(
  path: string,
  params?: QueryParams,
  opts?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<T> {
  const base = getApiBaseUrl();
  const sp = toSearchParams(params);
  const qs = sp.toString();
  const url = joinUrl(base, path) + (qs ? `?${qs}` : "");
  return fetchJson<T>(url, { method: "GET", timeoutMs: opts?.timeoutMs, headers: opts?.headers });
}

export async function apiPost<T = any>(
  path: string,
  body: any,
  opts?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<T> {
  const base = getApiBaseUrl();
  const url = joinUrl(base, path);
  return fetchJson<T>(url, { method: "POST", body, timeoutMs: opts?.timeoutMs, headers: opts?.headers });
}

export async function searchApi(input: {
  q: string;
  filters: SearchFilters;
  page?: number;
  limit?: number;
  userLocation?: UserLocation;
}): Promise<SearchResponse> {
  const json = await apiGet<any>("/api/search", {
    q: input.q,
    type: input.filters.type,
    city: input.filters.city.trim() || undefined,
    category: input.filters.category.trim() || undefined,
    page: input.page ?? 1,
    limit: input.limit ?? 10,
  });
  return normalizeSearchResponse(json);
}

export async function searchApiWithRetry(
  input: Parameters<typeof searchApi>[0],
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<SearchResponse> {
  const retries = Math.max(0, Math.min(3, Math.trunc(Number(opts.retries ?? 1))));
  const retryDelayMs = Math.max(200, Math.min(2000, Math.trunc(Number(opts.retryDelayMs ?? 600))));

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await searchApi(input);
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryableError(err)) throw err;
      await sleep(retryDelayMs);
    }
  }
}

export type ChatSearchResponse = SearchResponse & {
  assistantText?: string;
  suggestions?: string[];
};

type BloodDonorItem = {
  id: string;
  name?: string;
  bloodType?: string;
  city?: string;
  phone?: string;
  notes?: string;
  rare?: boolean;
  availability?: string;
  responseCount?: number;
};

const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;

function normalizeBloodType(raw: string): string | undefined {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return undefined;
  const m = s.match(/^(A|B|AB|O)([+-])$/);
  if (!m) return undefined;
  return `${m[1]}${m[2]}`;
}

function parseBloodTypeFromText(text: string): string | undefined {
  const s = String(text || "").toUpperCase();
  const m = s.match(/\b(AB|A|B|O)\s*([+-])\b/);
  if (!m) return undefined;
  return normalizeBloodType(`${m[1]}${m[2]}`);
}

function looksLikeBloodDonorQuery(input: Parameters<typeof searchApi>[0]): boolean {
  const q = String(input.q || "").trim().toLowerCase();
  if (!q) return false;
  if (parseBloodTypeFromText(q)) return true;
  return (
    q.includes("blood") ||
    q.includes("donor") ||
    q.includes("donors") ||
    q.includes("دم") ||
    q.includes("تبرع") ||
    q.includes("متبرع") ||
    q.includes("فصيلة") ||
    q.includes("زمرة")
  );
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

function cityCenterLatLon(city: string): { lat: number; lon: number } | null {
  const raw = String(city || "").trim();
  if (!raw) return null;
  const needle = raw.toLowerCase();
  const found = cityList.find(
    (c) => c.center && (c.value.toLowerCase() === needle || c.ar.toLowerCase() === needle),
  );
  if (!found?.center) return null;
  return { lat: found.center.lat, lon: found.center.lng };
}

function donorToResult(d: BloodDonorItem, userLocation?: UserLocation): SearchResult {
  const id = String(d.id || "");
  const name = String(d.name || "").trim() || "متبرع بالدم";
  const bloodType = normalizeBloodType(String(d.bloodType || ""));
  const city = cleanString(d.city);
  const phone = cleanString(d.phone);
  const notes = cleanString(d.notes);
  const rare = !!d.rare;
  const availability = cleanString(d.availability);

  const descriptionParts: string[] = [];
  if (bloodType) descriptionParts.push(`فصيلة الدم: ${bloodType}${rare ? " (نادر)" : ""}`);
  if (availability) descriptionParts.push(`الحالة: ${availability}`);
  if (phone) descriptionParts.push(`هاتف: ${phone}`);
  if (notes) descriptionParts.push(`ملاحظات: ${notes}`);

  // Approximate "near me" using the center of the donor's city (we don't store exact GPS for donors).
  const center = city ? cityCenterLatLon(city) : null;
  const distanceKm = userLocation && center ? haversineKm(userLocation, center) : undefined;

  return {
    id: `blood_donor:${id}`,
    title: bloodType ? `${name} (${bloodType})` : name,
    type: "service",
    city: city,
    category: "متبرع بالدم",
    description: descriptionParts.length ? descriptionParts.join("\n") : undefined,
    source: "static:blood-donors",
    distanceKm,
  };
}

function shouldUseStaticTripoliMedical(input: Parameters<typeof searchApi>[0]): boolean {
  // Static dataset is a services directory for Tripoli only.
  if (input.filters.type === "items" || input.filters.type === "providers") return false;

  const city = input.filters.city.trim();
  if (!city) return true;
  return city.toLowerCase() === "tripoli" || city.includes("طرابلس");
}

function uniqStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function buildStaticTripoliMedicalResponse(
  input: Parameters<typeof searchApi>[0],
): Promise<ChatSearchResponse | null> {
  if (!shouldUseStaticTripoliMedical(input)) return null;

  const local = await searchTripoliMedicalDirectory({
    q: input.q,
    page: input.page ?? 1,
    limit: input.limit ?? 10,
    userLocation: input.userLocation,
  });
  if (local.total <= 0) return null;

  const suggestions = uniqStrings(local.results.map((r) => r.category || "").filter(Boolean)).slice(0, 8);
  const assistantText = `تم العثور على ${local.total} نتيجة من دليل الخدمات الطبية (طرابلس) (بيانات ثابتة) لـ "${local.query}".`;

  return {
    ...local,
    assistantText,
    suggestions: suggestions.length ? suggestions : undefined,
  };
}

async function buildBloodDonorsResponse(
  input: Parameters<typeof searchApi>[0],
): Promise<ChatSearchResponse | null> {
  if (!looksLikeBloodDonorQuery(input)) return null;
  if (input.filters.type === "items") return null;

  const q = String(input.q || "").trim();
  const page = Math.max(1, Math.trunc(Number(input.page ?? 1)));
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(input.limit ?? 10))));

  const bloodType = parseBloodTypeFromText(q);
  const rareOnly = /نادر|rare/i.test(q);

  const json = await apiGet<any>("/api/blood-donors/list", {
    city: input.filters.city.trim() || undefined,
    bloodType: bloodType || undefined,
    rareOnly: rareOnly ? true : undefined,
  });

  const items: BloodDonorItem[] = Array.isArray(json?.items) ? (json.items as BloodDonorItem[]) : [];

  const needle = q.toLowerCase();
  const filtered = items.filter((d) => {
    if (!needle) return true;
    const fields = [
      String(d?.name || ""),
      String(d?.bloodType || ""),
      String(d?.city || ""),
      String(d?.phone || ""),
      String(d?.notes || ""),
    ]
      .join(" ")
      .toLowerCase();
    return fields.includes(needle) || (!!bloodType && String(d?.bloodType || "").toUpperCase().includes(bloodType));
  });

  const resultsAll = filtered.map((d) => donorToResult(d, input.userLocation));
  if (input.userLocation) {
    resultsAll.sort((a, b) => {
      const da = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
      const db = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return String(a.title).localeCompare(String(b.title), "ar");
    });
  }

  const total = resultsAll.length;
  if (total <= 0) return null;

  const start = (page - 1) * limit;
  const results = resultsAll.slice(start, start + limit);

  return {
    query: q,
    page,
    limit,
    total,
    results,
    assistantText: `تم العثور على ${total} متبرع بالدم.`,
    suggestions: BLOOD_TYPES.slice(0, 8) as unknown as string[],
  };
}

async function applyStaticTripoliFallback(
  input: Parameters<typeof searchApi>[0],
  res: ChatSearchResponse,
): Promise<ChatSearchResponse> {
  const hasAny = (Array.isArray(res.results) && res.results.length > 0) || (res.total ?? 0) > 0;
  if (hasAny) return res;

  const tripoli = await buildStaticTripoliMedicalResponse(input);
  if (tripoli) return tripoli;

  const donors = await buildBloodDonorsResponse(input);
  if (donors) return donors;

  return res;
}

// IMPORTANT: Expo only inlines `process.env.EXPO_PUBLIC_*` for direct property access.
// Avoid dynamic `process.env[name]` lookups or the values can be missing in production builds.
function envFlag(raw: any): boolean {
  const v = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

function envString(raw: any): string | undefined {
  return cleanString(typeof raw === "string" ? raw : "");
}

function normalizeSuggestions(raw: any): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
  return out.length ? out : undefined;
}

function unwrapN8nJson(json: any): any {
  // n8n may return an array of items depending on the workflow settings.
  if (Array.isArray(json)) return json[0] ?? null;
  return json;
}

function shouldFallbackFromN8n(err: any): boolean {
  const status = Number(err?.status ?? NaN);
  if (!Number.isFinite(status)) return true; // network / timeout
  return status === 0 || status === 404 || status >= 500;
}

async function chatSearchViaN8n(input: Parameters<typeof searchApi>[0] & { deviceId?: string }): Promise<ChatSearchResponse> {
  const n8nBase = getN8nBaseUrl();
  const webhookPath = envString(process.env.EXPO_PUBLIC_N8N_CHAT_WEBHOOK_PATH) || "/webhook/khidmaty-chat";
  const url = joinUrl(n8nBase, webhookPath);

  const payload = {
    q: input.q,
    type: input.filters.type,
    city: input.filters.city.trim() || "",
    category: input.filters.category.trim() || "",
    page: input.page ?? 1,
    limit: input.limit ?? 10,
    deviceId: cleanString((input as any).deviceId) || undefined,
    lat: input.userLocation?.lat,
    lon: input.userLocation?.lon,
  };

  const raw = await fetchJson<any>(url, { method: "POST", body: payload, timeoutMs: 20000 });
  const root = unwrapN8nJson(raw);
  const data = root?.data ?? root;

  const assistantText = cleanString(data?.assistantText) || cleanString(data?.replyText) || undefined;
  const suggestions = normalizeSuggestions(data?.suggestions ?? data?.quickReplies);

  const search = normalizeSearchResponse(data);
  return {
    ...search,
    query: search.query || input.q,
    assistantText,
    suggestions,
  };
}

export async function chatSearchApiWithRetry(
  input: Parameters<typeof searchApi>[0] & { deviceId?: string },
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<ChatSearchResponse> {
  const useN8nChat = envFlag(process.env.EXPO_PUBLIC_USE_N8N_CHAT);
  if (!useN8nChat) {
    try {
      const res = (await searchApiWithRetry(input, opts)) as ChatSearchResponse;
      return await applyStaticTripoliFallback(input, res);
    } catch (err) {
      const local = await buildStaticTripoliMedicalResponse(input);
      if (local) return local;
      throw err;
    }
  }

  try {
    const res = await chatSearchViaN8n(input);
    return await applyStaticTripoliFallback(input, res);
  } catch (err) {
    if (!shouldFallbackFromN8n(err)) throw err;
    try {
      const res = (await searchApiWithRetry(input, opts)) as ChatSearchResponse;
      return await applyStaticTripoliFallback(input, res);
    } catch (err2) {
      const local = await buildStaticTripoliMedicalResponse(input);
      if (local) return local;
      throw err2;
    }
  }
}

export type CreateLeadInput = {
  listingId: string;
  message: string;
  name: string;
  contact: string;
  deviceId: string;
};

export type CreateLeadResult = { leadId?: string };

export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  const payload = {
    action: "createLead",
    listingId: input.listingId,
    message: input.message,
    name: input.name,
    contact: input.contact,
    deviceId: input.deviceId,
  };

  const n8nBase = getN8nBaseUrl();
  const json = await fetchJson<any>(`${n8nBase}/webhook/khidmaty-action`, {
    method: "POST",
    body: payload,
    timeoutMs: 20000,
  });

  const leadId = cleanString(json?.leadId) || cleanString(json?.id) || undefined;
  return { leadId };
}
