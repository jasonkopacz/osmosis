export type Plan = 'free' | 'pro'

export type TranslationEntry = {
  t: string                               // primary translation text
  p?: string                              // POS tag from Azure: VERB, NOUN, ADJ, ADV, etc.
  a?: ReadonlyArray<{ t: string; p: string }> // top alternatives with a different POS
}

export type UserSettings = {
  enabled: boolean
  targetLang: string
  percentage: number
  cefrMinLevel: import('./content/cefr').CefrMinLevel
}

export type UserProfile = {
  email: string
  plan: Plan
  usage: { used: number; limit: number | null; resetsAt: string }
}

export type Message =
  | { type: 'TRANSLATE'; words: string[]; targetLang: string; contextsByWord?: Record<string, string> }
  | { type: 'PRONOUNCE'; text: string; targetLang: string }
  | { type: 'GET_USER' }
  | { type: 'SETTINGS_CHANGED'; settings: UserSettings }
  | { type: 'GOOGLE_LOGIN' }
  | { type: 'EMAIL_LOGIN'; email: string; password: string }
  | { type: 'EMAIL_SIGNUP'; email: string; password: string; passwordConfirm: string }
  | { type: 'SESSION_FROM_VERIFY'; token: string }
  | { type: 'FORGOT_PASSWORD'; email: string }
  | { type: 'DELETE_ACCOUNT' }
  | { type: 'SRS_RATE'; word: string; targetLang: string; rating: SrsRating }
  | { type: 'SRS_GET_DUE'; targetLang: string; limit?: number }
  | { type: 'SRS_GET_STATS'; targetLang: string }
  | { type: 'SRS_REPORT_ENCOUNTERS'; words: string[]; targetLang: string }

// 1=Again  2=Hard  3=Good  4=Easy
export type SrsRating = 1 | 2 | 3 | 4

export type SrsDueCard = {
  word: string
  targetLang: string
  state: 'review' | 'relearning'
  stability: number
  difficulty: number
  lapses: number
  reps: number
  dueAt: number
  lastRatedAt?: number
  translation: string
  posTag?: string
  alternatives?: ReadonlyArray<{ t: string; p: string }>
}

export type SrsStats = {
  total: number
  inReview: number
  relearning: number
  reviewedToday: number
  dueCount: number
}

export type SrsRateResult = {
  word: string
  targetLang: string
  state: 'review' | 'relearning'
  intervalDays: number
  dueAt: number
  stability: number
  difficulty: number
  lapses: number
  reps: number
}

// Encounter log stored in chrome.storage.local per language
export type EncounterEntry = {
  count: number
  firstSeen: number  // unix ms
  lastSeen: number   // unix ms
}
