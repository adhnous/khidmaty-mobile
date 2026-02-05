import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import SearchChatScreen from "../screens/SearchChatScreen";
import ListingDetailScreen from "../screens/ListingDetailScreen";
import HistoryScreen from "../screens/HistoryScreen";
import SosScreen from "../screens/SosScreen";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import TrustedContactsScreen from "../screens/TrustedContactsScreen";
import IncomingRequestsScreen from "../screens/IncomingRequestsScreen";
import IncomingSosScreen from "../screens/IncomingSosScreen";
import type { SearchResult } from "../lib/types";
import { theme } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { registerDeviceForPush } from "../lib/push";

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Search: { runQuery?: string } | undefined;
  ListingDetail: { result: SearchResult };
  History: undefined;
  SOS: undefined;
  TrustedContacts: undefined;
  IncomingRequests: undefined;
  IncomingSOS: { eventId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navRef = createNavigationContainerRef<RootStackParamList>();

function SearchHeaderTitle() {
  return (
    <View style={styles.headerTitleWrap}>
      <Text style={styles.headerTitle}>Khidmaty</Text>
      <Text style={styles.headerSubtitle}>Search</Text>
    </View>
  );
}

export function RootNavigator() {
  const { user, logout } = useAuth();
  const pendingSosEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    void registerDeviceForPush(user.uid).catch(() => null);
  }, [user?.uid]);

  useEffect(() => {
    function handleResponse(res: Notifications.NotificationResponse | null | undefined) {
      const data = (res?.notification?.request?.content?.data ?? {}) as any;
      const type = typeof data?.type === "string" ? data.type : "";
      const eventId = typeof data?.eventId === "string" ? data.eventId.trim() : "";
      if (type !== "sos" || !eventId) return;

      if (navRef.isReady()) navRef.navigate("IncomingSOS", { eventId });
      else pendingSosEventIdRef.current = eventId;
    }

    const sub = Notifications.addNotificationResponseReceivedListener((res) => handleResponse(res));
    void Notifications.getLastNotificationResponseAsync().then((res) => handleResponse(res));
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => {
        const pending = pendingSosEventIdRef.current;
        if (!pending) return;
        pendingSosEventIdRef.current = null;
        navRef.navigate("IncomingSOS", { eventId: pending });
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.colors.chatBubbleOut },
          headerTintColor: theme.colors.snow,
          contentStyle: { backgroundColor: theme.colors.chatBg },
          headerTitleAlign: "left",
        }}
      >
        <Stack.Screen
          name="Search"
          component={SearchChatScreen}
          options={({ navigation }) => ({
            headerTitle: () => <SearchHeaderTitle />,
            headerRight: () => (
              <View style={styles.headerRightRow}>
                <Pressable
                  onPress={() => navigation.navigate("SOS")}
                  style={[styles.headerRightBtn, styles.headerRightBtnSos]}
                  hitSlop={10}
                >
                  <Text style={styles.headerRightText}>SOS</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigation.navigate("TrustedContacts")}
                  style={styles.headerRightBtn}
                  hitSlop={10}
                >
                  <Text style={styles.headerRightText}>Trusted</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigation.navigate("History")}
                  style={styles.headerRightBtn}
                  hitSlop={10}
                >
                  <Text style={styles.headerRightText}>History</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (user?.uid) void logout();
                    else navigation.navigate("Login");
                  }}
                  style={styles.headerRightBtn}
                  hitSlop={10}
                >
                  <Text style={styles.headerRightText}>{user?.uid ? "Logout" : "Login"}</Text>
                </Pressable>
              </View>
            ),
          })}
        />
        <Stack.Screen
          name="ListingDetail"
          component={ListingDetailScreen}
          options={{
            title: "Details",
          }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{
            title: "History",
          }}
        />
        <Stack.Screen
          name="SOS"
          component={SosScreen}
          options={{
            title: "SOS",
          }}
        />
        <Stack.Screen
          name="TrustedContacts"
          component={TrustedContactsScreen}
          options={{
            title: "Trusted Contacts",
          }}
        />
        <Stack.Screen
          name="IncomingRequests"
          component={IncomingRequestsScreen}
          options={{
            title: "Incoming Requests",
          }}
        />
        <Stack.Screen
          name="IncomingSOS"
          component={IncomingSosScreen}
          options={{
            title: "Incoming SOS",
          }}
        />
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{
            title: "Login",
          }}
        />
        <Stack.Screen
          name="Register"
          component={RegisterScreen}
          options={{
            title: "Register",
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  headerTitleWrap: { gap: 1 },
  headerTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.snow },
  headerSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "700" },
  headerRightRow: { flexDirection: "row", gap: 8 },
  headerRightBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  headerRightBtnSos: {
    backgroundColor: "rgba(229,33,23,0.18)",
    borderColor: "rgba(229,33,23,0.35)",
  },
  headerRightText: { color: theme.colors.snow, fontWeight: "800", fontSize: 12 },
});
