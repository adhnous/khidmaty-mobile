import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { ChatInput } from "../components/ChatInput";
import { FilterBar } from "../components/FilterBar";
import { MessageBubble } from "../components/MessageBubble";
import { ResultCard, ResultCardSkeleton } from "../components/ResultCard";
import { chatSearchApiWithRetry } from "../lib/api";
import { categoryList } from "../lib/categoryData";
import { useChat, createMessageId } from "../lib/chat";
import { addRecentQuery, ensureDeviceId } from "../lib/storage";
import type { Message, SearchFilters, UserLocation } from "../lib/types";
import { theme } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

const PAGE_LIMIT = 10;

function now() {
  return Date.now();
}

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanQuery(input: string): string {
  const original = String(input || "").trim();
  if (!original) return "";

  // Make natural-language queries work better (e.g. "اريد تصميم" -> "تصميم").
  // Keep the list small to avoid stripping meaningful words.
  let q = original;
  const phrases = ["من فضلك", "لو سمحت"];
  for (const p of phrases) q = q.split(p).join(" ");

  const words = [
    "ارجو",
    "أرجو",
    "اريد",
    "أريد",
    "ابي",
    "أبي",
    "ابغى",
    "أبغى",
    "عايز",
    "عاوز",
    "محتاج",
    "محتاجه",
    "محتاجة",
  ];
  for (const w of words) {
    const re = new RegExp(`(^|\\s)${escapeRegex(w)}(?=\\s|$)`, "g");
    q = q.replace(re, " ");
  }

  q = q.replace(/\s+/g, " ").trim();
  return q || original;
}

function formatFiltersLine(filters: SearchFilters | undefined): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  if (filters.type && filters.type !== "all") parts.push(`Type: ${filters.type}`);
  if (filters.city.trim()) parts.push(`City: ${filters.city.trim()}`);
  if (filters.category.trim()) parts.push(`Category: ${filters.category.trim()}`);
  if (parts.length === 0) return null;
  return parts.join(" • ");
}

export default function SearchChatScreen({ navigation, route }: Props) {
  const listRef = useRef<FlatList<Message> | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const { messages, append, replaceById, updateById } = useChat();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({
    type: "all",
    city: "",
    category: "",
  });
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);

  const [loadingMoreId, setLoadingMoreId] = useState<string | null>(null);
  const [searchCtxByMsgId, setSearchCtxByMsgId] = useState<
    Record<string, { filters: SearchFilters; userLocation: UserLocation | null }>
  >({});
  const [searchRetryByMsgId, setSearchRetryByMsgId] = useState<
    Record<string, { q: string; filters: SearchFilters; userLocation: UserLocation | null }>
  >({});
  const [loadMoreErrorByMsgId, setLoadMoreErrorByMsgId] = useState<Record<string, string>>({});

  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.createdAt - b.createdAt),
    [messages],
  );

  function scrollToEnd(animated = true) {
    try {
      setTimeout(() => listRef.current?.scrollToEnd({ animated }), 50);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    scrollToEnd(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length]);

  useEffect(() => {
    const q = cleanQuery(route.params?.runQuery || "");
    if (!q) return;
    navigation.setParams({ runQuery: undefined });
    void handleSend(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.runQuery]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const id = await ensureDeviceId();
        if (alive) deviceIdRef.current = id;
      } catch {
        // optional; app still works without it
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function runSearch(opts: { q: string; filters: SearchFilters; userLocation?: UserLocation | null; replaceId?: string }) {
    const q = cleanQuery(opts.q);
    const statusId = opts.replaceId ?? createMessageId();
    const existing = opts.replaceId ? messages.find((m) => m.id === statusId) : undefined;
    const createdAt = existing?.createdAt ?? now();
    const useLocation = typeof opts.userLocation === "undefined" ? userLocation : opts.userLocation;

    setBusy(true);
    setSearchRetryByMsgId((prev) => {
      const { [statusId]: _omit, ...rest } = prev;
      return rest;
    });

    const statusMsg: Message = {
      id: statusId,
      role: "bot",
      kind: "status",
      text: "Searching...",
      createdAt,
    };
    if (opts.replaceId && existing) replaceById(statusId, statusMsg);
    else append(statusMsg);
    scrollToEnd(true);

    try {
      const res = await chatSearchApiWithRetry(
        {
          q,
          filters: opts.filters,
          page: 1,
          limit: PAGE_LIMIT,
          deviceId: deviceIdRef.current || undefined,
          userLocation: useLocation ?? undefined,
        },
        { retries: 1, retryDelayMs: 700 },
      );

      const hasMore = res.page * res.limit < res.total;
      const resultsMsg: Message = {
        id: statusId,
        role: "bot",
        kind: "results",
        query: res.query || q,
        assistantText: typeof (res as any)?.assistantText === "string" ? (res as any).assistantText : undefined,
        suggestions: Array.isArray((res as any)?.suggestions) ? ((res as any).suggestions as string[]) : undefined,
        results: Array.isArray(res.results) ? res.results : [],
        page: res.page || 1,
        hasMore,
        createdAt,
      };

      setSearchCtxByMsgId((prev) => ({ ...prev, [statusId]: { filters: opts.filters, userLocation: useLocation ?? null } }));
      setLoadMoreErrorByMsgId((prev) => {
        const { [statusId]: _omit, ...rest } = prev;
        return rest;
      });
      replaceById(statusId, resultsMsg);
    } catch (err: any) {
      const status = Number(err?.status ?? NaN);
      const detail = typeof err?.detail === "string" ? err.detail : "";
      const msg =
        status === 400
          ? detail || "Invalid query. Try something longer."
          : "Network error. Tap to retry.";

      if (status !== 400) {
        setSearchRetryByMsgId((prev) => ({ ...prev, [statusId]: { q, filters: opts.filters, userLocation: useLocation ?? null } }));
      }

      replaceById(statusId, {
        id: statusId,
        role: "bot",
        kind: "status",
        text: msg,
        createdAt,
      });
    } finally {
      setBusy(false);
      scrollToEnd(true);
    }
  }

  async function handleSend(forced?: string, overrideFilters?: SearchFilters) {
    const q = cleanQuery(forced ?? input);
    if (!q) return;
    if (busy) return;
    if (q.length > 120) {
      append({
        id: createMessageId(),
        role: "bot",
        kind: "status",
        text: "q must be 1..120 characters.",
        createdAt: now(),
      });
      setInput("");
      return;
    }

    setInput("");
    await addRecentQuery(q, 20);

    append({
      id: createMessageId(),
      role: "user",
      text: q,
      createdAt: now(),
    });

    scrollToEnd(true);
    await runSearch({ q, filters: overrideFilters ? { ...overrideFilters } : { ...filters } });
  }

  async function loadMore(msgId: string) {
    if (busy) return;
    if (loadingMoreId) return;

    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.role !== "bot" || msg.kind !== "results") return;
    if (!msg.hasMore) return;

    const ctx = searchCtxByMsgId[msgId];
    const useFilters = ctx?.filters ?? filters;
    const useLocation = ctx ? ctx.userLocation : userLocation;
    const nextPage = Math.max(1, Math.trunc(msg.page || 1) + 1);

    setLoadingMoreId(msgId);
    setLoadMoreErrorByMsgId((prev) => {
      const { [msgId]: _omit, ...rest } = prev;
      return rest;
    });

    try {
      const res = await chatSearchApiWithRetry(
        {
          q: msg.query,
          filters: useFilters,
          page: nextPage,
          limit: PAGE_LIMIT,
          deviceId: deviceIdRef.current || undefined,
          userLocation: useLocation ?? undefined,
        },
        { retries: 1, retryDelayMs: 700 },
      );

      const hasMore = res.page * res.limit < res.total;
      updateById(msgId, (cur) => {
        if (cur.role !== "bot" || cur.kind !== "results") return cur;
        const nextResults = [...cur.results, ...(Array.isArray(res.results) ? res.results : [])];
        return { ...cur, results: nextResults, page: res.page || nextPage, hasMore };
      });
    } catch {
      setLoadMoreErrorByMsgId((prev) => ({ ...prev, [msgId]: "Could not load more. Tap to retry." }));
    } finally {
      setLoadingMoreId(null);
      scrollToEnd(true);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <FilterBar value={filters} onChange={setFilters} onCoordsChange={setUserLocation} />

        <FlatList
          ref={(r) => {
            listRef.current = r;
          }}
          data={sorted}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollToEnd(true)}
          renderItem={({ item }) => {
            if (item.role === "user") {
              return (
                <MessageBubble role="user" createdAt={item.createdAt}>
                  {item.text}
                </MessageBubble>
              );
            }

            if (item.kind === "results") {
              const results = Array.isArray(item.results) ? item.results : [];
              const loadMoreError = loadMoreErrorByMsgId[item.id];
              const loadingMore = loadingMoreId === item.id;
              const ctxFilters = searchCtxByMsgId[item.id]?.filters;
              const filtersLine = formatFiltersLine(ctxFilters);
              const suggestions = Array.isArray(item.suggestions) ? item.suggestions.filter(Boolean).slice(0, 8) : [];
              return (
                <MessageBubble role="bot" createdAt={item.createdAt}>
                  <View style={{ gap: 10 }}>
                    <Text style={styles.botTitle} numberOfLines={2}>
                      Results for "{item.query}"
                    </Text>

                    {filtersLine ? (
                      <Text style={styles.filtersLine} numberOfLines={2}>
                        {filtersLine}
                      </Text>
                    ) : null}

                    {item.assistantText ? (
                      <Text style={styles.botText}>{item.assistantText}</Text>
                    ) : null}

                    {suggestions.length > 0 ? (
                      <View style={styles.suggestionsRow}>
                        {suggestions.map((s) => (
                          <Pressable
                            key={s}
                            onPress={() => {
                              // If the suggestion matches a canonical category, apply it as a filter.
                              const isCategory = categoryList.includes(s as any);
                              if (isCategory) {
                                const next: SearchFilters = { ...filters, type: "services", category: s };
                                setFilters(next);
                                void handleSend(s, next);
                                return;
                              }
                              void handleSend(s);
                            }}
                            style={({ pressed }) => [styles.suggestionChip, pressed && styles.suggestionChipPressed]}
                            hitSlop={6}
                          >
                            <Text style={styles.suggestionText} numberOfLines={1}>
                              {s}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    {results.length === 0 ? (
                      <Text style={styles.botText}>No results found.</Text>
                    ) : (
                      <View style={{ gap: 10 }}>
                        {results.map((r) => (
                          <ResultCard
                            key={`${r.type}:${r.id}`}
                            result={r}
                            onPress={() => navigation.navigate("ListingDetail", { result: r })}
                          />
                        ))}
                      </View>
                    )}

                    {item.hasMore ? (
                      <View style={styles.loadMoreRow}>
                        <Pressable
                          onPress={() => void loadMore(item.id)}
                          disabled={loadingMore}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.loadMoreBtn,
                            pressed && !loadingMore && styles.loadMoreBtnPressed,
                            loadingMore && styles.loadMoreBtnDisabled,
                          ]}
                        >
                          {loadingMore ? (
                            <ActivityIndicator size="small" color={theme.colors.chatBubbleOut} />
                          ) : null}
                          <Text style={styles.loadMoreBtnText}>
                            {loadingMore ? "Loading" : loadMoreError ? "Retry" : "Load more"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {loadMoreError ? (
                      <Pressable
                        onPress={() => void loadMore(item.id)}
                        disabled={loadingMore}
                        hitSlop={8}
                      >
                        <Text style={styles.loadMoreErrorText}>{loadMoreError}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </MessageBubble>
              );
            }

            const retryCtx = searchRetryByMsgId[item.id];
            const tappable = !!retryCtx && !busy;
            return (
              <MessageBubble
                role="bot"
                createdAt={item.createdAt}
                variant="status"
                onPress={
                  tappable
                    ? () =>
                        void runSearch({
                          q: retryCtx!.q,
                          filters: retryCtx!.filters,
                          userLocation: retryCtx!.userLocation,
                          replaceId: item.id,
                        })
                    : undefined
                }
              >
                <View style={styles.statusRow}>
                  {item.text.startsWith("Searching") ? (
                    <ActivityIndicator size="small" color={theme.colors.text2} />
                  ) : null}
                  <Text style={styles.botText}>{item.text}</Text>
                </View>

                {item.text.startsWith("Searching") ? (
                  <View style={{ gap: 10, marginTop: 10 }}>
                    <ResultCardSkeleton />
                    <ResultCardSkeleton />
                  </View>
                ) : null}
              </MessageBubble>
            );
          }}
        />

        <ChatInput
          value={input}
          onChangeText={setInput}
          onSend={() => void handleSend()}
          disabled={false}
          loading={busy}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.chatBg },
  listContent: { paddingVertical: 12 },
  botTitle: { fontSize: 14, fontWeight: "900", color: theme.colors.text },
  filtersLine: { fontSize: 12, color: theme.colors.text2, fontWeight: "700" },
  botText: { fontSize: 14, color: theme.colors.text, flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  suggestionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestionChip: {
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: "rgba(42,171,238,0.10)",
    borderWidth: 1,
    borderColor: "rgba(42,171,238,0.30)",
  },
  suggestionChipPressed: { opacity: 0.9 },
  suggestionText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.chatBubbleOut,
  },
  loadMoreRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 4,
  },
  loadMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(42,171,238,0.10)",
    borderWidth: 1,
    borderColor: "rgba(42,171,238,0.30)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radii.pill,
    overflow: "hidden",
  },
  loadMoreBtnPressed: { opacity: 0.9 },
  loadMoreBtnDisabled: { opacity: 0.6 },
  loadMoreBtnText: {
    fontSize: 12,
    fontWeight: "900",
    color: theme.colors.chatBubbleOut,
  },
  loadMoreErrorText: { fontSize: 12, color: theme.colors.danger, fontWeight: "800" },
});
