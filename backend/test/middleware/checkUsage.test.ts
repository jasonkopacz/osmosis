import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { checkUsage } from '../../src/middleware/checkUsage'
import { requireAuth } from '../../src/middleware/requireAuth'
import { signJWT } from '../../src/lib/jwt'
import { createTestDb, wrapDb } from '../helpers/db'
import { createUser, findUserByEmail, incrementUsage, updatePlan } from '../../src/lib/db'
import type { Env, Variables } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>, freeLimit?: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  app.get('/test', requireAuth, checkUsage, (c) => c.json({ ok: true }))
  return { app, env: { DB: db, JWT_SECRET, FREE_TIER_CHAR_LIMIT: freeLimit } as unknown as Env }
}

async function makeToken(userId: string) {
  return signJWT({ sub: userId, email: 'test@test.com' }, JWT_SECRET)
}

describe('checkUsage middleware', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string

  beforeEach(async () => {
    db = wrapDb(createTestDb())
    await createUser(db, 'test@test.com', 'hashed')
    const user = await findUserByEmail(db, 'test@test.com')
    userId = user!.id
  })

  it('allows free users under the limit', async () => {
    const { app, env } = makeApp(db, '100000')
    const token = await makeToken(userId)
    const res = await app.request('/test', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
  })

  it('blocks free users at the limit', async () => {
    const { app, env } = makeApp(db, '1000')
    await incrementUsage(db, userId, new Date().toISOString().slice(0, 7), 1000)
    const token = await makeToken(userId)
    const res = await app.request('/test', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: 'LIMIT_REACHED' })
  })

  it('allows pro users regardless of usage', async () => {
    const { app, env } = makeApp(db, '1000')
    await updatePlan(db, userId, 'pro', 'cus_123')
    await incrementUsage(db, userId, new Date().toISOString().slice(0, 7), 999999)
    const token = await makeToken(userId)
    const res = await app.request('/test', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
  })
})
