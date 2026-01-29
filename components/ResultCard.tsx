import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { SearchResult } from "../lib/types";
import { theme } from "../lib/theme";

function formatPrice(priceFrom?: number): string | null {
  if (typeof priceFrom !== "number" || !Number.isFinite(priceFrom)) return null;
  if (priceFrom <= 0) return null;
  return `${Math.round(priceFrom)} LYD`;
}

function formatRating(rating?: number): string | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  if (rating <= 0) return null;
  return `${rating.toFixed(1)}*`;
}

function formatDistance(distanceKm?: number): string | null {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) return null;
  if (distanceKm < 0) return null;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
}

export function ResultCard(props: { result: SearchResult; onPress?: () => void }) {
  const { result } = props;
  const subtitleParts = [result.city, result.category].filter(Boolean) as string[];
  const subtitle = subtitleParts.join(" - ");
  const price = formatPrice(result.priceFrom);
  const rating = formatRating(result.rating);
  const distance = formatDistance(result.distanceKm);
  const [thumbError, setThumbError] = React.useState(false);

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.thumbWrap}>
        {result.thumb && !thumbError ? (
          <Image
            source={{ uri: result.thumb }}
            style={styles.thumb}
            resizeMode="cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Text style={styles.thumbPlaceholderText}>{result.type.toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {result.title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{result.type}</Text>
          </View>
          {distance ? <Text style={styles.metaText}>{distance}</Text> : null}
          {price ? <Text style={styles.metaText}>{price}</Text> : null}
          {rating ? <Text style={styles.metaText}>{rating}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function ResultCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={[styles.thumbWrap, styles.skelBlock]} />
      <View style={styles.body}>
        <View style={[styles.skelLine, { width: "85%" }]} />
        <View style={[styles.skelLine, { width: "60%", marginTop: 8 }]} />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <View style={[styles.skelPill, { width: 64 }]} />
          <View style={[styles.skelPill, { width: 70 }]} />
          <View style={[styles.skelPill, { width: 46 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardPressed: {
    opacity: 0.92,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    backgroundColor: "#F3F4F6",
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbPlaceholderText: {
    fontSize: 10,
    letterSpacing: 0.8,
    color: theme.colors.text2,
    fontWeight: "900",
  },
  body: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.text2,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.primary,
  },
  metaText: {
    fontSize: 12,
    color: theme.colors.text,
    fontWeight: "700",
  },
  skelBlock: {
    backgroundColor: theme.colors.border,
  },
  skelLine: {
    height: 10,
    borderRadius: 6,
    backgroundColor: theme.colors.border,
  },
  skelPill: {
    height: 18,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.border,
  },
});
