export type CityEntry = {
  value: string;
  ar: string;
  center?: { lat: number; lng: number };
};

export const cityList: CityEntry[] = [
  { value: "Tripoli", ar: "طرابلس", center: { lat: 32.8872, lng: 13.1913 } },
  { value: "Benghazi", ar: "بنغازي", center: { lat: 32.1167, lng: 20.0667 } },
  { value: "Misrata", ar: "مصراتة", center: { lat: 32.3783, lng: 15.0906 } },
  { value: "Al Bayda", ar: "البيضاء", center: { lat: 32.7627, lng: 21.7551 } },
  { value: "Tobruk", ar: "طبرق", center: { lat: 32.0767, lng: 23.9617 } },
  { value: "Sirte", ar: "سرت", center: { lat: 31.2000, lng: 16.6000 } },
  { value: "Sabha", ar: "سبها", center: { lat: 27.0377, lng: 14.4283 } },
  { value: "Zawiya", ar: "الزاوية", center: { lat: 32.7571, lng: 12.7276 } },
  { value: "Zliten", ar: "زلتن", center: { lat: 32.4674, lng: 14.5687 } },
  { value: "Khoms", ar: "الخمس", center: { lat: 32.6486, lng: 14.2619 } },
  { value: "Ajdabiya", ar: "أجدابيا", center: { lat: 30.7554, lng: 20.2263 } },
  { value: "Derna", ar: "درنة", center: { lat: 32.7689, lng: 22.6392 } },
  { value: "Ghat", ar: "غات", center: { lat: 24.9647, lng: 10.1728 } },
  { value: "Ghadames", ar: "غدامس", center: { lat: 30.1337, lng: 9.5007 } },
  { value: "Nalut", ar: "نالو", center: { lat: 31.8733, lng: 10.9819 } },
  { value: "Gharyan", ar: "غريان", center: { lat: 32.1722, lng: 13.0206 } },
  { value: "Tarhuna", ar: "ترهونة", center: { lat: 32.4350, lng: 13.6336 } },
  { value: "Bani Walid", ar: "بني وليد", center: { lat: 31.7566, lng: 13.9916 } },
  { value: "Sabratha", ar: "صبراتة", center: { lat: 32.7934, lng: 12.4885 } },
  { value: "Surman", ar: "صرمان", center: { lat: 32.7567, lng: 12.5717 } },
  { value: "Janzour", ar: "جنزور", center: { lat: 32.8256, lng: 13.0033 } },
  { value: "Msallata", ar: "مصراتة", center: { lat: 32.6167, lng: 14.0000 } },
  { value: "Tajoura", ar: "تاجوراء", center: { lat: 32.8280, lng: 13.4000 } },
  { value: "Al Marj", ar: "المرج", center: { lat: 32.5000, lng: 20.8333 } },
  { value: "Al Qubba", ar: "القبة", center: { lat: 32.7586, lng: 22.2572 } },
  { value: "Shahat", ar: "شحات", center: { lat: 32.8270, lng: 21.8578 } },
  { value: "Al Abyar", ar: "البيار", center: { lat: 32.1875, lng: 20.5969 } },
  { value: "Maradah", ar: "المراده", center: { lat: 30.4200, lng: 19.2000 } },
  { value: "Ras Lanuf", ar: "رأس لانوف", center: { lat: 30.5000, lng: 18.5667 } },
  { value: "Brega", ar: "البريقة", center: { lat: 30.4167, lng: 19.5833 } },
  { value: "Brak al-Shati", ar: "برق الشت", center: { lat: 27.5496, lng: 14.2712 } },
  { value: "Murzuq", ar: "مرزق", center: { lat: 25.9155, lng: 13.9182 } },
  { value: "Ubari", ar: "أوباري", center: { lat: 26.5900, lng: 12.7800 } },
  { value: "Zuwara", ar: "زوارا", center: { lat: 32.9347, lng: 12.0791 } },
  { value: "Qaminis", ar: "قمنيس", center: { lat: 31.6500, lng: 20.0167 } },
  { value: "Al Kufrah", ar: "الكفرة", center: { lat: 24.2000, lng: 23.3000 } },
  { value: "Jalu", ar: "جالو", center: { lat: 29.0333, lng: 21.5500 } },
  { value: "Jikharra", ar: "جيخرة", center: { lat: 29.7000, lng: 21.5500 } },
  { value: "Hun", ar: "هون", center: { lat: 29.1167, lng: 15.9333 } },
  { value: "Waddan", ar: "وادرن", center: { lat: 29.1600, lng: 16.1667 } },
  { value: "Mizda", ar: "مزدة", center: { lat: 31.4500, lng: 12.9833 } },
  { value: "Yafran", ar: "يفرن", center: { lat: 32.0644, lng: 12.5289 } },
  { value: "Zintan", ar: "زنتان", center: { lat: 31.9346, lng: 12.2519 } },
  { value: "Rujban", ar: "رجبان", center: { lat: 31.9444, lng: 12.2417 } },
  { value: "Kikla", ar: "كيكلى", center: { lat: 31.7361, lng: 12.7944 } },
  { value: "Ar Rayayinah", ar: "الرايينة", center: { lat: 31.9833, lng: 12.7500 } },
  { value: "Qaser Bin Ghashir", ar: "قصر بن غشير", center: { lat: 32.6848, lng: 13.1595 } },
  { value: "Suk al Jumaa", ar: "سوق الجمعة", center: { lat: 32.8819, lng: 13.2917 } },
  { value: "Al Ajaylat", ar: "العجيلات", center: { lat: 32.7581, lng: 12.3761 } },
  { value: "Al Maya", ar: "المايه", center: { lat: 32.7060, lng: 12.6720 } },
  { value: "Tazerbu", ar: "ترزو", center: { lat: 25.5833, lng: 21.1167 } },
  { value: "Al Jaghbub", ar: "الجغبوب", center: { lat: 29.7500, lng: 24.5167 } },
];

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toMeters(distanceKm: number) {
  return distanceKm * 1000;
}

export function formatCityLabel(value: string, locale: "en" | "ar" = "en"): string {
  const found = cityList.find((c) => c.value === value);
  if (!found) return value;
  return locale === "ar" ? `${found.ar}` : `${found.value}`;
}

export function findNearestCity(lat: number, lng: number): CityEntry | null {
  // If the user is not in/near Libya, don't guess a Libyan city.
  // This prevents cases like Canada/Europe being mapped to the "closest" Libyan city.
  if (!(lat >= 19 && lat <= 34.5 && lng >= 9 && lng <= 26)) return null;

  let best: CityEntry | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const targetLat = toRadians(lat);
  const targetLng = toRadians(lng);
  for (const city of cityList) {
    if (!city.center) continue;
    const lat2 = toRadians(city.center.lat);
    const lng2 = toRadians(city.center.lng);
    const dlat = lat2 - targetLat;
    const dlng = lng2 - targetLng;
    const a =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(targetLat) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distKm = EARTH_RADIUS_KM * c;
    if (distKm < bestDist) {
      bestDist = distKm;
      best = city;
    }
  }
  return best;
}
