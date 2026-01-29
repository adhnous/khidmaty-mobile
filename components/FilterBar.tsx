import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import type { SearchFilters, SearchTypeFilter } from "../lib/types";
import { theme } from "../lib/theme";
import { cityList, formatCityLabel, findNearestCity } from "../lib/cityData";
import { categoryList, formatCategoryLabel } from "../lib/categoryData";
import { arText } from "../lib/translations";

const TYPE_OPTIONS: Array<{ id: SearchTypeFilter; label: string }> = [
  { id: "all", label: arText.typeAll },
  { id: "services", label: arText.typeServices },
  { id: "items", label: arText.typeItems },
  { id: "providers", label: arText.typeProviders },
];

const TYPE_LABELS: Record<SearchTypeFilter, string> = {
  all: arText.typeAll,
  services: arText.typeServices,
  items: arText.typeItems,
  providers: arText.typeProviders,
};

export function FilterBar(props: {
  value: SearchFilters;
  onChange: (next: SearchFilters) => void;
  onCoordsChange?: (coords: { lat: number; lon: number } | null) => void;
}) {
  const v = props.value;
  const [cityFocused, setCityFocused] = React.useState(false);
  const [categoryFocused, setCategoryFocused] = React.useState(false);
  const [cityPickerVisible, setCityPickerVisible] = React.useState(false);
  const [categoryPickerVisible, setCategoryPickerVisible] = React.useState(false);
  const [locLoading, setLocLoading] = React.useState(false);
  const [locError, setLocError] = React.useState<string | null>(null);

  const selectedCity =
    v.city && v.city.trim()
      ? {
          primary: formatCityLabel(v.city, "ar"),
          secondary: formatCityLabel(v.city, "en"),
        }
      : { primary: arText.cityLabel, secondary: "" };
  const selectedCategory = v.category
    ? { primary: formatCategoryLabel(v.category), secondary: "" }
    : { primary: arText.categoryLabel, secondary: "" };

  function setType(type: SearchTypeFilter) {
    props.onChange({ ...v, type });
  }

  function setCity(city: string) {
    props.onChange({ ...v, city });
  }

  function setCategory(category: string) {
    props.onChange({ ...v, category });
  }

  function clear() {
    props.onChange({ type: "all", city: "", category: "" });
  }

  async function handleUseCurrentLocation() {
    setLocError(null);
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        throw new Error("Permission denied");
      }
      const position = await Location.getCurrentPositionAsync({
        // Force high-accuracy (GPS) to avoid IP/Wi-Fi based locations which can be very wrong.
        accuracy: Location.Accuracy.Highest,
      });
      const nearest = findNearestCity(position.coords.latitude, position.coords.longitude);
      if (nearest) {
        setCity(nearest.value);
        props.onCoordsChange?.({ lat: position.coords.latitude, lon: position.coords.longitude });
      } else {
        setLocError(arText.locationNotNear);
        props.onCoordsChange?.(null);
      }
    } catch (err: any) {
      const message =
        err?.message === "Permission denied"
          ? arText.locationPermission
          : arText.locationUnavailable;
      setLocError(message);
      props.onCoordsChange?.(null);
    } finally {
      setLocLoading(false);
    }
  }

  const hasAny = v.type !== "all" || v.city.trim() !== "" || v.category.trim() !== "";

  return (
    <View style={styles.wrap}>
      <View style={styles.typeRow}>
        {TYPE_OPTIONS.map((opt) => {
          const selected = opt.id === v.type;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setType(opt.id)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.selectorRow}>
        <Pressable
          onPress={() => setCityPickerVisible(true)}
          style={styles.selector}
        >
          <Text style={styles.selectorLabel}>{arText.cityLabel}</Text>
          <Text style={styles.selectorValue}>{selectedCity.primary}</Text>
          {selectedCity.secondary ? (
            <Text style={styles.selectorValueSub}>{selectedCity.secondary}</Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => setCategoryPickerVisible(true)}
          style={styles.selector}
        >
          <Text style={styles.selectorLabel}>{arText.categoryLabel}</Text>
          <Text style={styles.selectorValue}>{selectedCategory.primary}</Text>
        </Pressable>
      </View>

      <View style={styles.inputsRow}>
        <View style={[styles.inputWrap, styles.flexGrow]}>
          <Text style={styles.label}>{arText.cityLabel}</Text>
          <TextInput
            value={v.city}
            onChangeText={setCity}
            placeholder={arText.cityPlaceholder}
            style={[styles.input, cityFocused && styles.inputFocused]}
            autoCorrect={false}
            placeholderTextColor="#9CA3AF"
            onFocus={() => setCityFocused(true)}
            onBlur={() => setCityFocused(false)}
          />
        </View>
        <View style={[styles.inputWrap, styles.flexGrow]}>
          <Text style={styles.label}>{arText.categoryLabel}</Text>
          <TextInput
            value={v.category}
            onChangeText={setCategory}
            placeholder={arText.categoryPlaceholder}
            style={[styles.input, categoryFocused && styles.inputFocused]}
            autoCorrect={false}
            placeholderTextColor="#9CA3AF"
            onFocus={() => setCategoryFocused(true)}
            onBlur={() => setCategoryFocused(false)}
          />
        </View>
        <Pressable
          onPress={clear}
          disabled={!hasAny}
          style={[styles.clearBtn, !hasAny && styles.clearBtnDisabled]}
        >
          <Text style={[styles.clearText, !hasAny && styles.clearTextDisabled]}>{arText.clear}</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={handleUseCurrentLocation}
        style={styles.locationBtn}
        disabled={locLoading}
      >
        {locLoading ? (
          <ActivityIndicator size="small" color={theme.colors.snow} />
        ) : (
          <Text style={styles.locationText}>{arText.useLocation}</Text>
        )}
      </Pressable>
      {locError ? <Text style={styles.locationError}>{locError}</Text> : null}

      {hasAny ? (
        <View style={styles.activeRow}>
          {v.type !== "all" ? (
            <View style={styles.activeChip}>
              <Text style={styles.activeChipText}>{`${arText.activeTypeLabel}: ${TYPE_LABELS[v.type]}`}</Text>
            </View>
          ) : null}
          {v.city.trim() ? (
            <View style={styles.activeChip}>
              <Text style={styles.activeChipText}>{`${arText.activeCityLabel}: ${selectedCity.primary}`}</Text>
            </View>
          ) : null}
          {v.category.trim() ? (
            <View style={styles.activeChip}>
              <Text style={styles.activeChipText}>{`${arText.activeCategoryLabel}: ${selectedCategory.primary}`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Modal
        visible={cityPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCityPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{arText.chooseCity}</Text>
            <FlatList
              data={cityList}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalItem}
                  onPress={() => {
                    setCity(item.value);
                    setCityPickerVisible(false);
                  }}
                >
                  <Text style={styles.modalItemLabel}>{item.ar}</Text>
                  <Text style={styles.modalItemSub}>{item.value}</Text>
                </Pressable>
              )}
            />
            <Pressable onPress={() => setCityPickerVisible(false)} style={styles.modalCloseBtn}>
              <Text style={styles.modalCloseText}>{arText.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={categoryPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{arText.chooseCategory}</Text>
            <FlatList
              data={categoryList}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalItem}
                  onPress={() => {
                    setCategory(item);
                    setCategoryPickerVisible(false);
                  }}
                >
                  <Text style={styles.modalItemLabel}>{item}</Text>
                </Pressable>
              )}
            />
            <Pressable onPress={() => setCategoryPickerVisible(false)} style={styles.modalCloseBtn}>
              <Text style={styles.modalCloseText}>{arText.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  typeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    borderWidth: 0,
  },
  chipText: { fontSize: 12, fontWeight: "800", color: theme.colors.text },
  chipTextSelected: { color: "#fff" },
  selectorRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  selector: {
    flex: 1,
    padding: 10,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#F9FAFB",
  },
  selectorLabel: {
    fontSize: 10,
    color: theme.colors.text2,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  selectorValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.text,
  },
  selectorValueSub: {
    fontSize: 11,
    color: theme.colors.text2,
    marginTop: 2,
  },
  inputsRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  flexGrow: {
    flex: 1,
  },
  inputWrap: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.colors.text2,
    marginBottom: 4,
  },
  input: {
    height: 40,
    borderRadius: theme.radii.md,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 14,
    color: theme.colors.text,
  },
  inputFocused: {
    borderColor: theme.colors.primary,
    ...theme.shadow,
  },
  clearBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  clearBtnDisabled: {
    opacity: 0.5,
  },
  clearText: {
    fontSize: 12,
    fontWeight: "900",
    color: theme.colors.text,
  },
  clearTextDisabled: {
    color: theme.colors.text2,
  },
  locationBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  locationText: {
    color: theme.colors.snow,
    fontSize: 13,
    fontWeight: "800",
  },
  locationError: {
    marginTop: 4,
    fontSize: 11,
    color: theme.colors.danger,
  },
  activeRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  activeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
  },
  activeChipText: { fontSize: 12, fontWeight: "800", color: theme.colors.primary },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    maxHeight: "70%",
    overflow: "hidden",
    ...theme.shadow,
  },
  modalTitle: {
    padding: 16,
    fontSize: 16,
    fontWeight: "900",
    color: theme.colors.text,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalItemLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.text,
  },
  modalItemSub: {
    fontSize: 12,
    color: theme.colors.text2,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: "900",
    color: theme.colors.primary,
  },
});
