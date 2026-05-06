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
}

export type UserProfile = {
  email: string
  plan: Plan
  usage: { used: number; limit: number | null; resetsAt: string }
}

export type Message =
  | { type: 'TRANSLATE'; words: string[]; targetLang: string }
  | { type: 'GET_USER' }
  | { type: 'SETTINGS_CHANGED'; settings: UserSettings }
  | { type: 'GOOGLE_LOGIN' }
