import type { D1Database } from '@cloudflare/workers-types'

export async function getUsage(db: D1Database, userId: string, yearMonth: string): Promise<number> {
  const row = await db
    .prepare('SELECT char_count FROM usage WHERE user_id = ? AND year_month = ?')
    .bind(userId, yearMonth).first<{ char_count: number }>()
  return row?.char_count ?? 0
}

export async function incrementUsage(
  db: D1Database, userId: string, yearMonth: string, chars: number
): Promise<void> {
  await db.prepare(`
    INSERT INTO usage (user_id, year_month, char_count) VALUES (?, ?, ?)
    ON CONFLICT(user_id, year_month) DO UPDATE SET char_count = char_count + excluded.char_count
  `).bind(userId, yearMonth, chars).run()
}
