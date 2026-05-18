import type { UserSettings } from "./types";

// Override at build time with VITE_API_BASE_URL for local dev or staging.
export const API_BASE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_API_BASE_URL ?? "https://osmosis-api.jtkopacz.workers.dev";
export const FREE_TIER_LIMIT = 50_000;
export const MIN_TRANSLATION_PERCENTAGE = 10;
export const MAX_TRANSLATION_PERCENTAGE = 90;
export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  targetLang: "es",
  percentage: 20,
  cefrMinLevel: 'all',
};
export const REVIEW_THRESHOLD = 25

export const STORAGE_KEYS = {
  TOKEN: "osmosis_token",
  REFRESH_TOKEN: "osmosis_refresh_token",
  SETTINGS: "osmosis_settings",
  USER_PROFILE_CACHE: "osmosis_user_profile_cache",
  TRANSLATION_CACHE: "osmosis_translation_cache",
  PAGE_STATS: "osmosis_page_stats",
  ONBOARDED: "osmosis_onboarded",
  SESSION_WORDS: "osmosis_session_words",
} as const;
