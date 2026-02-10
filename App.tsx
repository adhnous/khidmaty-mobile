import React from "react";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { RootNavigator } from "./navigation/RootNavigator";
import { ChatProvider } from "./lib/chat";
import { AuthProvider } from "./lib/auth";

// Avoid importing `expo-notifications` on web to prevent noisy warnings and unnecessary code.
if (Platform.OS !== "web") {
  WebBrowser.maybeCompleteAuthSession();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require("expo-notifications") as typeof import("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <AuthProvider>
        <ChatProvider>
          <RootNavigator />
        </ChatProvider>
      </AuthProvider>
    </>
  );
}
