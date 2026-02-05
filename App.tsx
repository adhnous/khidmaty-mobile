import React from "react";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { RootNavigator } from "./navigation/RootNavigator";
import { ChatProvider } from "./lib/chat";
import { AuthProvider } from "./lib/auth";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
