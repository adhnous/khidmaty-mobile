import React, { useCallback, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { clearRecentQueries, getRecentQueries } from "../lib/storage";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "History">;

export default function HistoryScreen({ navigation }: Props) {
  const [queries, setQueries] = useState<string[]>([]);

  const load = useCallback(() => {
    let alive = true;
    (async () => {
      const list = await getRecentQueries();
      if (alive) setQueries(list);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(load);

  async function handleClear() {
    await clearRecentQueries();
    setQueries([]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recent searches</Text>
        <Pressable
          onPress={handleClear}
          disabled={queries.length === 0}
          style={[styles.clearBtn, queries.length === 0 && styles.clearBtnDisabled]}
        >
          <Text style={[styles.clearText, queries.length === 0 && styles.clearTextDisabled]}>Clear</Text>
        </Pressable>
      </View>

      {queries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No history yet.</Text>
        </View>
      ) : (
        <FlatList
          data={queries}
          keyExtractor={(q) => q}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate("Search", { runQuery: item })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.rowText} numberOfLines={1}>
                {item}
              </Text>
              <Text style={styles.rowHint}>Tap to search</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  headerRow: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radii.pill,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  clearBtnDisabled: { opacity: 0.5 },
  clearText: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  clearTextDisabled: { color: theme.colors.text2 },
  listContent: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  row: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowPressed: { opacity: 0.9 },
  rowText: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  rowHint: { marginTop: 4, fontSize: 12, color: theme.colors.text2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyText: { fontSize: 14, color: theme.colors.text2 },
});
