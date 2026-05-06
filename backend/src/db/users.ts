import type { D1Database } from '@cloudflare/workers-types'
import type { User } from '../types'

const USER_COLUMNS = 'id, email, password_hash, google_sub, meta_sub, apple_sub, microsoft_sub, auth_provider, stripe_customer_id, plan, created_at'

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
      .prepare('INSERT INTO users (email, password_hash, google_sub, auth_provider) VALUES (?, ?, ?, ?)')
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

export async function createMetaUser(
  db: D1Database,
  email: string,
  metaSub: string,
  passwordHash: string
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO users (email, password_hash, meta_sub, auth_provider) VALUES (?, ?, ?, ?)')
      .bind(email, passwordHash, metaSub, 'meta')
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

export async function findUserByMetaSub(db: D1Database, metaSub: string): Promise<User | null> {
  const result = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE meta_sub = ?`).bind(metaSub).first<User>()
  return result ?? null
}

export async function linkMetaToEmailUser(db: D1Database, userId: string, metaSub: string): Promise<void> {
  await db
    .prepare(`UPDATE users SET meta_sub = ?, auth_provider = CASE WHEN auth_provider = 'email' THEN 'both' ELSE auth_provider END WHERE id = ?`)
    .bind(metaSub, userId)
    .run()
}

export async function findUserByAppleSub(db: D1Database, appleSub: string): Promise<User | null> {
  const result = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE apple_sub = ?`).bind(appleSub).first<User>()
  return result ?? null
}

export async function createAppleUser(
  db: D1Database,
  email: string,
  appleSub: string,
  passwordHash: string
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO users (email, password_hash, apple_sub, auth_provider) VALUES (?, ?, ?, ?)')
      .bind(email, passwordHash, appleSub, 'apple')
      .run()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new DuplicateEmailError()
    }
    throw err
  }
}

export async function linkAppleToEmailUser(db: D1Database, userId: string, appleSub: string): Promise<void> {
  await db
    .prepare(`UPDATE users SET apple_sub = ?, auth_provider = CASE WHEN auth_provider = 'email' THEN 'both' ELSE auth_provider END WHERE id = ?`)
    .bind(appleSub, userId)
    .run()
}

export async function findUserByMicrosoftSub(db: D1Database, microsoftSub: string): Promise<User | null> {
  const result = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE microsoft_sub = ?`).bind(microsoftSub).first<User>()
  return result ?? null
}

export async function createMicrosoftUser(
  db: D1Database,
  email: string,
  microsoftSub: string,
  passwordHash: string
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO users (email, password_hash, microsoft_sub, auth_provider) VALUES (?, ?, ?, ?)')
      .bind(email, passwordHash, microsoftSub, 'microsoft')
      .run()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new DuplicateEmailError()
    }
    throw err
  }
}

export async function linkMicrosoftToEmailUser(db: D1Database, userId: string, microsoftSub: string): Promise<void> {
  await db
    .prepare(`UPDATE users SET microsoft_sub = ?, auth_provider = CASE WHEN auth_provider = 'email' THEN 'both' ELSE auth_provider END WHERE id = ?`)
    .bind(microsoftSub, userId)
    .run()
}

export async function updatePlan(
  db: D1Database, userId: string, plan: 'free' | 'pro', stripeCustomerId: string
): Promise<void> {
  const result = await db.prepare('UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?')
    .bind(plan, stripeCustomerId, userId).run()
  if (result.meta.changes === 0) throw new Error(`updatePlan: no user found for id ${userId}`)
}
