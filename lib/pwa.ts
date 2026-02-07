import { Platform } from "react-native";

export function isIOSWeb(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof navigator === "undefined") return false;

  const ua = String(navigator.userAgent || "");
  if (/iPad|iPhone|iPod/i.test(ua)) return true;

  // iPadOS 13+ reports Macintosh; detect touch support.
  const isMacLike = /Macintosh/i.test(ua);
  const maxTouchPoints = (navigator as any).maxTouchPoints;
  if (isMacLike && typeof maxTouchPoints === "number" && maxTouchPoints > 1) return true;

  return false;
}

export function isStandalonePWA(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;

  // iOS "Add to Home Screen"
  try {
    if ((navigator as any)?.standalone === true) return true;
  } catch {
    // ignore
  }

  // Standard PWA display-mode
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

