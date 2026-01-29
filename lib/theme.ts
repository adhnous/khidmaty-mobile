import { Platform, type ViewStyle } from "react-native";

type ShadowStyle = ViewStyle & { boxShadow?: string };

const shadow: ShadowStyle =
  Platform.OS === "web"
    ? { boxShadow: "0px 4px 10px rgba(0,0,0,0.06)" }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      };

export const theme = {
  colors: {
    // Base surfaces (match web light background)
    bg: "#F6F7FB",
    surface: "#FFFFFF",
    border: "#E5E7EB",

    // Text
    text: "#111827",
    text2: "#6B7280",

    // Telegram-like chat palette (kept separate so the rest of the app can stay on-brand)
    chatBg: "#E6EBEE",
    chatBubbleOut: "#2AABEE",
    chatBubbleIn: "#FFFFFF",
    chatBubbleInBorder: "#D8DEE4",

    // Brand palette from web app (globals.css)
    ink: "#0A0A0A",
    snow: "#FFFFFF",
    steel: "#9CA3AF",

    // Primary accent (copper) + softer variants
    primary: "#D97800",
    primarySoft: "#FBF2E6", // copper at ~10% on white
    primaryBorder: "#FFC178",

    // Status colors (web "power" red)
    danger: "#E52117",
    success: "#16A34A",
  },
  radii: {
    sm: 10,
    md: 14,
    lg: 18,
    pill: 999,
  },
  shadow: shadow satisfies ShadowStyle,
} as const;

export type Theme = typeof theme;
