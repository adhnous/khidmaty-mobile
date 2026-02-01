import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SearchChatScreen from "../screens/SearchChatScreen";
import ListingDetailScreen from "../screens/ListingDetailScreen";
import HistoryScreen from "../screens/HistoryScreen";
import SosScreen from "../screens/SosScreen";
import type { SearchResult } from "../lib/types";
import { theme } from "../lib/theme";

export type RootStackParamList = {
  Search: { runQuery?: string } | undefined;
  ListingDetail: { result: SearchResult };
  History: undefined;
  SOS: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function SearchHeaderTitle() {
  return (
    <View style={styles.headerTitleWrap}>
      <Text style={styles.headerTitle}>Khidmaty</Text>
      <Text style={styles.headerSubtitle}>Search</Text>
    </View>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
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
                  onPress={() => navigation.navigate("History")}
                  style={styles.headerRightBtn}
                  hitSlop={10}
                >
                  <Text style={styles.headerRightText}>History</Text>
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
