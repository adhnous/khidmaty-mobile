import { Platform, Vibration } from "react-native";
import { Audio } from "expo-av";

// Emergency "panic alarm": loud siren + vibration.
// Keep it simple and reliable.

let sound: Audio.Sound | null = null;
let vibInterval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function ensureSoundLoaded(): Promise<Audio.Sound> {
  if (sound) return sound;

  // Configure audio so it can play even if the phone is in silent mode (iOS).
  // Some fields are not supported on web; keep it defensive.
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      shouldDuckAndroid: false,
      staysActiveInBackground: true,
    } as any);
  } catch {
    // ignore
  }

  const { sound: s } = await Audio.Sound.createAsync(
    // Local, non-copyrighted siren audio (generated).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../assets/siren.wav"),
    {
      isLooping: true,
      volume: 1.0,
      shouldPlay: false,
    },
  );

  sound = s;
  return s;
}

function startVibration() {
  // Stop any previous vibration loop first.
  stopVibration();

  if (Platform.OS === "android") {
    // Android supports repeating vibration patterns.
    Vibration.vibrate([0, 500, 500, 500], true);
    return;
  }

  // iOS does not reliably support repeating patterns. Use a timer.
  Vibration.vibrate(500);
  vibInterval = setInterval(() => {
    Vibration.vibrate(500);
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
    const s = await ensureSoundLoaded();
    try {
      await s.setPositionAsync(0);
    } catch {
      // ignore
    }
    await s.playAsync();
  } catch {
    // If audio fails, we still keep vibration as a fallback.
  }

  if (vibration) startVibration();
}

export async function stopAlarm() {
  if (!running) return;
  running = false;

  stopVibration();

  if (sound) {
    try {
      await sound.stopAsync();
    } catch {
      // ignore
    }
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    sound = null;
  }
}
