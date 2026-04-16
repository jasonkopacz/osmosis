import type { UserSettings } from "./types";

export const API_BASE_URL = "https://osmosis-api.jtkopacz.workers.dev";
export const FREE_TIER_LIMIT = 50_000;
export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  targetLang: "de",
  percentage: 20
};
export const STORAGE_KEYS = {
  TOKEN: "osmosis_token",
  SETTINGS: "osmosis_settings"
} as const;
