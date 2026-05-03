import type { D1Database } from '@cloudflare/workers-types'

/**
 * Returns the cached translation and increments hit_count in one atomic operation.
 * Returns null if no cached entry exists.
 */
export async function getTranslationCached(db: D1Database, word: string, targetLang: string): Promise<string | null> {
  const row = await db
    .prepare(`
      UPDATE translation_cache
      SET hit_count = hit_count + 1
      WHERE word = ? AND target_lang = ?
      RETURNING translation
    `)
    .bind(word.toLowerCase(), targetLang.toLowerCase())
    .first<{ translation: string }>()
  return row?.translation ?? null
}

/**
 * Batch version of getTranslationCached. Fetches all matching translations in a single query
 * and increments hit_count for each hit atomically. Returns a Map keyed by lowercased word.
 */
export async function getTranslationsCachedBatch(
  db: D1Database, words: string[], targetLang: string
): Promise<Map<string, string>> {
  if (words.length === 0) return new Map()
  const lower = words.map(w => w.toLowerCase())
  const placeholders = lower.map(() => '?').join(', ')
  const { results } = await db
    .prepare(`
      UPDATE translation_cache
      SET hit_count = hit_count + 1
      WHERE target_lang = ? AND word IN (${placeholders})
      RETURNING word, translation
    `)
    .bind(targetLang.toLowerCase(), ...lower)
    .all<{ word: string; translation: string }>()
  return new Map(results.map(r => [r.word, r.translation]))
}

/** Writes a translation to the cache. Does not touch hit_count — only reads should increment it. */
export async function setTranslationCached(
  db: D1Database, word: string, targetLang: string, translation: string
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO translation_cache (word, target_lang, translation, hit_count)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(word, target_lang) DO UPDATE SET translation = excluded.translation
    `)
    .bind(word.toLowerCase(), targetLang.toLowerCase(), translation)
    .run()
}

/** Returns the top N most frequently served translations for a given language. */
export async function getTopTranslations(
  db: D1Database, targetLang: string, limit = 20
): Promise<Array<{ word: string; translation: string; hit_count: number }>> {
  const { results } = await db
    .prepare(`
      SELECT word, translation, hit_count
      FROM translation_cache
      WHERE target_lang = ?
      ORDER BY hit_count DESC
      LIMIT ?
    `)
    .bind(targetLang.toLowerCase(), limit)
    .all<{ word: string; translation: string; hit_count: number }>()
  return results
}
