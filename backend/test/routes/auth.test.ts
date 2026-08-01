import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { KVNamespace } from '@cloudflare/workers-types'
import { authRouter } from '../../src/routes/auth'
import { createTestDb, wrapDb } from '../helpers/db'
import { hashPassword } from '../../src/utils/passwords'
import { createUser, findUserByEmail as _findUserByEmail, verifyUserEmail } from '../../src/db/users'
import { verificationKvKey } from '../../src/services/emailSignup'
import { resetKvKey } from '../../src/services/emailReset'
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

async function seedEmailPasswordUser(db: ReturnType<typeof wrapDb>, email: string, plainPassword: string): Promise<string> {
  const userId = await createUser(db, email, await hashPassword(plainPassword))
  await verifyUserEmail(db, userId)
  return userId
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

  it('returns confirm-button page for a valid token', async () => {
    const kv = createMockKV()
    const { app, env } = makeApp(db, kv)
    const token = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const userId = await createUser(db, 'verify@test.com', await hashPassword(VALID_SIGNUP_PASSWORD))
    await kv.put(verificationKvKey(token), JSON.stringify({ userId }))
    const res = await app.request(`http://local/auth/verify-email?t=${token}`, {}, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Confirm')
  })

  it('returns 400 for invalid token format', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('http://local/auth/verify-email?t=nope', {}, env)
    expect(res.status).toBe(400)
  })

  it('returns 400 for unknown token', async () => {
    const { app, env } = makeApp(db)
    const token = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const res = await app.request(`http://local/auth/verify-email?t=${token}`, {}, env)
    expect(res.status).toBe(400)
  })
})

describe('POST /auth/verify-email', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('returns extension landing HTML and marks email verified', async () => {
    const kv = createMockKV()
    const { app, env } = makeApp(db, kv)
    const userId = await createUser(db, 'verify@test.com', await hashPassword(VALID_SIGNUP_PASSWORD))
    const token = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    await kv.put(verificationKvKey(token), JSON.stringify({ userId }))
    const res = await app.request('http://local/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t: token }).toString(),
    }, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('SESSION_FROM_VERIFY')
    expect(html).toContain('abcdefghijklmnopqrstuvwxyzabcdef')
  })

  it('returns 400 for already-consumed token', async () => {
    const kv = createMockKV()
    const { app, env } = makeApp(db, kv)
    const userId = await createUser(db, 'verify2@test.com', await hashPassword(VALID_SIGNUP_PASSWORD))
    const token = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbee0'
    await kv.put(verificationKvKey(token), JSON.stringify({ userId }))
    await app.request('http://local/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t: token }).toString(),
    }, env)
    // Second attempt with same token
    const res = await app.request('http://local/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t: token }).toString(),
    }, env)
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

  it('returns 403 for unverified account', async () => {
    const { app, env } = makeApp(db)
    await createUser(db, 'unverified@test.com', await hashPassword(VALID_SIGNUP_PASSWORD))
    const res = await post(app, '/auth/login', { email: 'unverified@test.com', password: VALID_SIGNUP_PASSWORD }, env)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/confirm your email/i) })
  })
})

describe('POST /auth/refresh', () => {
  let db: ReturnType<typeof wrapDb>
  let kv: KVNamespace

  beforeEach(async () => {
    db = wrapDb(createTestDb())
    kv = createMockKV()
  })

  it('returns new token and refresh token for a valid refresh token', async () => {
    const userId = await seedEmailPasswordUser(db, 'refresh@test.com', VALID_SIGNUP_PASSWORD)
    await kv.put(`refresh:${'a'.repeat(64)}`, userId)
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/refresh', { refreshToken: 'a'.repeat(64) }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string; refreshToken: string }
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
  })

  it('rotates the token — old token is consumed after use', async () => {
    const userId = await seedEmailPasswordUser(db, 'rotate@test.com', VALID_SIGNUP_PASSWORD)
    const oldToken = 'b'.repeat(64)
    await kv.put(`refresh:${oldToken}`, userId)
    const { app, env } = makeApp(db, kv)
    await post(app, '/auth/refresh', { refreshToken: oldToken }, env)
    const second = await post(app, '/auth/refresh', { refreshToken: oldToken }, env)
    expect(second.status).toBe(401)
  })

  it('returns 401 for an unknown refresh token', async () => {
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/refresh', { refreshToken: 'c'.repeat(64) }, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Invalid or expired refresh token' })
  })

  it('returns 400 when refreshToken field is missing', async () => {
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/refresh', {}, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'refreshToken required' })
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const { app, env } = makeApp(db, kv)
    for (let i = 0; i < 20; i++) {
      await post(app, '/auth/refresh', { refreshToken: 'd'.repeat(64) }, env)
    }
    const res = await post(app, '/auth/refresh', { refreshToken: 'd'.repeat(64) }, env)
    expect(res.status).toBe(429)
  })
})

describe('POST /auth/forgot-password', () => {
  let db: ReturnType<typeof wrapDb>
  let kv: KVNamespace

  beforeEach(() => {
    db = wrapDb(createTestDb())
    kv = createMockKV()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'mock' }), { status: 200 })
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns 200 for a known email and sends a reset email', async () => {
    const sendMock = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (urlStr.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'mock' }), { status: 200 })
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', sendMock)
    await seedEmailPasswordUser(db, 'reset@test.com', VALID_SIGNUP_PASSWORD)
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/forgot-password', { email: 'reset@test.com' }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    const emailCalls = sendMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('resend.com'),
    )
    expect(emailCalls.length).toBe(1)
  })

  it('returns 200 for an unknown email (prevents enumeration)', async () => {
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/forgot-password', { email: 'nobody@test.com' }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('returns 200 for an invalid email format (prevents enumeration)', async () => {
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/forgot-password', { email: 'notanemail' }, env)
    expect(res.status).toBe(200)
  })

  it('does not send reset email for a Google-only account', async () => {
    const sendMock = vi.fn(async () => new Response(JSON.stringify({ id: 'mock' }), { status: 200 }))
    vi.stubGlobal('fetch', sendMock)
    await db.prepare("INSERT INTO users (email, password_hash, google_sub, auth_provider, email_verified) VALUES (?, ?, ?, 'google', 1)")
      .bind('googleonly@test.com', 'hash', 'sub_google')
      .run()
    const { app, env } = makeApp(db, kv)
    await post(app, '/auth/forgot-password', { email: 'googleonly@test.com' }, env)
    const emailCalls = sendMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('resend.com'),
    )
    expect(emailCalls.length).toBe(0)
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const { app, env } = makeApp(db, kv)
    for (let i = 0; i < 5; i++) {
      await post(app, '/auth/forgot-password', { email: `u${i}@test.com` }, env)
    }
    const res = await post(app, '/auth/forgot-password', { email: 'extra@test.com' }, env)
    expect(res.status).toBe(429)
  })
})

describe('POST /auth/reset-password', () => {
  let db: ReturnType<typeof wrapDb>
  let kv: KVNamespace

  beforeEach(() => {
    db = wrapDb(createTestDb())
    kv = createMockKV()
  })

  it('updates password for a valid token and invalidates the token', async () => {
    const userId = await seedEmailPasswordUser(db, 'pwreset@test.com', VALID_SIGNUP_PASSWORD)
    const token = 'e'.repeat(64)
    await kv.put(resetKvKey(token), JSON.stringify({ userId, email: 'pwreset@test.com' }))
    const { app, env } = makeApp(db, kv)
    const newPassword = 'newpassword99!'
    const res = await post(app, '/auth/reset-password', { token, password: newPassword }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    // Token should be consumed (one-time use)
    const tokenAfter = await kv.get(resetKvKey(token))
    expect(tokenAfter).toBeNull()
    // New password should work for login
    const loginRes = await post(app, '/auth/login', { email: 'pwreset@test.com', password: newPassword }, env)
    expect(loginRes.status).toBe(200)
  })

  it('returns 400 for an unknown or already-used token', async () => {
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/reset-password', { token: 'f'.repeat(64), password: 'newpassword99!' }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/invalid or has expired/i) })
  })

  it('returns 400 for a weak new password', async () => {
    const userId = await seedEmailPasswordUser(db, 'weakpw@test.com', VALID_SIGNUP_PASSWORD)
    const token = 'g'.repeat(64)
    await kv.put(resetKvKey(token), JSON.stringify({ userId, email: 'weakpw@test.com' }))
    const { app, env } = makeApp(db, kv)
    const res = await post(app, '/auth/reset-password', { token, password: 'short' }, env)
    expect(res.status).toBe(400)
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const { app, env } = makeApp(db, kv)
    for (let i = 0; i < 5; i++) {
      await post(app, '/auth/reset-password', { token: `${'h'.repeat(64)}`, password: 'dummy99!' }, env)
    }
    const res = await post(app, '/auth/reset-password', { token: 'h'.repeat(64), password: 'dummy99!' }, env)
    expect(res.status).toBe(429)
  })
})

// End-to-end integration: signup/request → verify-email (POST) → JWT extracted from
// landing HTML → JWT accepted by requireAuth on a protected route. Every step is
// unit-tested individually elsewhere; this covers the seam between them, where the
// JWT format, KV key layout, and requireAuth's plan/email lookup all have to line up.
describe('integration: signup → verify → JWT usable against requireAuth', () => {
  let db: ReturnType<typeof wrapDb>
  let kv: KVNamespace

  beforeEach(() => {
    db = wrapDb(createTestDb())
    kv = createMockKV()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'mock' }), { status: 200 })
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('completes the full flow and the issued JWT authenticates on /user/me', async () => {
    // Mount both routers on the same app so the JWT issued by /auth also passes
    // through the /user requireAuth middleware.
    const { userRouter } = await import('../../src/routes/user')
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth', authRouter)
    app.route('/user', userRouter)
    const env = makeApp(db, kv).env

    // Step 1 — signup/request stores a pending signup and (in production) emails a link.
    // The email side is stubbed, so we grab the user id from DB and mint the verification
    // token ourselves — same operation the /auth/signup/request handler performed
    // internally, just accessible from the test.
    const signupRes = await post(app, '/auth/signup/request', signupPayload('integration@test.com', VALID_SIGNUP_PASSWORD), env)
    expect(signupRes.status).toBe(200)

    const userId = (await _findUserByEmail(db, 'integration@test.com'))!.id
    const token = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    await kv.put(verificationKvKey(token), JSON.stringify({ userId }))

    // Step 2 — POST /auth/verify-email consumes the token and returns the extension
    // landing HTML with the JWT embedded in a chrome.runtime.sendMessage call.
    const verifyRes = await app.request('http://local/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t: token }).toString(),
    }, env)
    expect(verifyRes.status).toBe(200)
    const landingHtml = await verifyRes.text()

    // Step 3 — extract the JWT from the landing HTML (embedded as JSON.stringify(jwt)).
    // The pattern is `token: "..."`, immediately before `refreshToken: "..."`.
    const jwtMatch = landingHtml.match(/token:\s*"([^"]+)"/)
    expect(jwtMatch, 'landing HTML should embed the JWT via chrome.runtime.sendMessage').not.toBeNull()
    const jwt = jwtMatch![1]!

    // Step 4 — the JWT must authenticate against /user/me (a requireAuth route we
    // did NOT visit before, so the KV user_auth cache is cold and requireAuth has
    // to walk through JWT verify → DB user lookup on its own).
    const meRes = await app.request('http://local/user/me', {
      headers: { Authorization: `Bearer ${jwt}` },
    }, env)
    expect(meRes.status).toBe(200)
    const me = await meRes.json() as { email: string; plan: string }
    expect(me.email).toBe('integration@test.com')
    expect(me.plan).toBe('free')
  })
})
