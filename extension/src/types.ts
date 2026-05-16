export type Plan = 'free' | 'pro'

export type TranslationEntry = {
  t: string                               // primary translation text
  p?: string                              // POS tag from Azure: VERB, NOUN, ADJ, ADV, etc.
  a?: ReadonlyArray<{ t: string; p: string }> // top alternatives with a different POS
  n?: string                              // normalizedSource: base/lemma form of the English word
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

export function isUserProfile(v: unknown): v is UserProfile {
  return (
    typeof v === 'object' && v !== null &&
    'email' in v && typeof (v as UserProfile).email === 'string' &&
    'plan' in v &&
    'usage' in v && typeof (v as UserProfile).usage === 'object'
  )
}

export type Message =
  | { type: 'TRANSLATE'; words: string[]; targetLang: string; contextsByWord?: Record<string, string> }
  | { type: 'PRONOUNCE'; text: string; targetLang: string }
  | { type: 'GET_USER' }
  | { type: 'SETTINGS_CHANGED'; settings: UserSettings }
  | { type: 'GOOGLE_LOGIN' }
  | { type: 'EMAIL_LOGIN'; email: string; password: string }
  | { type: 'EMAIL_SIGNUP'; email: string; password: string; passwordConfirm: string }
  | { type: 'SESSION_FROM_VERIFY'; token: string; refreshToken?: string }
  | { type: 'FORGOT_PASSWORD'; email: string }
  | { type: 'DELETE_ACCOUNT' }
  | { type: 'SIGN_OUT' }
  | { type: 'SRS_RATE'; word: string; targetLang: string; rating: SrsRating }
  | { type: 'SRS_GET_DUE'; targetLang: string; limit?: number }
  | { type: 'SRS_GET_REVIEW_SESSION'; targetLang: string; limit?: number }
  | { type: 'SRS_SESSION_COMPLETE'; targetLang: string }
  | { type: 'SRS_GET_STATS'; targetLang: string }
  | { type: 'SRS_REPORT_ENCOUNTERS'; words: string[]; targetLang: string }
  | { type: 'SRS_GET_STREAK' }

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
  lemma?: string      // base/lemma form of the English word from Azure normalizedSource
  // Present when card has enough context for a fill-in-the-blank question
  context?: string    // sentence containing the word (UI blanks it)
  choices?: string[]  // shuffled [correct, distractor, distractor, distractor]
}

export type SrsStats = {
  total: number
  inReview: number
  relearning: number
  reviewedToday: number
  dueCount: number
  sessionCount?: number   // words seen since last review session
  reviewReady?: boolean   // sessionCount >= threshold OR dueCount > 0
}

// Re-export from streak module so popup views don't need a deep import
export type { StreakInfo } from './background/streak'

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
