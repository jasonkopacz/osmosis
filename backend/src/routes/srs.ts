import { Hono } from 'hono'
import type { Env, Variables } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { VALID_LANGUAGE_CODES } from '../data/validLanguages'
import { scheduleNew, scheduleExisting, type SrsRating } from '../utils/fsrs'
import { getCard, upsertCard, getDueCards, getSrsStats, batchRecordEncounters } from '../db/srs'

const MAX_DUE_LIMIT = 50
const MAX_ENCOUNTER_BATCH = 400

export const srsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /srs/rate
// Rate a word from the tooltip ("I know this" = 4, "Still learning" = 1)
// or from the quiz (1–4). Creates the card if it doesn't exist yet.
srsRouter.post('/rate', requireAuth, async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }

  const { word, targetLang, rating } = body as { word?: unknown; targetLang?: unknown; rating?: unknown }
  if (typeof word !== 'string' || !word.trim()) return c.json({ error: 'word required' }, 400)
  if (typeof targetLang !== 'string' || !VALID_LANGUAGE_CODES.has(targetLang)) return c.json({ error: 'Invalid targetLang' }, 400)
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 4) {
    return c.json({ error: 'rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)' }, 400)
  }

  const userId = c.get('userId')
  const r = rating as SrsRating
  const nowSec = Math.floor(Date.now() / 1000)
  const existing = await getCard(c.env.DB, userId, word, targetLang)

  const result = existing && existing.reps > 0
    ? scheduleExisting(
        {
          stability: existing.stability,
          difficulty: existing.difficulty,
          lapses: existing.lapses,
          reps: existing.reps,
          state: existing.state,
          lastRatedAt: existing.lastRatedAt ?? 0,
        },
        r,
        nowSec
      )
    : scheduleNew(r, nowSec)

  await upsertCard(c.env.DB, userId, word, targetLang, result, nowSec)

  console.log(`[srs/rate] user=${userId} word=${word} lang=${targetLang} rating=${r} interval=${result.intervalDays}d state=${result.state}`)
  return c.json({
    word: word.toLowerCase(),
    targetLang,
    state: result.state,
    intervalDays: result.intervalDays,
    dueAt: result.dueAt,
    stability: result.stability,
    difficulty: result.difficulty,
    lapses: result.lapses,
    reps: result.reps,
  })
})

// POST /srs/encounters
// Report words passively seen on a page (fire-and-forget; never blocks translate).
srsRouter.post('/encounters', requireAuth, async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }

  const { words, targetLang } = body as { words?: unknown; targetLang?: unknown }
  if (!Array.isArray(words) || words.length === 0) return c.json({ error: 'words array required' }, 400)
  if (typeof targetLang !== 'string' || !VALID_LANGUAGE_CODES.has(targetLang)) return c.json({ error: 'Invalid targetLang' }, 400)

  const safeWords = (words as unknown[])
    .filter((w): w is string => typeof w === 'string' && w.length > 0 && w.length <= 100)
    .slice(0, MAX_ENCOUNTER_BATCH)

  const userId = c.get('userId')
  const nowSec = Math.floor(Date.now() / 1000)

  // Run as background task so the response is immediate
  const task = batchRecordEncounters(c.env.DB, userId, safeWords, targetLang, nowSec)
    .catch(err => console.warn(`[srs/encounters] batch write failed: ${String(err)}`))

  try {
    c.executionCtx.waitUntil(task)
  } catch {
    void task
  }

  return c.json({ ok: true, recorded: safeWords.length })
})

// GET /srs/due?lang=es&limit=20
// Returns cards due for review, with translation data for the quiz.
srsRouter.get('/due', requireAuth, async (c) => {
  const lang = c.req.query('lang')
  if (!lang || !VALID_LANGUAGE_CODES.has(lang)) return c.json({ error: 'Valid lang query param required' }, 400)

  const limitParam = parseInt(c.req.query('limit') ?? '', 10)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_DUE_LIMIT) : 20

  const userId = c.get('userId')
  const nowSec = Math.floor(Date.now() / 1000)
  const cards = await getDueCards(c.env.DB, userId, lang, nowSec, limit)

  console.log(`[srs/due] user=${userId} lang=${lang} due=${cards.length}`)
  return c.json({ cards })
})

// GET /srs/stats?lang=es
// Vocabulary breakdown and review counts for the progress view.
srsRouter.get('/stats', requireAuth, async (c) => {
  const lang = c.req.query('lang')
  if (!lang || !VALID_LANGUAGE_CODES.has(lang)) return c.json({ error: 'Valid lang query param required' }, 400)

  const userId = c.get('userId')
  const nowSec = Math.floor(Date.now() / 1000)
  const stats = await getSrsStats(c.env.DB, userId, lang, nowSec)

  return c.json(stats)
})
