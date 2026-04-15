import { Hono } from 'hono'
import type { Env, Variables } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { checkUsage } from '../middleware/checkUsage'
import { getCached, setCached } from '../lib/kv'
import { translateWords } from '../lib/azure'
import { incrementUsage } from '../lib/db'

function currentYearMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const translateRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

translateRouter.post('/', requireAuth, checkUsage, async (c) => {
  const { words, targetLang } = await c.req.json<{ words: string[]; targetLang: string }>()
  if (!words?.length || !targetLang) return c.json({ error: 'words and targetLang required' }, 400)
  const uniqueWords = [...new Set(words)]
  console.log(
    `[translate] user ${c.get('userId')} target=${targetLang} requested=${words.length} unique=${uniqueWords.length}`
  )

  const result: Record<string, string> = {}
  const uncached: string[] = []

  await Promise.all(uniqueWords.map(async (word) => {
    const hit = await getCached(c.env.TRANSLATION_CACHE, word, targetLang)
    if (hit) result[word] = hit
    else uncached.push(word)
  }))
  console.log(`[translate] cache hits=${uniqueWords.length - uncached.length} misses=${uncached.length}`)

  if (uncached.length > 0) {
    let translations: Map<string, string>
    try {
      translations = await translateWords(uncached, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
    } catch (err) {
      console.warn(`[translate] azure primary attempt failed, retrying once: ${String(err)}`)
      translations = await translateWords(uncached, targetLang, c.env.AZURE_TRANSLATOR_KEY, c.env.AZURE_TRANSLATOR_REGION)
    }
    const usageDelta = uncached.join('').length
    await incrementUsage(c.env.DB, c.get('userId'), currentYearMonth(), usageDelta)
    console.log(`[translate] incremented usage by ${usageDelta} chars`)
    await Promise.all([...translations.entries()].map(async ([word, translation]) => {
      result[word] = translation
      await setCached(c.env.TRANSLATION_CACHE, word, targetLang, translation)
    }))
  }

  console.log(`[translate] returning ${Object.keys(result).length} translated words`)
  return c.json({ translations: result })
})
