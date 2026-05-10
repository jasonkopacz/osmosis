import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { translateRouter } from '../../src/routes/translate'
import { createTestDb, wrapDb, mockKV } from '../helpers/db'
import { signJWT } from '../../src/utils/jwt'
import { createUser, findUserByEmail } from '../../src/db/users'
import type { Env, Variables, TranslationEntry } from '../../src/types'

vi.mock('../../src/services/azure', () => ({
  lookupWords: vi.fn().mockResolvedValue(new Map()),
  translateWords: vi.fn(),
}))
vi.mock('../../src/utils/kv', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}))

import { lookupWords, translateWords } from '../../src/services/azure'
import { getCached } from '../../src/utils/kv'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'


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

const HALLO: TranslationEntry = { t: 'hallo', p: 'NOUN' }

describe('POST /translate', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getCached).mockResolvedValue(null)
    vi.mocked(lookupWords).mockResolvedValue(new Map())
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

  it('returns 400 for more than max words per batch', async () => {
    const { app, env } = makeApp(db)
    const words = Array.from({ length: 201 }, (_, i) => `word${i}`)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words, targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Too many words (max 200 per request)' })
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

  it('returns TranslationEntry from KV cache when available', async () => {
    vi.mocked(getCached).mockResolvedValue(HALLO)
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translations: { hello: HALLO } })
    expect(lookupWords).not.toHaveBeenCalled()
    expect(translateWords).not.toHaveBeenCalled()
  })

  it('uses dictionary lookup result when available', async () => {
    vi.mocked(lookupWords).mockResolvedValue(new Map([['hello', HALLO]]))
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translations: { hello: HALLO } })
    expect(translateWords).not.toHaveBeenCalled()
  })

  it('falls back to translateWords for words with no dictionary entry', async () => {
    vi.mocked(lookupWords).mockResolvedValue(new Map()) // no dict entry
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockResolvedValue(new Map([['hello', { t: 'hallo' }]]))
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translations: { hello: { t: 'hallo' } } })
  })

  it('returns 503 when both lookup and translate fail', async () => {
    vi.mocked(lookupWords).mockRejectedValue(new Error('network error'))
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
