import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { translateRouter } from '../../src/routes/translate'
import { createTestDb, wrapDb } from '../helpers/db'
import { signJWT } from '../../src/lib/jwt'
import { createUser, findUserByEmail } from '../../src/lib/db'
import type { Env, Variables } from '../../src/types'

vi.mock('../../src/lib/azure', () => ({
  translateWords: vi.fn(),
}))
vi.mock('../../src/lib/kv', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}))

import { translateWords } from '../../src/lib/azure'
import { getCached } from '../../src/lib/kv'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

const mockKV = {} as KVNamespace

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  app.route('/translate', translateRouter)
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      TRANSLATION_CACHE: mockKV,
      FREE_TIER_CHAR_LIMIT: '100000',
      AZURE_TRANSLATOR_KEY: 'key',
      AZURE_TRANSLATOR_REGION: 'eastus',
    } as unknown as Env,
  }
}

async function makeToken(userId: string) {
  return signJWT({ sub: userId, email: 'test@test.com' }, JWT_SECRET)
}

describe('POST /translate', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getCached).mockResolvedValue(null)
    db = wrapDb(createTestDb())
    await createUser(db, 'test@test.com', 'hashed')
    const user = await findUserByEmail(db, 'test@test.com')
    userId = user!.id
    token = await makeToken(userId)
  })

  it('requires authentication', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing words', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('returns 400 for more than 250 words', async () => {
    const { app, env } = makeApp(db)
    const words = Array.from({ length: 251 }, (_, i) => `word${i}`)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words, targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Too many words (max 250 per request)' })
  })

  it('returns 400 for words with invalid types', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: [42, 'hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid words array' })
  })

  it('returns translations from cache when available', async () => {
    vi.mocked(getCached).mockResolvedValue('hallo')
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translations: { hello: 'hallo' } })
    expect(translateWords).not.toHaveBeenCalled()
  })

  it('calls azure and returns translations for cache misses', async () => {
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockResolvedValue(new Map([['hello', 'hallo']]))
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translations: { hello: 'hallo' } })
  })

  it('returns 503 when azure fails after retry', async () => {
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'))
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(503)
  })
})
