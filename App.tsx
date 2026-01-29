import React from "react";
import { StatusBar } from "expo-status-bar";
import { RootNavigator } from "./navigation/RootNavigator";
import { ChatProvider } from "./lib/chat";

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <ChatProvider>
        <RootNavigator />
      </ChatProvider>
    </>
  );
}
