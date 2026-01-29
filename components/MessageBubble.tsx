import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { theme } from "../lib/theme";

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function MessageBubble(props: {
  role: "user" | "bot";
  createdAt: number;
  variant?: "default" | "status";
  onPress?: () => void;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const isUser = props.role === "user";
  const isStatus = props.variant === "status";

  const rowStyle = isUser ? styles.userRow : styles.botRow;
  const bubbleStyle = isUser
    ? styles.userBubble
    : isStatus
      ? styles.statusBubble
      : styles.botBubble;

  const textStyle = isUser ? styles.userText : styles.botText;
  const timeStyle = isUser ? styles.userTime : styles.botTime;

  const content =
    typeof props.children === "string" ? (
      <Text style={[styles.text, textStyle]}>{props.children}</Text>
    ) : (
      props.children
    );

  const bubble = (
    <View style={[styles.bubble, bubbleStyle, props.style]}>
      {content}
      <Text style={[styles.time, timeStyle]}>{formatTime(props.createdAt)}</Text>
    </View>
  );

  if (props.onPress) {
    return (
      <Pressable style={rowStyle} onPress={props.onPress}>
        {bubble}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{bubble}</View>;
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  botRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  bubble: {
    maxWidth: "78%",
    borderRadius: theme.radii.lg,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  userBubble: {
    backgroundColor: theme.colors.chatBubbleOut,
    borderBottomRightRadius: 6,
  },
  botBubble: {
    backgroundColor: theme.colors.chatBubbleIn,
    borderWidth: 1,
    borderColor: theme.colors.chatBubbleInBorder,
    ...theme.shadow,
    borderBottomLeftRadius: 6,
  },
  statusBubble: {
    backgroundColor: theme.colors.chatBubbleIn,
    borderWidth: 1,
    borderColor: theme.colors.chatBubbleInBorder,
    ...theme.shadow,
    borderBottomLeftRadius: 6,
  },
  text: {
    fontSize: 16,
    lineHeight: 20,
  },
  userText: {
    color: "#fff",
  },
  botText: {
    color: theme.colors.text,
  },
  time: {
    marginTop: 6,
    fontSize: 10,
    opacity: 0.75,
  },
  userTime: {
    color: "rgba(255,255,255,0.9)",
    textAlign: "right",
  },
  botTime: {
    color: theme.colors.text2,
    textAlign: "right",
  },
});
