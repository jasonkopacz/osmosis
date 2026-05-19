import type { D1Database } from '@cloudflare/workers-types'

export async function insertBadTranslation(
  db: D1Database,
  userId: string,
  word: string,
  targetLang: string,
  badTranslation: string,
  reason: string | null,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO bad_translation (user_id, word, target_lang, bad_translation, reason) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(userId, word.toLowerCase(), targetLang, badTranslation, reason)
    .run()
}
