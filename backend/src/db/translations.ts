import type { D1Database } from '@cloudflare/workers-types'
import type { TranslationEntry } from '../types'

// D1 caps bound variables per query at ~100; reserve 1 slot for target_lang
const D1_CHUNK_SIZE = 99
// INSERT rows have 5 bound params each (expires_at is a SQL expression, not a param)
const D1_INSERT_CHUNK_SIZE = Math.floor(D1_CHUNK_SIZE / 5)
// 90 days in seconds
const TRANSLATION_TTL_SECS = 90 * 24 * 60 * 60

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

type CacheRow = { word: string; translation: string; pos_tag: string | null; alternatives: string | null }

function rowToEntry(row: CacheRow): TranslationEntry {
  const entry: TranslationEntry = { t: row.translation }
  if (row.pos_tag) entry.p = row.pos_tag
  if (row.alternatives) {
    try { entry.a = JSON.parse(row.alternatives) as Array<{ t: string; p: string }> } catch {}
  }
  return entry
}

export async function getTranslationsCachedBatch(
  db: D1Database, words: string[], targetLang: string
): Promise<Map<string, TranslationEntry>> {
  if (words.length === 0) return new Map()
  const lower = words.map(w => w.toLowerCase())
  const lang = targetLang.toLowerCase()
  const results = await Promise.all(
    chunk(lower, D1_CHUNK_SIZE).map(batch => {
      const placeholders = batch.map(() => '?').join(', ')
      return db
        .prepare(`SELECT word, translation, pos_tag, alternatives FROM translation_cache WHERE target_lang = ? AND word IN (${placeholders}) AND expires_at > unixepoch()`)
        .bind(lang, ...batch)
        .all<CacheRow>()
        .then(r => r.results)
    })
  )
  return new Map(results.flat().map(r => [r.word, rowToEntry(r)]))
}

export async function batchIncrementHitCount(db: D1Database, words: string[], targetLang: string): Promise<void> {
  if (words.length === 0) return
  const lower = words.map(w => w.toLowerCase())
  const lang = targetLang.toLowerCase()
  await Promise.all(
    chunk(lower, D1_CHUNK_SIZE).map(batch => {
      const placeholders = batch.map(() => '?').join(', ')
      return db
        .prepare(`UPDATE translation_cache SET hit_count = hit_count + 1 WHERE target_lang = ? AND word IN (${placeholders})`)
        .bind(lang, ...batch)
        .run()
    })
  )
}

export async function setTranslationCached(
  db: D1Database, word: string, targetLang: string, entry: TranslationEntry
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO translation_cache (word, target_lang, translation, pos_tag, alternatives, hit_count, expires_at)
      VALUES (?, ?, ?, ?, ?, 0, unixepoch() + ${TRANSLATION_TTL_SECS})
      ON CONFLICT(word, target_lang) DO UPDATE SET
        translation = excluded.translation,
        pos_tag = excluded.pos_tag,
        alternatives = excluded.alternatives,
        expires_at = excluded.expires_at
    `)
    .bind(
      word.toLowerCase(), targetLang.toLowerCase(),
      entry.t,
      entry.p ?? null,
      entry.a ? JSON.stringify(entry.a) : null
    )
    .run()
}

export async function batchSetTranslationCached(
  db: D1Database,
  entries: Array<{ word: string; targetLang: string; entry: TranslationEntry }>,
): Promise<void> {
  if (entries.length === 0) return
  await Promise.all(
    chunk(entries, D1_INSERT_CHUNK_SIZE).map(batch => {
      const placeholders = batch.map(() => `(?, ?, ?, ?, ?, 0, unixepoch() + ${TRANSLATION_TTL_SECS})`).join(', ')
      const values = batch.flatMap(({ word, targetLang, entry }) => [
        word.toLowerCase(), targetLang.toLowerCase(),
        entry.t, entry.p ?? null,
        entry.a ? JSON.stringify(entry.a) : null,
      ])
      return db
        .prepare(`
          INSERT INTO translation_cache (word, target_lang, translation, pos_tag, alternatives, hit_count, expires_at)
          VALUES ${placeholders}
          ON CONFLICT(word, target_lang) DO UPDATE SET
            translation = excluded.translation,
            pos_tag = excluded.pos_tag,
            alternatives = excluded.alternatives,
            hit_count = translation_cache.hit_count,
            expires_at = excluded.expires_at
        `)
        .bind(...values)
        .run()
    })
  )
}

export async function getTopTranslations(
  db: D1Database, targetLang: string, limit = 20
): Promise<Array<{ word: string; entry: TranslationEntry; hit_count: number }>> {
  const { results } = await db
    .prepare(`
      SELECT word, translation, pos_tag, alternatives, hit_count
      FROM translation_cache
      WHERE target_lang = ? AND expires_at > unixepoch()
      ORDER BY hit_count DESC
      LIMIT ?
    `)
    .bind(targetLang.toLowerCase(), limit)
    .all<CacheRow & { hit_count: number }>()
  return results.map(r => ({ word: r.word, entry: rowToEntry(r), hit_count: r.hit_count }))
}
