import type { D1Database } from '@cloudflare/workers-types'
import type { SrsCard, SrsStats, DueCard } from '../types'
import type { SchedulingResult } from '../utils/fsrs'

// D1 caps bound params at ~100; word_cards PK has 3 cols + we update 8 cols
const ENCOUNTER_CHUNK_SIZE = 20

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

type CardRow = {
  user_id: string
  word: string
  target_lang: string
  state: string
  stability: number
  difficulty: number
  lapses: number
  reps: number
  due_at: number
  last_rated_at: number | null
  encounter_count: number
  last_seen_at: number
  created_at: number
}

function rowToCard(row: CardRow): SrsCard {
  return {
    userId: row.user_id,
    word: row.word,
    targetLang: row.target_lang,
    state: row.state as SrsCard['state'],
    stability: row.stability,
    difficulty: row.difficulty,
    lapses: row.lapses,
    reps: row.reps,
    dueAt: row.due_at,
    lastRatedAt: row.last_rated_at ?? undefined,
    encounterCount: row.encounter_count,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  }
}

export async function getCard(
  db: D1Database, userId: string, word: string, targetLang: string
): Promise<SrsCard | null> {
  const row = await db
    .prepare('SELECT * FROM word_cards WHERE user_id = ? AND word = ? AND target_lang = ?')
    .bind(userId, word.toLowerCase(), targetLang.toLowerCase())
    .first<CardRow>()
  return row ? rowToCard(row) : null
}

export async function upsertCard(
  db: D1Database, userId: string, word: string, targetLang: string,
  result: SchedulingResult, nowSec: number
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO word_cards
        (user_id, word, target_lang, state, stability, difficulty, lapses, reps,
         due_at, last_rated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, word, target_lang) DO UPDATE SET
        state         = excluded.state,
        stability     = excluded.stability,
        difficulty    = excluded.difficulty,
        lapses        = excluded.lapses,
        reps          = excluded.reps,
        due_at        = excluded.due_at,
        last_rated_at = excluded.last_rated_at,
        last_seen_at  = excluded.last_seen_at
    `)
    .bind(
      userId, word.toLowerCase(), targetLang.toLowerCase(),
      result.state, result.stability, result.difficulty,
      result.lapses, result.reps, result.dueAt, nowSec,
      nowSec
    )
    .run()
}

/**
 * Record passive encounters (words seen on a translated page).
 * Fire-and-forget — does not fail the translate response if this errors.
 * Only increments encounter_count + last_seen_at; never overwrites scheduling state.
 */
export async function batchRecordEncounters(
  db: D1Database, userId: string, words: string[], targetLang: string, nowSec: number
): Promise<void> {
  if (words.length === 0) return
  const lower = words.map(w => w.toLowerCase())
  const lang = targetLang.toLowerCase()
  await db.batch(
    chunk(lower, ENCOUNTER_CHUNK_SIZE).map(batch => {
      const placeholders = batch.map(() => '(?, ?, ?, 1, ?)').join(', ')
      const values = batch.flatMap(w => [userId, w, lang, nowSec])
      return db
        .prepare(`
          INSERT INTO word_cards (user_id, word, target_lang, encounter_count, last_seen_at)
          VALUES ${placeholders}
          ON CONFLICT(user_id, word, target_lang) DO UPDATE SET
            encounter_count = encounter_count + 1,
            last_seen_at    = excluded.last_seen_at
        `)
        .bind(...values)
    })
  )
}

/**
 * Cards due for review, joined with translation_cache for the quiz display.
 * Returns up to `limit` cards ordered by most overdue first.
 */
export async function getDueCards(
  db: D1Database, userId: string, targetLang: string, nowSec: number, limit: number
): Promise<DueCard[]> {
  const lang = targetLang.toLowerCase()
  const { results } = await db
    .prepare(`
      SELECT
        wc.word,
        wc.target_lang,
        wc.state,
        wc.stability,
        wc.difficulty,
        wc.lapses,
        wc.reps,
        wc.due_at,
        wc.last_rated_at,
        tc.translation,
        tc.pos_tag,
        tc.alternatives
      FROM word_cards wc
      LEFT JOIN translation_cache tc
        ON tc.word = wc.word AND tc.target_lang = wc.target_lang
      WHERE wc.user_id = ?
        AND wc.target_lang = ?
        AND wc.due_at <= ?
        AND wc.reps > 0
      ORDER BY wc.due_at ASC
      LIMIT ?
    `)
    .bind(userId, lang, nowSec, limit)
    .all<{
      word: string; target_lang: string; state: string
      stability: number; difficulty: number; lapses: number; reps: number
      due_at: number; last_rated_at: number | null
      translation: string | null; pos_tag: string | null; alternatives: string | null
    }>()

  return results.map(r => ({
    word: r.word,
    targetLang: r.target_lang,
    state: r.state as DueCard['state'],
    stability: r.stability,
    difficulty: r.difficulty,
    lapses: r.lapses,
    reps: r.reps,
    dueAt: r.due_at,
    lastRatedAt: r.last_rated_at ?? undefined,
    translation: r.translation ?? '',
    posTag: r.pos_tag ?? undefined,
    alternatives: r.alternatives ? tryParse<Array<{ t: string; p: string }>>(r.alternatives) : undefined,
  }))
}

export async function deleteCardForUser(
  db: D1Database, userId: string, word: string, targetLang: string
): Promise<void> {
  await db
    .prepare('DELETE FROM word_cards WHERE user_id = ? AND word = ? AND target_lang = ?')
    .bind(userId, word.toLowerCase(), targetLang.toLowerCase())
    .run()
}

export async function deleteAllCardsForWord(db: D1Database, word: string): Promise<void> {
  await db
    .prepare('DELETE FROM word_cards WHERE word = ?')
    .bind(word.toLowerCase())
    .run()
}

export async function getSrsStats(
  db: D1Database, userId: string, targetLang: string, nowSec: number
): Promise<SrsStats> {
  const lang = targetLang.toLowerCase()
  const todayStart = nowSec - (nowSec % 86400) // floor to day boundary (UTC)

  const row = await db
    .prepare(`
      SELECT
        SUM(CASE WHEN reps > 0                              THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN reps > 0 AND state = 'review'        THEN 1 ELSE 0 END) AS in_review,
        SUM(CASE WHEN reps > 0 AND state = 'relearning'    THEN 1 ELSE 0 END) AS relearning,
        SUM(CASE WHEN last_rated_at >= ?                   THEN 1 ELSE 0 END) AS reviewed_today,
        SUM(CASE WHEN reps > 0 AND due_at <= ?             THEN 1 ELSE 0 END) AS due_count
      FROM word_cards
      WHERE user_id = ? AND target_lang = ?
    `)
    .bind(todayStart, nowSec, userId, lang)
    .first<{ total: number; in_review: number; relearning: number; reviewed_today: number; due_count: number }>()

  return {
    total:         row?.total          ?? 0,
    inReview:      row?.in_review      ?? 0,
    relearning:    row?.relearning     ?? 0,
    reviewedToday: row?.reviewed_today ?? 0,
    dueCount:      row?.due_count      ?? 0,
  }
}

function tryParse<T>(s: string): T | undefined {
  try { return JSON.parse(s) as T } catch { return undefined }
}
