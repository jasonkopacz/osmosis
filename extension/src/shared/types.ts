export type Plan = 'free' | 'pro'

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
  | { type: 'EMAIL_LOGIN'; email: string; password: string }
  | { type: 'EMAIL_SIGNUP'; email: string; password: string }
