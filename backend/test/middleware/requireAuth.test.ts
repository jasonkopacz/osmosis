import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { requireAuth } from '../../src/middleware/requireAuth'
import { signJWT } from '../../src/utils/jwt'
import { createTestDb, wrapDb } from '../helpers/db'
import type { Env, Variables } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  app.get('/protected', requireAuth, (c) => c.json({ userId: c.get('userId'), email: c.get('email') }))
  return app
}

describe('requireAuth middleware', () => {
  let db: ReturnType<typeof wrapDb>
  let env: Env

  beforeEach(() => {
    const raw = createTestDb()
    raw
      .prepare(
        `INSERT INTO users (id, email, password_hash, plan, created_at) VALUES ('user-123', 'test@test.com', 'x', 'free', 0)`
      )
      .run()
    db = wrapDb(raw)
    env = { DB: db, JWT_SECRET } as unknown as Env
  })

  it('rejects requests with no Authorization header', async () => {
    const res = await makeApp(db).request('/protected', {}, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('rejects requests with a non-Bearer Authorization header', async () => {
    const res = await makeApp(db).request('/protected', { headers: { Authorization: 'Basic abc123' } }, env)
    expect(res.status).toBe(401)
  })

  it('rejects an invalid JWT', async () => {
    const res = await makeApp(db).request('/protected', { headers: { Authorization: 'Bearer not.a.jwt' } }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Invalid or expired token' })
  })

  it('rejects an expired JWT', async () => {
    const token = await signJWT(
      { sub: 'user-1', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 10 },
      JWT_SECRET
    )
    const res = await makeApp(db).request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(401)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signJWT({ sub: 'user-1', email: 'a@b.com' }, 'different-secret-also-32-chars!!!')
    const res = await makeApp(db).request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(401)
  })

  it('sets userId and email context for a valid token', async () => {
    const token = await signJWT({ sub: 'user-123', email: 'test@test.com' }, JWT_SECRET)
    const res = await makeApp(db).request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-123', email: 'test@test.com' })
  })
})
