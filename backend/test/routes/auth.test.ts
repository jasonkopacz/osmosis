import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authRouter } from '../../src/routes/auth'
import { createTestDb, wrapDb } from '../helpers/db'
import { verifyJWT } from '../../src/lib/jwt'
import { createUser, findUserByEmail } from '../../src/lib/db'
import type { Env } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth', authRouter)
  return { app, env: { DB: db, JWT_SECRET } as unknown as Env }
}

function post(app: Hono<{ Bindings: Env }>, path: string, body: object, env: Env) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env)
}

describe('POST /auth/signup', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => { db = wrapDb(createTestDb()) })

  it('creates a user and returns a JWT', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'new@test.com', password: 'password123' }, env)
    expect(res.status).toBe(200)
    const { token } = await res.json() as { token: string }
    expect(typeof token).toBe('string')
    const payload = await verifyJWT(token, JWT_SECRET)
    expect(payload?.email).toBe('new@test.com')
  })

  it('lowercases and trims email', async () => {
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: '  UPPER@TEST.COM  ', password: 'password123' }, env)
    const user = await findUserByEmail(db, 'upper@test.com')
    expect(user).not.toBeNull()
  })

  it('rejects a password shorter than 8 chars', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'a@b.com', password: 'short' }, env)
    expect(res.status).toBe(400)
  })

  it('rejects missing email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { password: 'password123' }, env)
    expect(res.status).toBe(400)
  })

  it('returns 409 for duplicate email', async () => {
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: 'dup@test.com', password: 'password123' }, env)
    const res = await post(app, '/auth/signup', { email: 'dup@test.com', password: 'password123' }, env)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'Email already registered' })
  })
})

describe('POST /auth/login', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(async () => {
    db = wrapDb(createTestDb())
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: 'user@test.com', password: 'password123' }, env)
  })

  it('returns a JWT for valid credentials', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: 'password123' }, env)
    expect(res.status).toBe(200)
    const { token } = await res.json() as { token: string }
    const payload = await verifyJWT(token, JWT_SECRET)
    expect(payload?.email).toBe('user@test.com')
  })

  it('rejects wrong password', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: 'wrongpassword' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Invalid credentials' })
  })

  it('rejects unknown email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'nobody@test.com', password: 'password123' }, env)
    expect(res.status).toBe(401)
  })

  it('blocks password login for Google-only accounts', async () => {
    // Create a Google user directly in DB
    const rawDb = createTestDb()
    const wrappedDb = wrapDb(rawDb)
    rawDb.prepare(
      `INSERT INTO users (id, email, password_hash, google_sub, auth_provider, plan, created_at) VALUES ('g1', 'google@test.com', '', 'sub123', 'google', 'free', 0)`
    ).run()
    const { app, env } = makeApp(wrappedDb)
    const res = await post(app, '/auth/login', { email: 'google@test.com', password: 'anypassword' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Use Google sign-in for this account' })
  })
})
