import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { translateRouter } from '../../src/routes/translate'
import { createTestDb, wrapDb, mockKV } from '../helpers/db'
import { signJWT } from '../../src/utils/jwt'
import { createUser, findUserByEmail, verifyUserEmail } from '../../src/db/users'
import type { Env, Variables, TranslationEntry } from '../../src/types'

vi.mock('../../src/services/azure', () => ({
  lookupWords: vi.fn().mockResolvedValue(new Map()),
  translateWords: vi.fn(),
  synthesizePronunciation: vi.fn(),
}))

vi.mock('../../src/db/translations', () => ({
  getTranslationsCachedBatch: vi.fn().mockResolvedValue(new Map()),
  batchSetTranslationCached: vi.fn().mockResolvedValue(undefined),
  batchIncrementHitCount: vi.fn().mockResolvedValue(undefined),
  getTopTranslations: vi.fn().mockResolvedValue([]),
}))

import { lookupWords, translateWords } from '../../src/services/azure'
import { getTranslationsCachedBatch } from '../../src/db/translations'

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
  const exp = Math.floor(Date.now() / 1000) + 3600
  return signJWT({ sub: userId, email: 'test@test.com', exp }, JWT_SECRET)
}

const HALLO: TranslationEntry = { t: 'hallo', p: 'NOUN' }

describe('POST /translate', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getTranslationsCachedBatch).mockResolvedValue(new Map())
    vi.mocked(lookupWords).mockResolvedValue(new Map())
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockResolvedValue(new Map())
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'test@test.com', 'hashed')
    await verifyUserEmail(db, userId)
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
    const words = Array.from({ length: 801 }, (_, i) => `word${i}`)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words, targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Too many words (max 800 per request)' })
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

  it('returns TranslationEntry from D1 cache when available', async () => {
    vi.mocked(getTranslationsCachedBatch).mockResolvedValue(new Map([['hello', HALLO]]))
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
    vi.mocked(lookupWords).mockResolvedValue(new Map())
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

  it('drops identity translations from result', async () => {
    vi.mocked(lookupWords).mockResolvedValue(new Map([['hello', { t: 'hello' }]]))
    const { app, env } = makeApp(db)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translations: {} })
  })
})
