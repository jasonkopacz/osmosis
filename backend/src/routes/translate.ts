import { Hono } from 'hono'
import type { Env, Variables } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { checkUsage } from '../middleware/checkUsage'
import { getCached, setCached } from '../utils/kv'
import { translateWords } from '../services/azure'
import { getUsage, incrementUsage } from '../db/usage'
import { getTranslationCached, setTranslationCached } from '../db/translations'
import { freeTierCharLimit } from '../utils/limits'
import { currentYearMonth } from '../utils/date'
import { VALID_LANGUAGE_CODES } from '../data/validLanguages'

// Must match MAX_WORDS in extension/src/content/scorer.ts
const MAX_WORDS_PER_BATCH = 200

export const translateRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

translateRouter.post('/', requireAuth, checkUsage, async (c) => {
  const { words, targetLang } = await c.req.json<{ words: unknown[]; targetLang: string }>()
  if (!Array.isArray(words) || !words.length || !targetLang) return c.json({ error: 'words and targetLang required' }, 400)
  if (!VALID_LANGUAGE_CODES.has(targetLang)) return c.json({ error: 'Invalid targetLang' }, 400)
  if (words.length > MAX_WORDS_PER_BATCH) return c.json({ error: `Too many words (max ${MAX_WORDS_PER_BATCH} per request)` }, 400)
  if (words.some(w => typeof w !== 'string' || w.length > 200)) return c.json({ error: 'Invalid words array' }, 400)

  const uniqueWords = [...new Set(words as string[])]
  console.log(`[translate] user=${c.get('userId')} lang=${targetLang} requested=${words.length} unique=${uniqueWords.length}`)

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
      void setTranslationCached(c.env.DB, word, targetLang, hit) // backfill D1
    } else {
      uncached.push(word)
    }
  }
  console.log(`[translate] d1_hits=${uniqueWords.length - afterD1.length} kv_hits=${afterD1.length - uncached.length} misses=${uncached.length}`)

  if (uncached.length > 0) {
    if (c.get('plan') !== 'pro') {
      const existing = await getUsage(c.env.DB, c.get('userId'), currentYearMonth())
      const limit = freeTierCharLimit(c.env)
      const preflightDelta = uncached.join('').length
      console.log(`[translate] preflight usage check user=${c.get('userId')} existing=${existing} delta=${preflightDelta} limit=${limit}`)
      if (existing + preflightDelta > limit) {
        console.warn(`[translate] preflight limit hit, skipping Azure call user=${c.get('userId')} would_be_total=${existing + preflightDelta}/${limit}`)
        return c.json({ error: 'Monthly limit reached', code: 'LIMIT_REACHED' }, 402)
      }
    }

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

    // Charge based on total source characters sent to Azure (source chars, not target chars)
    const usageDelta = [...translations.keys()].join('').length
    if (usageDelta > 0 && c.get('plan') !== 'pro') {
      const newTotal = await incrementUsage(c.env.DB, c.get('userId'), currentYearMonth(), usageDelta)
      const limit = freeTierCharLimit(c.env)
      if (newTotal > limit) {
        console.warn(`[translate] user ${c.get('userId')} exceeded limit after this request (${newTotal}/${limit})`)
        return c.json({ error: 'Monthly limit reached', code: 'LIMIT_REACHED' }, 402)
      }
      console.log(`[translate] charged ${usageDelta} chars, new total=${newTotal}`)
    } else if (usageDelta > 0) {
      await incrementUsage(c.env.DB, c.get('userId'), currentYearMonth(), usageDelta)
      console.log(`[translate] pro user, charged ${usageDelta} chars (no limit)`)
    }

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
