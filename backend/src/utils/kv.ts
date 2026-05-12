import type { TranslationEntry } from '../types'

export async function getCached(kv: KVNamespace, word: string, lang: string): Promise<TranslationEntry | null> {
  const raw = await kv.get(`${word.toLowerCase()}:${lang.toLowerCase()}`)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as TranslationEntry
    if (typeof parsed.t === 'string') return parsed
  } catch {}
  return { t: raw } // backwards compat: old entries were plain strings
}

const KV_TTL_SECS = 30 * 24 * 60 * 60 // 30 days

export async function setCached(kv: KVNamespace, word: string, lang: string, entry: TranslationEntry): Promise<void> {
  await kv.put(`${word.toLowerCase()}:${lang.toLowerCase()}`, JSON.stringify(entry), { expirationTtl: KV_TTL_SECS })
}
