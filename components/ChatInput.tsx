import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "../lib/theme";
import { arText } from "../lib/translations";

export function ChatInput(props: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const canSend =
    !props.disabled && !props.loading && props.value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.inputBox}>
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={arText.chatPlaceholder}
          style={styles.input}
          editable={!props.disabled && !props.loading}
          returnKeyType="send"
          placeholderTextColor="#9CA3AF"
          onSubmitEditing={() => {
            if (canSend) props.onSend();
          }}
        />
      </View>

      <Pressable
        onPress={() => {
          if (canSend) props.onSend();
        }}
        disabled={!canSend}
        style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
      >
        {props.loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.sendText}>{arText.send}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.chatBubbleInBorder,
    backgroundColor: theme.colors.chatBg,
  },
  inputBox: {
    flex: 1,
    height: 44,
    backgroundColor: theme.colors.chatBubbleIn,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.chatBubbleInBorder,
  },
  input: {
    fontSize: 16,
    color: theme.colors.text,
  },
  sendButton: {
    marginLeft: 10,
    height: 44,
    width: 70,
    borderRadius: theme.radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.chatBubbleOut,
  },
  sendButtonDisabled: {
    backgroundColor: "rgba(42,171,238,0.55)",
  },
  sendText: {
    color: "#fff",
    fontWeight: "800",
  },
});
