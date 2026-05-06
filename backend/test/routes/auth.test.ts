import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authRouter } from '../../src/routes/auth'
import { createTestDb, wrapDb } from '../helpers/db'
import { hashPassword } from '../../src/utils/passwords'
import type { Env } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth', authRouter)
  return { app, env: { DB: db, JWT_SECRET } as unknown as Env }
}

function post(app: ReturnType<typeof makeApp>['app'], path: string, body: object, env: Env) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env)
}

describe('POST /auth/signup', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => { db = wrapDb(createTestDb()) })

  it('creates a user and returns a token', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'new@test.com', password: 'password123' }, env)
    expect(res.status).toBe(201)
    const body = await res.json() as { token: string }
    expect(typeof body.token).toBe('string')
    expect(body.token.split('.').length).toBe(3)
  })

  it('returns 400 for invalid email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'notanemail', password: 'password123' }, env)
    expect(res.status).toBe(400)
  })

  it('returns 400 for short password', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'user@test.com', password: 'short' }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('8') })
  })

  it('returns 409 for duplicate email', async () => {
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: 'dup@test.com', password: 'password123' }, env)
    const res = await post(app, '/auth/signup', { email: 'dup@test.com', password: 'password123' }, env)
    expect(res.status).toBe(409)
  })

  it('normalises email to lowercase', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'User@Test.COM', password: 'password123' }, env)
    expect(res.status).toBe(201)
  })
})

describe('POST /auth/login', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => { db = wrapDb(createTestDb()) })

  it('returns a token for valid credentials', async () => {
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: 'user@test.com', password: 'password123' }, env)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: 'password123' }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string }
    expect(typeof body.token).toBe('string')
  })

  it('returns 401 for wrong password', async () => {
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: 'user@test.com', password: 'password123' }, env)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: 'wrongpass' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Invalid email or password' })
  })

  it('returns 401 for unknown email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'nobody@test.com', password: 'password123' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Invalid email or password' })
  })

  it('returns 400 when fields are missing', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'user@test.com' }, env)
    expect(res.status).toBe(400)
  })

  it('accepts login with normalised email casing', async () => {
    const { app, env } = makeApp(db)
    await post(app, '/auth/signup', { email: 'user@test.com', password: 'password123' }, env)
    const res = await post(app, '/auth/login', { email: 'USER@TEST.COM', password: 'password123' }, env)
    expect(res.status).toBe(200)
  })

  const legacySocialError =
    'This account used a sign-in method that is no longer available. Try Google if this email is linked there, or contact support.'

  it('returns a clear error for legacy Meta-only accounts', async () => {
    const raw = createTestDb()
    const wrapped = wrapDb(raw)
    const passwordHash = await hashPassword('strong-password')
    raw
      .prepare('INSERT INTO users (email, password_hash, meta_sub, auth_provider) VALUES (?, ?, ?, ?)')
      .bind('meta@test.com', passwordHash, 'meta-sub-1', 'meta')
      .run()
    const { app, env } = makeApp(wrapped)
    const res = await post(app, '/auth/login', { email: 'meta@test.com', password: 'strong-password' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: legacySocialError })
  })

  it('returns a clear error for legacy Apple-only accounts', async () => {
    const raw = createTestDb()
    const wrapped = wrapDb(raw)
    const passwordHash = await hashPassword('strong-password')
    raw
      .prepare('INSERT INTO users (email, password_hash, apple_sub, auth_provider) VALUES (?, ?, ?, ?)')
      .bind('apple@test.com', passwordHash, 'apple-sub-1', 'apple')
      .run()
    const { app, env } = makeApp(wrapped)
    const res = await post(app, '/auth/login', { email: 'apple@test.com', password: 'strong-password' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: legacySocialError })
  })

  it('returns a clear error for legacy Microsoft-only accounts', async () => {
    const raw = createTestDb()
    const wrapped = wrapDb(raw)
    const passwordHash = await hashPassword('strong-password')
    raw
      .prepare('INSERT INTO users (email, password_hash, microsoft_sub, auth_provider) VALUES (?, ?, ?, ?)')
      .bind('ms@test.com', passwordHash, 'ms-sub-1', 'microsoft')
      .run()
    const { app, env } = makeApp(wrapped)
    const res = await post(app, '/auth/login', { email: 'ms@test.com', password: 'strong-password' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: legacySocialError })
  })
})
