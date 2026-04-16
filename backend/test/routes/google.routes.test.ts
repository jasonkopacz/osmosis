import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, wrapDb } from '../helpers/db'
import { googleOAuthRouter } from '../../src/routes/google'
import { createUser, findUserByEmail } from '../../src/db/users'
import type { Env } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'
const redirectOk = 'https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/'

function makeApp(db: ReturnType<typeof wrapDb>, googleEnv: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth/google', googleOAuthRouter)
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csec',
      ...googleEnv,
    } as unknown as Env,
  }
}

describe('GET /auth/google/url', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('returns 503 when Google OAuth is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth/google', googleOAuthRouter)
    const env = { DB: db, JWT_SECRET } as unknown as Env
    const res = await app.request(
      `/auth/google/url?redirect_uri=${encodeURIComponent(redirectOk)}&state=s1`,
      {},
      env
    )
    expect(res.status).toBe(503)
  })

  it('returns 400 for invalid redirect_uri', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      `/auth/google/url?redirect_uri=${encodeURIComponent('https://evil.com/')}&state=s1`,
      {},
      env
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when state is missing', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(`/auth/google/url?redirect_uri=${encodeURIComponent(redirectOk)}`, {}, env)
    expect(res.status).toBe(400)
  })

  it('returns authorize URL when valid', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      `/auth/google/url?redirect_uri=${encodeURIComponent(redirectOk)}&state=my-state`,
      {},
      env
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain('accounts.google.com')
    expect(body.url).toContain('state=my-state')
  })
})

describe('POST /auth/google/exchange', () => {
  let db: ReturnType<typeof wrapDb>
  const fetchMock = vi.fn()

  beforeEach(() => {
    db = wrapDb(createTestDb())
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockGoogleApis(profile: { sub: string; email: string; email_verified?: boolean }) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'atok' }), { status: 200 })
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return new Response(
          JSON.stringify({
            ...profile,
            email_verified: profile.email_verified ?? true,
          }),
          { status: 200 }
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  it('returns 503 when OAuth is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth/google', googleOAuthRouter)
    const env = { DB: db, JWT_SECRET } as unknown as Env
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(503)
  })

  it('returns 400 when code or redirect_uri invalid', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(400)
  })

  it('returns 401 when token exchange fails', async () => {
    const { app, env } = makeApp(db)
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }))
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when userinfo fails', async () => {
    const { app, env } = makeApp(db)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when email not verified', async () => {
    const { app, env } = makeApp(db)
    mockGoogleApis({ sub: 'g1', email: 'a@b.com', email_verified: false })
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(400)
  })

  it('creates a new Google user and returns JWT', async () => {
    const { app, env } = makeApp(db)
    mockGoogleApis({ sub: 'google-sub-new', email: 'newuser@example.com' })
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    expect(typeof body.token).toBe('string')
    const user = await findUserByEmail(db, 'newuser@example.com')
    expect(user?.google_sub).toBe('google-sub-new')
    expect(user?.auth_provider).toBe('google')
  })

  it('returns JWT for existing Google user without creating duplicate', async () => {
    const { app, env } = makeApp(db)
    mockGoogleApis({ sub: 'same-sub', email: 'existing@example.com' })
    const r1 = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(r1.status).toBe(200)
    const r2 = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c2', redirect_uri: redirectOk }),
      },
      env
    )
    expect(r2.status).toBe(200)
    const body1 = (await r1.json()) as { token: string }
    const body2 = (await r2.json()) as { token: string }
    expect(body1.token).toBeTruthy()
    expect(body2.token).toBeTruthy()
  })

  it('links Google to existing email user', async () => {
    const { app, env } = makeApp(db)
    await createUser(db, 'legacy@test.com', 'hash')
    mockGoogleApis({ sub: 'link-sub', email: 'legacy@test.com' })
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'legacy@test.com'))!
    expect(user.google_sub).toBe('link-sub')
  })

  it('returns 409 when email has different google_sub', async () => {
    const { app, env } = makeApp(db)
    mockGoogleApis({ sub: 'first', email: 'dup@test.com' })
    await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    mockGoogleApis({ sub: 'second', email: 'dup@test.com' })
    const res = await app.request(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c2', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(409)
  })
})
