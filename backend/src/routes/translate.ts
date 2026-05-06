import { Hono } from 'hono'
import type { Env, Variables, TranslationEntry } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { checkUsage } from '../middleware/checkUsage'
import { getCached, setCached } from '../utils/kv'
import { lookupWords, translateWords } from '../services/azure'
import { incrementUsage } from '../db/usage'
import { getTranslationsCachedBatch, setTranslationCached, batchIncrementHitCount, getTopTranslations } from '../db/translations'
import { freeTierCharLimit } from '../utils/limits'
import { currentYearMonth } from '../utils/date'
import { VALID_LANGUAGE_CODES } from '../data/validLanguages'

// Must match MAX_WORDS in extension/src/content/scorer.ts
const MAX_WORDS_PER_BATCH = 200
const MAX_POPULAR_LIMIT = 500

export const translateRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

translateRouter.get('/popular', requireAuth, async (c) => {
  const lang = c.req.query('lang')
  if (!lang || !VALID_LANGUAGE_CODES.has(lang)) return c.json({ error: 'Valid lang query param required' }, 400)
  const limitParam = parseInt(c.req.query('limit') ?? '', 10)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_POPULAR_LIMIT) : MAX_POPULAR_LIMIT
  const rows = await getTopTranslations(c.env.DB, lang, limit)
  const translations = Object.fromEntries(rows.map(r => [r.word, r.entry]))
  console.log(`[translate/popular] lang=${lang} limit=${limit} returned=${rows.length}`)
  return c.json({ translations })
})

translateRouter.post('/', requireAuth, checkUsage, async (c) => {
  const { words, targetLang } = await c.req.json<{ words: unknown[]; targetLang: string }>()
  if (!Array.isArray(words) || !words.length || !targetLang) return c.json({ error: 'words and targetLang required' }, 400)
  if (!VALID_LANGUAGE_CODES.has(targetLang)) return c.json({ error: 'Invalid targetLang' }, 400)
  if (words.length > MAX_WORDS_PER_BATCH) return c.json({ error: `Too many words (max ${MAX_WORDS_PER_BATCH} per request)` }, 400)
  if (words.some(w => typeof w !== 'string' || w.length > 200)) return c.json({ error: 'Invalid words array' }, 400)

  const uniqueWords = [...new Set(words as string[])]
  console.log(`[translate] user=${c.get('userId')} lang=${targetLang} requested=${words.length} unique=${uniqueWords.length}`)

  const result: Record<string, TranslationEntry> = {}
  const backgroundTasks: Promise<unknown>[] = []

  // Layer 1: D1 database (single batch query)
  const d1Map = await getTranslationsCachedBatch(c.env.DB, uniqueWords, targetLang)
  const afterD1: string[] = []
  const d1Words: string[] = []
  for (const word of uniqueWords) {
    const hit = d1Map.get(word.toLowerCase())
    if (hit) { result[word] = hit; d1Words.push(word) }
    else afterD1.push(word)
  }
  if (d1Words.length > 0) {
    backgroundTasks.push(
      batchIncrementHitCount(c.env.DB, d1Words, targetLang)
        .catch(err => console.warn(`[translate] hit_count increment failed: ${String(err)}`))
    )
  }

  // Layer 2: KV cache (fallback for D1 write failures)
  const kvResults = await Promise.all(
    afterD1.map(word => getCached(c.env.TRANSLATION_CACHE, word, targetLang).then(hit => ({ word, hit })))
  )
  const uncached: string[] = []
  const kvWords: string[] = []
  for (const { word, hit } of kvResults) {
    if (hit) {
      result[word] = hit
      kvWords.push(word)
      backgroundTasks.push(
        setTranslationCached(c.env.DB, word, targetLang, hit)
          .catch(err => console.warn(`[translate] D1 backfill failed for "${word}": ${String(err)}`))
      )
    } else {
      uncached.push(word)
    }
  }
  // kv_hit_rate = kvWords / afterD1 — if consistently 0%, KV layer can be removed
  console.log(`[translate] layers: d1=${d1Words.length} kv=${kvWords.length}(rate=${afterD1.length > 0 ? ((kvWords.length / afterD1.length) * 100).toFixed(0) : 0}%) uncached=${uncached.length} total=${uniqueWords.length}`)

  if (uncached.length > 0) {
    // Layer 3a: Azure Dictionary Lookup (preferred — returns POS + alternatives)
    let lookupHits = new Map<string, TranslationEntry>()
    try {
      lookupHits = await lookupWords(uncached, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
    } catch (err) {
      console.warn(`[translate] dict lookup failed, falling back to translate for all: ${String(err)}`)
    }

    // Layer 3b: Azure /translate for words with no dictionary entry
    const needsTranslate = uncached.filter(w => !lookupHits.has(w))
    let translateHits = new Map<string, TranslationEntry>()
    if (needsTranslate.length > 0) {
      try {
        translateHits = await translateWords(needsTranslate, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
      } catch (err) {
        console.warn(`[translate] azure translate primary attempt failed, retrying: ${String(err)}`)
        try {
          translateHits = await translateWords(needsTranslate, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
        } catch (retryErr) {
          console.error(`[translate] azure retry also failed: ${String(retryErr)}`)
          return c.json({ error: 'Translation service unavailable' }, 503)
        }
      }
    }

    const allNew = new Map<string, TranslationEntry>([...lookupHits, ...translateHits])
    console.log(`[translate] azure: lookup=${lookupHits.size} translate=${translateHits.size}`)

    // Charge for all words that required any API call
    const usageDelta = [...allNew.keys()].join('').length
    if (usageDelta > 0 && c.get('plan') !== 'pro') {
      const newTotal = await incrementUsage(c.env.DB, c.get('userId'), currentYearMonth(), usageDelta)
      const limit = freeTierCharLimit(c.env)
      if (newTotal > limit) {
        console.warn(`[translate] user ${c.get('userId')} exceeded limit (${newTotal}/${limit})`)
        return c.json({ error: 'Monthly limit reached', code: 'LIMIT_REACHED' }, 402)
      }
      console.log(`[translate] charged ${usageDelta} chars, new total=${newTotal}`)
    } else if (usageDelta > 0) {
      await incrementUsage(c.env.DB, c.get('userId'), currentYearMonth(), usageDelta)
      console.log(`[translate] pro user, charged ${usageDelta} chars (no limit)`)
    }

    for (const [word, entry] of allNew.entries()) {
      result[word] = entry
    }

    backgroundTasks.push(
      ...([...allNew.entries()].map(([word, entry]) =>
        Promise.all([
          setCached(c.env.TRANSLATION_CACHE, word, targetLang, entry)
            .catch(err => console.warn(`[translate] KV write failed for "${word}": ${String(err)}`)),
          setTranslationCached(c.env.DB, word, targetLang, entry)
            .catch(err => console.warn(`[translate] D1 write failed for "${word}": ${String(err)}`)),
        ])
      ))
    )
  }

  if (backgroundTasks.length > 0) {
    const all = Promise.all(backgroundTasks)
    try {
      c.executionCtx.waitUntil(all)
    } catch {
      void all // test / non-CF environments don't provide ExecutionContext
    }
  }

  console.log(`[translate] returning ${Object.keys(result).length} translated words`)
  return c.json({ translations: result })
})
