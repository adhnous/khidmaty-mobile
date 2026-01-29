import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const DEFAULT_N8N_BASE_URL = "http://localhost:5678";
let warnedApiLocalhostOnDevice = false;
let warnedN8nLocalhostOnDevice = false;

function normalizeBaseUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

function getHostFromHostUri(hostUri: string): string | null {
  const v = String(hostUri || "").trim().replace(/^https?:\/\//, "");
  const hostPort = v.split("/")[0] || "";
  if (!hostPort) return null;
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end === -1) return null;
    return hostPort.slice(0, end + 1);
  }
  return hostPort.split(":")[0] || null;
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function isAndroidEmulatorHost(host: string): boolean {
  return host === "10.0.2.2" || host === "10.0.3.2";
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function getDevHostUri(): string | null {
  const anyConstants = Constants as any;
  const hostUri =
    (typeof anyConstants?.expoConfig?.hostUri === "string" && anyConstants.expoConfig.hostUri) ||
    (typeof anyConstants?.expoGoConfig?.hostUri === "string" && anyConstants.expoGoConfig.hostUri) ||
    (typeof anyConstants?.platform?.hostUri === "string" && anyConstants.platform.hostUri) ||
    null;

  if (hostUri && hostUri.trim()) return hostUri.trim();

  const expUrl = typeof anyConstants?.experienceUrl === "string" ? String(anyConstants.experienceUrl) : "";
  const m1 = expUrl.match(/^[a-zA-Z0-9+.-]+:\/\/([^/]+)\/?/);
  if (m1?.[1]) return m1[1];

  const linking = typeof anyConstants?.linkingUri === "string" ? String(anyConstants.linkingUri) : "";
  const m2 = linking.match(/^[a-zA-Z0-9+.-]+:\/\/([^/]+)\/?/);
  if (m2?.[1]) return m2[1];

  return null;
}

function isProbablyRealDevice(): boolean {
  if (Platform.OS === "web") return false;
  const hostUri = getDevHostUri();
  const host = hostUri ? getHostFromHostUri(hostUri) : null;
  if (!host) return false;
  if (isLoopbackHost(host)) return false;
  if (Platform.OS === "android" && isAndroidEmulatorHost(host)) return false;
  return true;
}

function replaceLoopbackHost(baseUrl: string, nextHost: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (!isLoopbackHost(url.hostname)) return null;
    url.hostname = nextHost;
    return normalizeBaseUrl(url.toString());
  } catch {
    return null;
  }
}

export function getApiBaseUrl(): string {
  const envRaw =
    typeof process.env.EXPO_PUBLIC_API_BASE_URL === "string" ? process.env.EXPO_PUBLIC_API_BASE_URL : "";
  const base = normalizeBaseUrl(envRaw || DEFAULT_API_BASE_URL);

  const isRealDevice = isProbablyRealDevice();
  if (!isRealDevice) return base;

  if (/(localhost|127\.0\.0\.1)/i.test(base)) {
    if (!warnedApiLocalhostOnDevice) {
      warnedApiLocalhostOnDevice = true;
      console.warn(
        "EXPO_PUBLIC_API_BASE_URL is set to localhost/127.0.0.1. On a real phone this points to the phone, not your laptop. Use your laptop LAN IP like http://192.168.x.x:3000.",
      );
    }

    const hostUri = getDevHostUri();
    const devHost = hostUri ? getHostFromHostUri(hostUri) : null;
    if (devHost && isPrivateIPv4(devHost)) {
      const rewritten = replaceLoopbackHost(base, devHost);
      if (rewritten) return rewritten;
    }
  }

  return base;
}

export function getN8nBaseUrl(): string {
  const envRaw =
    typeof process.env.EXPO_PUBLIC_N8N_BASE_URL === "string" ? process.env.EXPO_PUBLIC_N8N_BASE_URL : "";
  const base = normalizeBaseUrl(envRaw || DEFAULT_N8N_BASE_URL);

  const isRealDevice = isProbablyRealDevice();
  if (!isRealDevice) return base;

  if (/(localhost|127\.0\.0\.1)/i.test(base)) {
    if (!warnedN8nLocalhostOnDevice) {
      warnedN8nLocalhostOnDevice = true;
      console.warn(
        "EXPO_PUBLIC_N8N_BASE_URL is set to localhost/127.0.0.1. On a real phone this points to the phone, not your laptop. Use your laptop LAN IP like http://192.168.x.x:5678.",
      );
    }

    const hostUri = getDevHostUri();
    const devHost = hostUri ? getHostFromHostUri(hostUri) : null;
    if (devHost && isPrivateIPv4(devHost)) {
      const rewritten = replaceLoopbackHost(base, devHost);
      if (rewritten) return rewritten;
    }
  }

  return base;
}
