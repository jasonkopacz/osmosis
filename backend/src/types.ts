export type Env = {
  DB: D1Database
  TRANSLATION_CACHE: KVNamespace
  JWT_SECRET: string
  AZURE_TRANSLATOR_KEY: string
  AZURE_TRANSLATOR_REGION: string
  AZURE_SPEECH_KEY?: string
  AZURE_SPEECH_REGION?: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRO_PRICE_ID?: string
  FREE_TIER_CHAR_LIMIT?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_WEB_CLIENT_JSON?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  CHROME_EXTENSION_ID?: string
  EXTENSION_POPUP_PATH?: string
  APP_URL?: string
}

export type Variables = { userId: string; email: string; plan: 'free' | 'pro' }

// Short keys match the runtime JSON sent to/from the extension.
export type TranslationEntry = {
  t: string                               // primary translation text
  p?: string                              // POS tag: VERB, NOUN, ADJ, ADV, etc.
  a?: Array<{ t: string; p: string }>    // top alternatives with a different POS
  n?: string                              // normalizedSource: base/lemma form of the English word
}

export type User = {
  id: string
  email: string
  password_hash: string
  google_sub: string | null
  auth_provider: 'email' | 'google' | 'both'
  stripe_customer_id: string | null
  plan: 'free' | 'pro'
  created_at: number
}

// Safe subset for sending to clients — never includes password_hash
export type PublicUser = Omit<User, 'password_hash'>

// ── SRS types ────────────────────────────────────────────────────────────────

export type SrsCard = {
  userId: string
  word: string
  targetLang: string
  state: 'review' | 'relearning'
  stability: number
  difficulty: number
  lapses: number
  reps: number
  dueAt: number
  lastRatedAt?: number
  encounterCount: number
  lastSeenAt: number
  createdAt: number
}

export type DueCard = {
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
  alternatives?: Array<{ t: string; p: string }>
}

export type SrsStats = {
  total: number
  inReview: number
  relearning: number
  reviewedToday: number
  dueCount: number
}
