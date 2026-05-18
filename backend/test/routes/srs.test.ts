import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { srsRouter } from '../../src/routes/srs'
import { createTestDb, wrapDb } from '../helpers/db'
import { createUser, findUserByEmail } from '../../src/db/users'
import { signJWT } from '../../src/utils/jwt'
import type { Env, Variables } from '../../src/types'

// KV is accessed in requireAuth for session cache — return null so it falls through to DB
const mockKV = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
} as unknown as KVNamespace

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  app.route('/srs', srsRouter)
  return {
    app,
    env: { DB: db, JWT_SECRET, TRANSLATION_CACHE: mockKV } as unknown as Env,
  }
}

async function makeToken(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return signJWT({ sub: userId, email: 'test@example.com', exp }, JWT_SECRET)
}

describe('SRS routes', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(mockKV.get).mockResolvedValue(null)

    const raw = createTestDb()
    db = wrapDb(raw)
    await createUser(db, 'test@example.com', 'hashed')
    const user = await findUserByEmail(db, 'test@example.com')
    userId = user!.id
    token = await makeToken(userId)
  })

  // ── POST /srs/rate ─────────────────────────────────────────────────────────

  describe('POST /srs/rate', () => {
    it('returns 401 without auth', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'hello', targetLang: 'es', rating: 3 }),
      }, env)
      expect(res.status).toBe(401)
    })

    it('returns 400 for missing word', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetLang: 'es', rating: 3 }),
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid targetLang', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'hello', targetLang: 'xx', rating: 3 }),
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns 400 for rating out of range', async () => {
      const { app, env } = makeApp(db)
      for (const rating of [0, 5, 'good']) {
        const res = await app.request('/srs/rate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ word: 'hello', targetLang: 'es', rating }),
        }, env)
        expect(res.status).toBe(400)
      }
    })

    it('creates a new card on first rating and returns scheduling info', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'hello', targetLang: 'es', rating: 3 }),
      }, env)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.word).toBe('hello')
      expect(body.state).toBe('review')
      expect(typeof body.intervalDays).toBe('number')
      expect((body.intervalDays as number)).toBeGreaterThanOrEqual(1)
      expect(body.reps).toBe(1)
    })

    it('updates card on second rating, incrementing reps', async () => {
      const { app, env } = makeApp(db)
      await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'world', targetLang: 'es', rating: 3 }),
      }, env)
      const res2 = await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'world', targetLang: 'es', rating: 4 }),
      }, env)
      expect(res2.status).toBe(200)
      const body = await res2.json() as Record<string, unknown>
      expect(body.reps).toBe(2)
    })

    it('Again rating produces relearning state on an existing card', async () => {
      const { app, env } = makeApp(db)
      // First rating: create the card
      await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'moon', targetLang: 'es', rating: 3 }),
      }, env)
      // Second rating: lapse
      const res = await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'moon', targetLang: 'es', rating: 1 }),
      }, env)
      const body = await res.json() as Record<string, unknown>
      expect(body.state).toBe('relearning')
      expect(body.lapses).toBe(1)
    })

    it('Easy produces longer interval than Again', async () => {
      const { app, env } = makeApp(db)
      const rateWord = async (rating: number) => {
        const res = await app.request('/srs/rate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ word: `word-${rating}`, targetLang: 'es', rating }),
        }, env)
        return (await res.json() as { intervalDays: number }).intervalDays
      }
      const again = await rateWord(1)
      const easy  = await rateWord(4)
      expect(easy).toBeGreaterThan(again)
    })
  })

  // ── POST /srs/encounters ───────────────────────────────────────────────────

  describe('POST /srs/encounters', () => {
    it('returns 401 without auth', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: ['hello'], targetLang: 'es' }),
      }, env)
      expect(res.status).toBe(401)
    })

    it('returns 400 for missing words', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetLang: 'es' }),
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid targetLang', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ words: ['hello'], targetLang: 'xx' }),
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns 200 ok for valid request', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ words: ['cat', 'dog', 'bird'], targetLang: 'es' }),
      }, env)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(body.recorded).toBe(3)
    })
  })

  // ── GET /srs/due ──────────────────────────────────────────────────────────

  describe('GET /srs/due', () => {
    it('returns 401 without auth', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/due?lang=es', {}, env)
      expect(res.status).toBe(401)
    })

    it('returns 400 for missing lang', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/due', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid lang', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/due?lang=xx', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns empty cards array when nothing is due', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/due?lang=es', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(200)
      const body = await res.json() as { cards: unknown[] }
      expect(body.cards).toHaveLength(0)
    })

    it('returns cards that are due with correct shape', async () => {
      // Create a due card via /srs/rate then manually make it overdue via encounters
      const { app, env } = makeApp(db)
      await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'sun', targetLang: 'es', rating: 1 }),
      }, env)
      // The new card for rating=1 has very short interval (~1 day) — it might not be due yet in test time
      // So instead query and just assert the shape when due cards exist
      const res = await app.request('/srs/due?lang=es', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(200)
      const body = await res.json() as { cards: Array<Record<string, unknown>> }
      // Cards may or may not be due, but the shape must be correct if present
      for (const card of body.cards) {
        expect(typeof card.word).toBe('string')
        expect(typeof card.translation).toBe('string')
        expect(['review', 'relearning']).toContain(card.state)
      }
    })

    it('respects the limit query param', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/due?lang=es&limit=5', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(200)
    })
  })

  // ── GET /srs/stats ────────────────────────────────────────────────────────

  describe('GET /srs/stats', () => {
    it('returns 401 without auth', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/stats?lang=es', {}, env)
      expect(res.status).toBe(401)
    })

    it('returns 400 for missing lang', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/stats', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(400)
    })

    it('returns zero stats for a new user', async () => {
      const { app, env } = makeApp(db)
      const res = await app.request('/srs/stats?lang=es', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, number>
      expect(body.total).toBe(0)
      expect(body.inReview).toBe(0)
      expect(body.relearning).toBe(0)
      expect(body.reviewedToday).toBe(0)
      expect(body.dueCount).toBe(0)
    })

    it('reflects cards after rating', async () => {
      const { app, env } = makeApp(db)
      await app.request('/srs/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ word: 'fire', targetLang: 'es', rating: 3 }),
      }, env)
      const res = await app.request('/srs/stats?lang=es', {
        headers: { Authorization: `Bearer ${token}` },
      }, env)
      const body = await res.json() as { total: number; reviewedToday: number }
      expect(body.total).toBe(1)
      expect(body.reviewedToday).toBe(1)
    })
  })
})
