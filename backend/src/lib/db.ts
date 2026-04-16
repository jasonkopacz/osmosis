import type { D1Database } from '@cloudflare/workers-types'
import type { User } from '../types'

export class DuplicateEmailError extends Error {
  constructor() { super('Email already registered'); this.name = 'DuplicateEmailError' }
}

export async function createUser(db: D1Database, email: string, passwordHash: string): Promise<void> {
  try {
    await db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(email, passwordHash).run()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new DuplicateEmailError()
    }
    throw err
  }
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const result = await db.prepare('SELECT id, email, password_hash, google_sub, auth_provider, stripe_customer_id, plan, created_at FROM users WHERE email = ?').bind(email).first<User>()
  return result ?? null
}

export async function findUserByGoogleSub(db: D1Database, googleSub: string): Promise<User | null> {
  const result = await db.prepare('SELECT * FROM users WHERE google_sub = ?').bind(googleSub).first<User>()
  return result ?? null
}

export async function createGoogleUser(
  db: D1Database,
  email: string,
  googleSub: string,
  passwordHash: string
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO users (email, password_hash, google_sub, auth_provider) VALUES (?, ?, ?, ?)'
      )
      .bind(email, passwordHash, googleSub, 'google')
      .run()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new DuplicateEmailError()
    }
    throw err
  }
}

export async function linkGoogleToEmailUser(db: D1Database, userId: string, googleSub: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET google_sub = ?, auth_provider = CASE WHEN auth_provider = 'email' THEN 'both' ELSE auth_provider END WHERE id = ?`
    )
    .bind(googleSub, userId)
    .run()
}

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

export async function updatePlan(
  db: D1Database, userId: string, plan: 'free' | 'pro', stripeCustomerId: string
): Promise<void> {
  const result = await db.prepare('UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?')
    .bind(plan, stripeCustomerId, userId).run()
  if (result.meta.changes === 0) throw new Error(`updatePlan: no user found for id ${userId}`)
}

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
