export type SearchTypeFilter = "all" | "services" | "items" | "providers";

export type UserLocation = {
  lat: number;
  lon: number;
};

export type SearchResult = {
  id: string;
  title: string;
  type: "service" | "item" | "provider";
  city?: string;
  category?: string;
  priceFrom?: number;
  rating?: number;
  thumb?: string;
  // Optional extra fields (used by static/offline directories and future enrichments)
  description?: string;
  source?: string;
  lat?: number;
  lon?: number;
  distanceKm?: number;
};

export type SearchResponse = {
  query: string;
  page: number;
  limit: number;
  total: number;
  results: SearchResult[];
};

export type SearchFilters = {
  type: SearchTypeFilter;
  city: string;
  category: string;
};

export type Message =
  | { id: string; role: "user"; text: string; createdAt: number }
  | { id: string; role: "bot"; kind: "status"; text: string; createdAt: number }
  | {
      id: string;
      role: "bot";
      kind: "results";
      query: string;
      assistantText?: string;
      suggestions?: string[];
      results: SearchResult[];
      page: number;
      hasMore: boolean;
      createdAt: number;
    };
