import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { KVNamespace } from '@cloudflare/workers-types'
import { authRouter } from '../../src/routes/auth'
import { createTestDb, wrapDb } from '../helpers/db'
import { hashPassword } from '../../src/utils/passwords'
import { createUser } from '../../src/db/users'
import { verificationKvKey } from '../../src/services/emailSignup'
import type { Env } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function createMockKV() {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v)
    },
    delete: async (k: string) => {
      store.delete(k)
    },
  } as unknown as KVNamespace
}

function makeApp(db: ReturnType<typeof wrapDb>, kv?: KVNamespace, extra?: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth', authRouter)
  const kvNs = kv ?? createMockKV()
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      TRANSLATION_CACHE: kvNs,
      RESEND_API_KEY: 're_test_mock',
      EMAIL_FROM: 'Test <onboarding@resend.dev>',
      CHROME_EXTENSION_ID: 'abcdefghijklmnopqrstuvwxyzabcdef',
      ...extra,
    } as unknown as Env,
  }
}

async function seedEmailPasswordUser(db: ReturnType<typeof wrapDb>, email: string, plainPassword: string): Promise<void> {
  await createUser(db, email, await hashPassword(plainPassword))
}

function post(app: ReturnType<typeof makeApp>['app'], path: string, body: object, env: Env) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env)
}

const VALID_SIGNUP_PASSWORD = 'password123!'

function signupPayload(email: string, password: string, passwordConfirm?: string) {
  return { email, password, passwordConfirm: passwordConfirm ?? password }
}

describe('POST /auth/signup/request', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'mock' }), { status: 200 })
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores pending signup and sends email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup/request', signupPayload('new@test.com', VALID_SIGNUP_PASSWORD), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('returns 400 for invalid email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(
      app,
      '/auth/signup/request',
      signupPayload('notanemail', VALID_SIGNUP_PASSWORD),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for short password', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup/request', signupPayload('user@test.com', 'short'), env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('8') })
  })

  it('returns 400 when password confirmation is missing', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup/request', { email: 'a@test.com', password: VALID_SIGNUP_PASSWORD }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/confirm your password/i) })
  })

  it('returns 400 when password confirmation does not match', async () => {
    const { app, env } = makeApp(db)
    const res = await post(
      app,
      '/auth/signup/request',
      {
        email: 'a@test.com',
        password: VALID_SIGNUP_PASSWORD,
        passwordConfirm: 'other-password9!',
      },
      env,
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Passwords do not match' })
  })

  it('returns 400 when password has no special character', async () => {
    const { app, env } = makeApp(db)
    const res = await post(
      app,
      '/auth/signup/request',
      signupPayload('user@test.com', 'longpasswordnodigits'),
      env,
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/special/i) })
  })

  it('silently succeeds for duplicate email to prevent enumeration', async () => {
    const { app, env } = makeApp(db)
    await seedEmailPasswordUser(db, 'dup@test.com', VALID_SIGNUP_PASSWORD)
    const res = await post(app, '/auth/signup/request', signupPayload('dup@test.com', VALID_SIGNUP_PASSWORD), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('normalises email to lowercase', async () => {
    const { app, env } = makeApp(db)
    const res = await post(
      app,
      '/auth/signup/request',
      signupPayload('User@Test.COM', VALID_SIGNUP_PASSWORD),
      env,
    )
    expect(res.status).toBe(200)
  })
})

describe('GET /auth/verify-email', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('creates user and returns extension landing HTML', async () => {
    const kv = createMockKV()
    const { app, env } = makeApp(db, kv)
    const token = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await kv.put(
      verificationKvKey(token),
      JSON.stringify({
        email: 'verify@test.com',
        password_hash: await hashPassword(VALID_SIGNUP_PASSWORD),
      }),
    )
    const res = await app.request(`http://local/auth/verify-email?t=${token}`, {}, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/')
    expect(html).toContain('osmosis_session=')
  })

  it('returns 400 for invalid token', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('http://local/auth/verify-email?t=nope', {}, env)
    expect(res.status).toBe(400)
  })
})

describe('POST /auth/login', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => { db = wrapDb(createTestDb()) })

  it('returns a token for valid credentials', async () => {
    const { app, env } = makeApp(db)
    await seedEmailPasswordUser(db, 'user@test.com', VALID_SIGNUP_PASSWORD)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: VALID_SIGNUP_PASSWORD }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string }
    expect(typeof body.token).toBe('string')
  })

  it('returns 401 for wrong password', async () => {
    const { app, env } = makeApp(db)
    await seedEmailPasswordUser(db, 'user@test.com', VALID_SIGNUP_PASSWORD)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: 'wrongpass' }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Invalid email or password' })
  })

  it('returns 401 for unknown email', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'nobody@test.com', password: VALID_SIGNUP_PASSWORD }, env)
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
    await seedEmailPasswordUser(db, 'user@test.com', VALID_SIGNUP_PASSWORD)
    const res = await post(app, '/auth/login', { email: 'USER@TEST.COM', password: VALID_SIGNUP_PASSWORD }, env)
    expect(res.status).toBe(200)
  })

})
