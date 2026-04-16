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
}

export type Variables = { userId: string; email: string; plan: string }

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
