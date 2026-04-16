import { Hono } from 'hono'
import type { Env, Variables } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { checkUsage } from '../middleware/checkUsage'
import { getCached, setCached } from '../utils/kv'
import { translateWords } from '../services/azure'
import { incrementUsage } from '../db/usage'
import { getTranslationCached, setTranslationCached } from '../db/translations'

function currentYearMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const translateRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

translateRouter.post('/', requireAuth, checkUsage, async (c) => {
  const { words, targetLang } = await c.req.json<{ words: unknown[]; targetLang: string }>()
  if (!Array.isArray(words) || !words.length || !targetLang) return c.json({ error: 'words and targetLang required' }, 400)
  if (words.length > 250) return c.json({ error: 'Too many words (max 250 per request)' }, 400)
  if (words.some(w => typeof w !== 'string' || w.length > 200)) return c.json({ error: 'Invalid words array' }, 400)
  const uniqueWords = [...new Set(words as string[])]
  console.log(
    `[translate] user ${c.get('userId')} target=${targetLang} requested=${words.length} unique=${uniqueWords.length}`
  )

  const result: Record<string, string> = {}

  // Layer 1: D1 database cache (permanent)
  const d1Results = await Promise.all(
    uniqueWords.map(word => getTranslationCached(c.env.DB, word, targetLang).then(hit => ({ word, hit })))
  )
  const afterD1: string[] = []
  for (const { word, hit } of d1Results) {
    if (hit) result[word] = hit
    else afterD1.push(word)
  }

  // Layer 2: KV cache (permanent, lower latency)
  const kvResults = await Promise.all(
    afterD1.map(word => getCached(c.env.TRANSLATION_CACHE, word, targetLang).then(hit => ({ word, hit })))
  )
  const uncached: string[] = []
  for (const { word, hit } of kvResults) {
    if (hit) {
      result[word] = hit
      // Backfill into D1 so future hits are served from there
      void setTranslationCached(c.env.DB, word, targetLang, hit)
    } else {
      uncached.push(word)
    }
  }
  console.log(`[translate] d1_hits=${uniqueWords.length - afterD1.length} kv_hits=${afterD1.length - uncached.length} misses=${uncached.length}`)

  if (uncached.length > 0) {
    let translations: Map<string, string>
    try {
      translations = await translateWords(uncached, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
    } catch (err) {
      console.warn(`[translate] azure primary attempt failed, retrying once: ${String(err)}`)
      try {
        translations = await translateWords(uncached, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
      } catch (retryErr) {
        console.error(`[translate] azure retry also failed: ${String(retryErr)}`)
        return c.json({ error: 'Translation service unavailable' }, 503)
      }
    }
    const usageDelta = uncached.join('').length
    await incrementUsage(c.env.DB, c.get('userId'), currentYearMonth(), usageDelta)
    console.log(`[translate] incremented usage by ${usageDelta} chars`)
    await Promise.all([...translations.entries()].map(async ([word, translation]) => {
      result[word] = translation
      await Promise.all([
        setCached(c.env.TRANSLATION_CACHE, word, targetLang, translation),
        setTranslationCached(c.env.DB, word, targetLang, translation),
      ])
    }))
  }

  console.log(`[translate] returning ${Object.keys(result).length} translated words`)
  return c.json({ translations: result })
})
