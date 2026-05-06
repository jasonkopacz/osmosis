import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, wrapDb } from '../helpers/db'
import { microsoftOAuthRouter } from '../../src/routes/microsoft'
import { createUser, findUserByEmail } from '../../src/db/users'
import type { Env } from '../../src/types'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'
const redirectOk = 'https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/'

function makeApp(db: ReturnType<typeof wrapDb>, msEnv: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth/microsoft', microsoftOAuthRouter)
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      MICROSOFT_CLIENT_ID: 'ms-client-id',
      MICROSOFT_CLIENT_SECRET: 'ms-client-secret',
      ...msEnv,
    } as unknown as Env,
  }
}

describe('GET /auth/microsoft/url', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('returns 503 when Microsoft OAuth is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth/microsoft', microsoftOAuthRouter)
    const env = { DB: db, JWT_SECRET } as unknown as Env
    const res = await app.request(
      `/auth/microsoft/url?redirect_uri=${encodeURIComponent(redirectOk)}&state=s1`,
      {},
      env
    )
    expect(res.status).toBe(503)
  })

  it('returns 400 for invalid redirect_uri', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      `/auth/microsoft/url?redirect_uri=${encodeURIComponent('https://evil.com/')}&state=s1`,
      {},
      env
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when state is missing', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(`/auth/microsoft/url?redirect_uri=${encodeURIComponent(redirectOk)}`, {}, env)
    expect(res.status).toBe(400)
  })

  it('returns authorize URL when valid', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request(
      `/auth/microsoft/url?redirect_uri=${encodeURIComponent(redirectOk)}&state=my-state`,
      {},
      env
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain('login.microsoftonline.com')
    expect(body.url).toContain('state=my-state')
  })
})

describe('POST /auth/microsoft/exchange', () => {
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

  function mockMicrosoftApis(profile: { id: string; mail?: string; userPrincipalName?: string }) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('login.microsoftonline.com/common/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'ms-atok' }), { status: 200 })
      }
      if (url.includes('graph.microsoft.com/v1.0/me')) {
        return new Response(JSON.stringify(profile), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  it('returns 503 when OAuth is not configured', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.route('/auth/microsoft', microsoftOAuthRouter)
    const env = { DB: db, JWT_SECRET } as unknown as Env
    const res = await app.request(
      '/auth/microsoft/exchange',
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
      '/auth/microsoft/exchange',
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
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when profile fetch fails', async () => {
    const { app, env } = makeApp(db)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
    const res = await app.request(
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when id or email is missing', async () => {
    const { app, env } = makeApp(db)
    mockMicrosoftApis({ id: 'ms-sub-1' })
    const res = await app.request(
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(400)
  })

  it('creates a new Microsoft user and returns JWT', async () => {
    const { app, env } = makeApp(db)
    mockMicrosoftApis({ id: 'ms-sub-new', mail: 'newuser@example.com' })
    const res = await app.request(
      '/auth/microsoft/exchange',
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
    expect(user?.microsoft_sub).toBe('ms-sub-new')
    expect(user?.auth_provider).toBe('microsoft')
  })

  it('returns JWT for existing Microsoft user without creating duplicate', async () => {
    const { app, env } = makeApp(db)
    mockMicrosoftApis({ id: 'same-sub', mail: 'existing@example.com' })
    const r1 = await app.request(
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(r1.status).toBe(200)
    const r2 = await app.request(
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c2', redirect_uri: redirectOk }),
      },
      env
    )
    expect(r2.status).toBe(200)
  })

  it('links Microsoft to existing email user', async () => {
    const { app, env } = makeApp(db)
    await createUser(db, 'legacy@test.com', 'hash')
    mockMicrosoftApis({ id: 'ms-link-sub', userPrincipalName: 'legacy@test.com' })
    const res = await app.request(
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'legacy@test.com'))!
    expect(user.microsoft_sub).toBe('ms-link-sub')
  })

  it('returns 409 when email has different microsoft_sub', async () => {
    const { app, env } = makeApp(db)
    mockMicrosoftApis({ id: 'first', mail: 'dup@test.com' })
    await app.request(
      '/auth/microsoft/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c1', redirect_uri: redirectOk }),
      },
      env
    )
    mockMicrosoftApis({ id: 'second', mail: 'dup@test.com' })
    const res = await app.request(
      '/auth/microsoft/exchange',
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
