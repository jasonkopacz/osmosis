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
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  CHROME_EXTENSION_ID?: string
  APP_URL?: string
}

export type Variables = { userId: string; email: string; plan: 'free' | 'pro' }

export type TranslationEntry = {
  text: string                                    // primary translation text
  partOfSpeech?: string                           // POS tag: VERB, NOUN, ADJ, ADV, etc.
  alternative?: Array<{ text: string; partOfSpeech: string }> // top alternatives with a different POS
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
