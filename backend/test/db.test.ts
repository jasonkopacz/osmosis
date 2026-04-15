import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from './helpers/db'
import { createUser, findUserByEmail, getUsage, incrementUsage, updatePlan, DuplicateEmailError } from '../src/lib/db'
import type { D1Database } from '@cloudflare/workers-types'

function wrapDb(db: ReturnType<typeof createTestDb>): D1Database {
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        bind: (...args: unknown[]) => ({
          first: async <T>() => (stmt.get(...args) ?? null) as T | null,
          run: async () => { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes } } },
          all: async <T>() => ({ results: stmt.all(...args) as T[] }),
        }),
        first: async <T>() => (stmt.get() ?? null) as T | null,
        run: async () => { stmt.run(); return { success: true, meta: {} } },
      }
    },
  } as unknown as D1Database
}

let db: D1Database
beforeEach(() => { db = wrapDb(createTestDb()) })

describe('createUser / findUserByEmail', () => {
  it('creates and retrieves a user', async () => {
    await createUser(db, 'test@test.com', 'hashed')
    const user = await findUserByEmail(db, 'test@test.com')
    expect(user?.email).toBe('test@test.com')
    expect(user?.plan).toBe('free')
  })

  it('returns null for unknown email', async () => {
    expect(await findUserByEmail(db, 'nope@nope.com')).toBeNull()
  })

  it('throws DuplicateEmailError on duplicate email', async () => {
    await createUser(db, 'dup@test.com', 'pw1')
    await expect(createUser(db, 'dup@test.com', 'pw2')).rejects.toThrow(DuplicateEmailError)
  })
})

describe('getUsage / incrementUsage', () => {
  it('returns 0 initially', async () => {
    await createUser(db, 'a@b.com', 'pw')
    const user = await findUserByEmail(db, 'a@b.com')
    expect(await getUsage(db, user!.id, '2026-04')).toBe(0)
  })

  it('accumulates increments', async () => {
    await createUser(db, 'a@b.com', 'pw')
    const user = await findUserByEmail(db, 'a@b.com')
    await incrementUsage(db, user!.id, '2026-04', 1000)
    await incrementUsage(db, user!.id, '2026-04', 500)
    expect(await getUsage(db, user!.id, '2026-04')).toBe(1500)
  })
})

describe('updatePlan', () => {
  it('upgrades user to pro', async () => {
    await createUser(db, 'a@b.com', 'pw')
    const user = await findUserByEmail(db, 'a@b.com')
    await updatePlan(db, user!.id, 'pro', 'cus_123')
    const updated = await findUserByEmail(db, 'a@b.com')
    expect(updated?.plan).toBe('pro')
    expect(updated?.stripe_customer_id).toBe('cus_123')
  })

  it('throws when user not found', async () => {
    await expect(updatePlan(db, 'nonexistent-id', 'pro', 'cus_xxx')).rejects.toThrow('no user found')
  })
})
