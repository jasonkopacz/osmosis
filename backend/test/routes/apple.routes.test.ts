import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, wrapDb } from '../helpers/db'
import { appleOAuthRouter } from '../../src/routes/apple'
import { createUser, findUserByEmail } from '../../src/db/users'
import type { Env } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'
const redirectOk = 'https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/'

function makeApp(db: ReturnType<typeof wrapDb>, appleEnv: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth/apple', appleOAuthRouter)
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      APPLE_CLIENT_ID: 'apple-client-id',
      APPLE_CLIENT_SECRET: 'apple-client-secret',
      ...appleEnv,
    } as unknown as Env,
  }
}

function makeUnsignedJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${header}.${body}.signature`
}

describe('GET /auth/apple/url', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('returns 503 when Apple OAuth is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth/apple', appleOAuthRouter)
    const env = { DB: db, JWT_SECRET } as unknown as Env
    const res = await app.request(
      `/auth/apple/url?redirect_uri=${encodeURIComponent(redirectOk)}&state=s1`,
      {},
      env
    )
    expect(res.status).toBe(503)
  })

  it('returns 400 for invalid redirect_uri', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      `/auth/apple/url?redirect_uri=${encodeURIComponent('https://evil.com/')}&state=s1`,
      {},
      env
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when state is missing', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(`/auth/apple/url?redirect_uri=${encodeURIComponent(redirectOk)}`, {}, env)
    expect(res.status).toBe(400)
  })

  it('returns authorize URL when valid', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      `/auth/apple/url?redirect_uri=${encodeURIComponent(redirectOk)}&state=my-state`,
      {},
      env
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain('appleid.apple.com')
    expect(body.url).toContain('state=my-state')
  })
})

describe('POST /auth/apple/exchange', () => {
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

  function mockAppleToken(idTokenPayload: object) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('appleid.apple.com/auth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'apple-atok',
            id_token: makeUnsignedJwt(idTokenPayload),
          }),
          { status: 200 }
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  it('returns 503 when OAuth is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth/apple', appleOAuthRouter)
    const env = { DB: db, JWT_SECRET } as unknown as Env
    const res = await app.request(
      '/auth/apple/exchange',
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
      '/auth/apple/exchange',
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
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when id token is invalid', async () => {
    const { app, env } = makeApp(db)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'a', id_token: 'bad.jwt' }), { status: 200 }))
    const res = await app.request(
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when email is missing', async () => {
    const { app, env } = makeApp(db)
    mockAppleToken({ sub: 'apple-sub-1' })
    const res = await app.request(
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(400)
  })

  it('creates a new Apple user and returns JWT', async () => {
    const { app, env } = makeApp(db)
    mockAppleToken({ sub: 'apple-sub-new', email: 'newuser@example.com' })
    const res = await app.request(
      '/auth/apple/exchange',
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
    expect(user?.apple_sub).toBe('apple-sub-new')
    expect(user?.auth_provider).toBe('apple')
  })

  it('returns JWT for existing Apple user without creating duplicate', async () => {
    const { app, env } = makeApp(db)
    mockAppleToken({ sub: 'same-sub', email: 'existing@example.com' })
    const r1 = await app.request(
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(r1.status).toBe(200)
    const r2 = await app.request(
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c2', redirect_uri: redirectOk }),
      },
      env
    )
    expect(r2.status).toBe(200)
  })

  it('links Apple to existing email user', async () => {
    const { app, env } = makeApp(db)
    await createUser(db, 'legacy@test.com', 'hash')
    mockAppleToken({ sub: 'apple-link-sub', email: 'legacy@test.com' })
    const res = await app.request(
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'legacy@test.com'))!
    expect(user.apple_sub).toBe('apple-link-sub')
  })

  it('returns 409 when email has different apple_sub', async () => {
    const { app, env } = makeApp(db)
    mockAppleToken({ sub: 'first', email: 'dup@test.com' })
    await app.request(
      '/auth/apple/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    mockAppleToken({ sub: 'second', email: 'dup@test.com' })
    const res = await app.request(
      '/auth/apple/exchange',
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
