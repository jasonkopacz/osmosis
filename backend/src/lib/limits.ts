import type { Env } from '../types'

const DEFAULT_FREE_TIER_CHARS = 50_000

export function freeTierCharLimit(env: Env): number {
  const raw = env.FREE_TIER_CHAR_LIMIT
  if (raw === undefined || raw === '') return DEFAULT_FREE_TIER_CHARS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FREE_TIER_CHARS
}
