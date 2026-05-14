import type { D1Database } from '@cloudflare/workers-types'
import type { User } from '../types'

const USER_COLUMNS = 'id, email, password_hash, google_sub, auth_provider, stripe_customer_id, plan, email_verified, created_at'

export class DuplicateEmailError extends Error {
  constructor() { super('Email already registered'); this.name = 'DuplicateEmailError' }
}

export async function createUser(db: D1Database, email: string, passwordHash: string): Promise<string> {
  try {
    const row = await db
      .prepare('INSERT INTO users (email, password_hash, email_verified) VALUES (?, ?, 0) RETURNING id')
      .bind(email, passwordHash)
      .first<{ id: string }>()
    if (!row) throw new Error('createUser: no id returned')
    return row.id
  } catch (err) {
    const msg = String(err)
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new DuplicateEmailError()
    }
    throw err
  }
}

export async function findUserById(db: D1Database, userId: string): Promise<User | null> {
  const result = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(userId).first<User>()
  return result ?? null
}

export async function verifyUserEmail(db: D1Database, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run()
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const result = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).bind(email).first<User>()
  return result ?? null
}

export async function findUserByGoogleSub(db: D1Database, googleSub: string): Promise<User | null> {
  const result = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`).bind(googleSub).first<User>()
  return result ?? null
}

export async function findUserByStripeCustomerId(db: D1Database, customerId: string): Promise<{ id: string } | null> {
  return db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(customerId).first<{ id: string }>() ?? null
}

export async function createGoogleUser(
  db: D1Database,
  email: string,
  googleSub: string,
  passwordHash: string
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO users (email, password_hash, google_sub, auth_provider, email_verified) VALUES (?, ?, ?, ?, 1)')
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
    .prepare(`UPDATE users SET google_sub = ?, auth_provider = CASE WHEN auth_provider = 'email' THEN 'both' ELSE auth_provider END WHERE id = ?`)
    .bind(googleSub, userId)
    .run()
}

export async function updatePassword(db: D1Database, userId: string, passwordHash: string): Promise<void> {
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, userId).run()
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  // usage rows cascade-delete via FK ON DELETE CASCADE
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
}

export async function updatePlan(
  db: D1Database, userId: string, plan: 'free' | 'pro', stripeCustomerId: string
): Promise<void> {
  const result = await db.prepare('UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?')
    .bind(plan, stripeCustomerId, userId).run()
  if (result.meta.changes === 0) throw new Error(`updatePlan: no user found for id ${userId}`)
}
