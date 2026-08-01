import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { KVNamespace } from '@cloudflare/workers-types'
import { translateRouter } from '../../src/routes/translate'
import { createTestDb, wrapDb, mockKV } from '../helpers/db'
import { signJWT } from '../../src/utils/jwt'
import { createUser, findUserByEmail, verifyUserEmail, updatePlan } from '../../src/db/users'
import { getUsage, incrementUsage } from '../../src/db/usage'
import { currentYearMonth } from '../../src/utils/date'
import type { Env, Variables, TranslationEntry } from '../../src/types'

vi.mock('../../src/services/azure', () => ({
  lookupWords: vi.fn().mockResolvedValue(new Map()),
  translateWords: vi.fn(),
  synthesizePronunciation: vi.fn(),
}))

vi.mock('../../src/db/translations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/translations')>()
  return {
    ...actual,
    getTranslationsCachedBatch: vi.fn().mockResolvedValue(new Map()),
    batchSetTranslationCached: vi.fn().mockResolvedValue(undefined),
    batchIncrementHitCount: vi.fn().mockResolvedValue(undefined),
    getTopTranslations: vi.fn().mockResolvedValue([]),
  }
})

import { lookupWords, translateWords, synthesizePronunciation } from '../../src/services/azure'
import { getTranslationsCachedBatch } from '../../src/db/translations'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>, kv: KVNamespace = mockKV, limitOverride?: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  app.route('/translate', translateRouter)
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      TRANSLATION_CACHE: kv,
      FREE_TIER_CHAR_LIMIT: limitOverride ?? '100000',
      AZURE_TRANSLATOR_KEY: 'key',
      AZURE_TRANSLATOR_REGION: 'eastus',
    } as unknown as Env,
  }
}

// Captures fire-and-forget promises scheduled via c.executionCtx.waitUntil, so
// tests that exercise pro-tier billing (which uses waitUntil instead of awaiting
// the DB write) can wait for those writes to land before asserting.
function makeExecutionContext() {
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p) },
    passThroughOnException: () => {},
  }
  return { ctx, drain: () => Promise.all(pending) }
}

// Real state-tracking KV, adequate for rate-limit and idempotency assertions.
function createMemoryKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v) },
    delete: async (k: string) => { store.delete(k) },
  } as unknown as KVNamespace
}

async function makeToken(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return signJWT({ sub: userId, email: 'test@test.com', plan: 'free', exp }, JWT_SECRET)
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

describe('POST /translate/proper-noun', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'proper@test.com', 'hashed')
    await verifyUserEmail(db, userId)
    token = await makeToken(userId)
  })

  it('records proper noun even when word exists in translation_cache', async () => {
    await db
      .prepare('INSERT INTO translation_cache (word, target_lang, translation, hit_count, expires_at) VALUES (?, ?, ?, 1, unixepoch() + 86400)')
      .bind('paris', 'es', 'París')
      .run()

    const { app, env } = makeApp(db)
    const res = await app.request('/translate/proper-noun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ word: 'paris', targetLang: 'es' }),
    }, env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ verified: true })

    const row = await db
      .prepare('SELECT word FROM proper_nouns WHERE word = ?')
      .bind('paris')
      .first<{ word: string }>()
    expect(row?.word).toBe('paris')

    const cache = await db
      .prepare('SELECT 1 FROM translation_cache WHERE word = ?')
      .bind('paris')
      .first()
    expect(cache).toBeNull()
  })

  it('returns 400 for single-character words', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/proper-noun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ word: 'a', targetLang: 'es' }),
    }, env)
    expect(res.status).toBe(400)
  })
})

describe('POST /translate/report', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'report@test.com', 'hashed')
    await verifyUserEmail(db, userId)
    token = await makeToken(userId)
  })

  it('requires authentication', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'hello', targetLang: 'de', translation: 'hallo', reason: 'incorrect_translation' }),
    }, env)
    expect(res.status).toBe(401)
  })

  it('records a bad translation report', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ word: 'hello', targetLang: 'de', translation: 'hallo', reason: 'incorrect_translation' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    const row = await db.prepare('SELECT 1 FROM bad_translation WHERE word = ?').bind('hello').first()
    expect(row).not.toBeNull()
  })

  it('purges translation cache and cards when reason is not_a_word', async () => {
    await db
      .prepare('INSERT INTO translation_cache (word, target_lang, translation, hit_count, expires_at) VALUES (?, ?, ?, 1, unixepoch() + 86400)')
      .bind('blorp', 'de', 'Blorp')
      .run()
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ word: 'blorp', targetLang: 'de', translation: 'Blorp', reason: 'not_a_word' }),
    }, env)
    expect(res.status).toBe(200)
    const cached = await db.prepare('SELECT 1 FROM translation_cache WHERE word = ?').bind('blorp').first()
    expect(cached).toBeNull()
    const noun = await db.prepare('SELECT 1 FROM proper_nouns WHERE word = ?').bind('blorp').first()
    expect(noun).not.toBeNull()
  })

  it('returns 400 when word is missing', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetLang: 'de', translation: 'hallo' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid targetLang', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ word: 'hello', targetLang: 'xx', translation: 'hallo', reason: 'incorrect_translation' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('deletes only the caller\'s card when removeFromSrs is true (not global purge)', async () => {
    const otherUserId = await createUser(db, 'other@test.com', 'hashed')
    await verifyUserEmail(db, otherUserId)
    const nowSec = Math.floor(Date.now() / 1000)
    // Same word, same language, two different users
    for (const uid of [userId, otherUserId]) {
      await db
        .prepare(
          `INSERT INTO word_cards (user_id, word, target_lang, state, stability, difficulty, lapses, reps, due_at, last_rated_at, last_seen_at)
           VALUES (?, ?, ?, 'review', 1, 5, 0, 1, ?, ?, ?)`,
        )
        .bind(uid, 'hallo', 'de', nowSec, nowSec, nowSec)
        .run()
    }

    const { app, env } = makeApp(db)
    const res = await app.request('/translate/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        word: 'hallo',
        targetLang: 'de',
        translation: 'hello',
        reason: 'incorrect_translation',
        removeFromSrs: true,
      }),
    }, env)
    expect(res.status).toBe(200)

    // Caller's card is gone
    const mine = await db
      .prepare('SELECT 1 FROM word_cards WHERE user_id = ? AND word = ? AND target_lang = ?')
      .bind(userId, 'hallo', 'de')
      .first()
    expect(mine).toBeNull()

    // Other user's card is untouched — this is what distinguishes removeFromSrs
    // (per-user) from the "not_a_word" branch (global deleteAllCardsForWord).
    const theirs = await db
      .prepare('SELECT 1 FROM word_cards WHERE user_id = ? AND word = ? AND target_lang = ?')
      .bind(otherUserId, 'hallo', 'de')
      .first()
    expect(theirs).not.toBeNull()

    // And the bad_translation report was recorded
    const report = await db
      .prepare('SELECT 1 FROM bad_translation WHERE word = ? AND user_id = ?')
      .bind('hallo', userId)
      .first()
    expect(report).not.toBeNull()
  })
})

describe('POST /translate/pronounce', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'pronounce@test.com', 'hashed')
    await verifyUserEmail(db, userId)
    token = await makeToken(userId)
  })

  it('requires authentication', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/pronounce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hallo', targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(401)
  })

  it('returns 503 when speech service is not configured', async () => {
    const { app, env } = makeApp(db)
    const noSpeechEnv = {
      ...env,
      AZURE_SPEECH_KEY: undefined,
      AZURE_SPEECH_REGION: undefined,
      AZURE_TRANSLATOR_KEY: undefined,
      AZURE_TRANSLATOR_REGION: undefined,
    } as unknown as Env
    const res = await app.request('/translate/pronounce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'hallo', targetLang: 'de' }),
    }, noSpeechEnv)
    expect(res.status).toBe(503)
  })

  it('returns audio data from Azure speech on success', async () => {
    vi.mocked(synthesizePronunciation).mockResolvedValueOnce({ audioBase64: 'base64data', mimeType: 'audio/mpeg', voice: 'de-DE-KatjaNeural' })
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/pronounce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'hallo', targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { audioBase64: string; mimeType: string }
    expect(body.audioBase64).toBe('base64data')
    expect(body.mimeType).toBe('audio/mpeg')
  })

  it('returns 400 when text is missing', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/pronounce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid targetLang', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/translate/pronounce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'hallo', targetLang: 'zz' }),
    }, env)
    expect(res.status).toBe(400)
  })
})

describe('POST /translate — free-tier usage limit boundary', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string
  const limit = 50 // small limit keeps the arithmetic obvious

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getTranslationsCachedBatch).mockResolvedValue(new Map())
    vi.mocked(lookupWords).mockResolvedValue(new Map())
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockResolvedValue(new Map())
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'limit@test.com', 'hashed')
    await verifyUserEmail(db, userId)
    token = await makeToken(userId)
  })

  it('allows a request that lands exactly at the limit', async () => {
    // Seed usage such that adding the request's chars puts total EXACTLY at limit.
    // The word "hello" costs 5 chars in translate.ts's `[...allNew.keys()].join('').length`.
    await incrementUsage(db, userId, currentYearMonth(), limit - 5)
    vi.mocked(lookupWords).mockResolvedValue(new Map([['hello', HALLO]]))

    const { app, env } = makeApp(db, mockKV, String(limit))
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await getUsage(db, userId, currentYearMonth())).toBe(limit)
  })

  it('rejects a request that would land one char over the limit', async () => {
    await incrementUsage(db, userId, currentYearMonth(), limit - 4)
    vi.mocked(lookupWords).mockResolvedValue(new Map([['hello', HALLO]]))

    const { app, env } = makeApp(db, mockKV, String(limit))
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: 'LIMIT_REACHED' })
  })
})

describe('POST /translate — pro-tier billing (fire-and-forget)', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getTranslationsCachedBatch).mockResolvedValue(new Map())
    vi.mocked(lookupWords).mockResolvedValue(new Map())
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockResolvedValue(new Map())
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'pro@test.com', 'hashed')
    await verifyUserEmail(db, userId)
    // requireAuth reads plan from DB (JWT payload is ignored for plan) — set to 'pro'.
    await updatePlan(db, userId, 'pro', 'cus_pro_test')
    token = await makeToken(userId)
  })

  it('bypasses the free-tier limit AND still records usage via waitUntil', async () => {
    // Seed usage well above any conceivable free-tier limit — pro path must not gate on it.
    const preexisting = 999_999
    await incrementUsage(db, userId, currentYearMonth(), preexisting)
    vi.mocked(lookupWords).mockResolvedValue(new Map([['hello', HALLO]]))

    const { app, env } = makeApp(db)
    const { ctx, drain } = makeExecutionContext()
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env, ctx)
    expect(res.status).toBe(200)

    // The background task hasn't necessarily completed by the time the response returns
    // — wait for the promises the route scheduled via waitUntil, then assert the DB grew.
    await drain()
    expect(await getUsage(db, userId, currentYearMonth())).toBe(preexisting + 5)
  })
})

describe('POST /translate — rate limiting', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string
  let kv: KVNamespace

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getTranslationsCachedBatch).mockResolvedValue(new Map())
    vi.mocked(lookupWords).mockResolvedValue(new Map())
    vi.mocked(translateWords as ReturnType<typeof vi.fn>).mockResolvedValue(new Map())
    db = wrapDb(createTestDb())
    userId = await createUser(db, 'ratelimit@test.com', 'hashed')
    await verifyUserEmail(db, userId)
    token = await makeToken(userId)
    kv = createMemoryKV()
  })

  it('returns 429 once the per-user hourly limit is exhausted', async () => {
    // /translate limit is 200 per hour per user (see translate.ts).
    // Fill the bucket by writing the count directly — much faster than 200 real requests.
    const bucket = Math.floor(Date.now() / 1000 / (60 * 60))
    await kv.put(`rl:translate_req:${userId}:${bucket}`, '200')

    const { app, env } = makeApp(db, kv)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).toBe(429)
  })

  it('lets a request through when the bucket is under the limit', async () => {
    const bucket = Math.floor(Date.now() / 1000 / (60 * 60))
    await kv.put(`rl:translate_req:${userId}:${bucket}`, '199')

    const { app, env } = makeApp(db, kv)
    const res = await app.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: ['hello'], targetLang: 'de' }),
    }, env)
    expect(res.status).not.toBe(429)
  })
})
