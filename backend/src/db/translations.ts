import type { D1Database } from '@cloudflare/workers-types'

export async function getTranslationCached(db: D1Database, word: string, targetLang: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT translation FROM translation_cache WHERE word = ? AND target_lang = ?')
    .bind(word.toLowerCase(), targetLang.toLowerCase())
    .first<{ translation: string }>()
  if (row) {
    await db
      .prepare('UPDATE translation_cache SET hit_count = hit_count + 1 WHERE word = ? AND target_lang = ?')
      .bind(word.toLowerCase(), targetLang.toLowerCase())
      .run()
    return row.translation
  }
  return null
}

export async function setTranslationCached(
  db: D1Database, word: string, targetLang: string, translation: string
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO translation_cache (word, target_lang, translation)
      VALUES (?, ?, ?)
      ON CONFLICT(word, target_lang) DO UPDATE SET translation = excluded.translation, hit_count = hit_count + 1
    `)
    .bind(word.toLowerCase(), targetLang.toLowerCase(), translation)
    .run()
}
