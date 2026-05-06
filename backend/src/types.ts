export type Env = {
  DB: D1Database
  TRANSLATION_CACHE: KVNamespace
  JWT_SECRET: string
  AZURE_TRANSLATOR_KEY: string
  AZURE_TRANSLATOR_REGION: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRO_PRICE_ID?: string
  FREE_TIER_CHAR_LIMIT?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_WEB_CLIENT_JSON?: string
  META_CLIENT_ID?: string
  META_CLIENT_SECRET?: string
  APPLE_CLIENT_ID?: string
  APPLE_CLIENT_SECRET?: string
  MICROSOFT_CLIENT_ID?: string
  MICROSOFT_CLIENT_SECRET?: string
}

export type Variables = { userId: string; email: string; plan: string }

export type TranslationEntry = {
  t: string                               // primary translation text
  p?: string                              // POS tag: VERB, NOUN, ADJ, ADV, etc.
  a?: Array<{ t: string; p: string }>     // top alternatives with a different POS
}

export type User = {
  id: string
  email: string
  password_hash: string
  google_sub: string | null
  meta_sub: string | null
  apple_sub: string | null
  microsoft_sub: string | null
  auth_provider: 'email' | 'google' | 'meta' | 'apple' | 'microsoft' | 'both'
  stripe_customer_id: string | null
  plan: 'free' | 'pro'
  created_at: number
}
