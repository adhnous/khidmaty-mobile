import { Vibration } from "react-native";
import { Asset } from "expo-asset";

// Web implementation of the emergency "panic alarm".
// - Uses HTMLAudioElement for a looping siren.
// - Vibration is best-effort (only supported on some devices/browsers).

let audio: HTMLAudioElement | null = null;
let vibInterval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function ensureAudioLoaded(): Promise<HTMLAudioElement> {
  if (audio) return audio;

  const asset = Asset.fromModule(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../assets/siren.wav"),
  );
  try {
    await asset.downloadAsync();
  } catch {
    // ignore
  }

  const uri = String(asset.localUri || asset.uri || "");
  const a = new Audio(uri);
  a.loop = true;
  a.preload = "auto";
  audio = a;
  return a;
}

function canVibrate(): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  } catch {
    return false;
  }
}

function startVibration() {
  stopVibration();
  if (!canVibrate()) return;

  try {
    Vibration.vibrate(500);
  } catch {
    // ignore
  }

  vibInterval = setInterval(() => {
    try {
      Vibration.vibrate(500);
    } catch {
      // ignore
    }
  }, 1000);
}

function stopVibration() {
  try {
    Vibration.cancel();
  } catch {
    // ignore
  }
  if (vibInterval) {
    clearInterval(vibInterval);
    vibInterval = null;
  }
}

export function isAlarmRunning() {
  return running;
}

export async function startAlarm(opts: { vibration?: boolean } = {}) {
  if (running) return;
  running = true;

  const vibration = opts.vibration ?? true;

  try {
    const a = await ensureAudioLoaded();
    try {
      a.currentTime = 0;
    } catch {
      // ignore
    }
    // Must be called from a user gesture on most browsers. If it fails, we keep vibration as fallback.
    await a.play();
  } catch {
    // ignore
  }

  if (vibration) startVibration();
}

export async function stopAlarm() {
  if (!running) return;
  running = false;

  stopVibration();

  if (audio) {
    try {
      audio.pause();
    } catch {
      // ignore
    }
    try {
      audio.currentTime = 0;
    } catch {
      // ignore
    }
  }
}

