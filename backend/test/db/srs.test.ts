import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, wrapDb } from '../helpers/db'
import { createUser, findUserByEmail } from '../../src/db/users'
import { setTranslationCached } from '../../src/db/translations'
import {
  getCard,
  upsertCard,
  batchRecordEncounters,
  getDueCards,
  getSrsStats,
} from '../../src/db/srs'
import type { SchedulingResult } from '../../src/utils/fsrs'

const NOW = 1_700_000_000

function makeResult(overrides: Partial<SchedulingResult> = {}): SchedulingResult {
  return {
    stability: 10,
    difficulty: 5,
    lapses: 0,
    reps: 1,
    state: 'review',
    intervalDays: 10,
    dueAt: NOW + 10 * 86400,
    ...overrides,
  }
}

describe('SRS DB layer', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string

  beforeEach(async () => {
    const raw = createTestDb()
    db = wrapDb(raw)
    await createUser(db, 'test@example.com', 'hash')
    const user = await findUserByEmail(db, 'test@example.com')
    userId = user!.id
  })

  // ── getCard ────────────────────────────────────────────────────────────────

  describe('getCard', () => {
    it('returns null for a word that has no card', async () => {
      expect(await getCard(db, userId, 'hello', 'es')).toBeNull()
    })

    it('returns the card after upsert', async () => {
      await upsertCard(db, userId, 'hello', 'es', makeResult(), NOW)
      const card = await getCard(db, userId, 'hello', 'es')
      expect(card).not.toBeNull()
      expect(card?.word).toBe('hello')
      expect(card?.targetLang).toBe('es')
    })

    it('is case-insensitive for word lookup', async () => {
      await upsertCard(db, userId, 'Hello', 'es', makeResult(), NOW)
      expect(await getCard(db, userId, 'hello', 'es')).not.toBeNull()
    })
  })

  // ── upsertCard ─────────────────────────────────────────────────────────────

  describe('upsertCard', () => {
    it('persists all FSRS fields on creation', async () => {
      const result = makeResult({ stability: 7.5, difficulty: 6.2, lapses: 0, reps: 1, state: 'review', dueAt: NOW + 7 * 86400 })
      await upsertCard(db, userId, 'world', 'es', result, NOW)
      const card = await getCard(db, userId, 'world', 'es')
      expect(card?.stability).toBeCloseTo(7.5)
      expect(card?.difficulty).toBeCloseTo(6.2)
      expect(card?.reps).toBe(1)
      expect(card?.state).toBe('review')
      expect(card?.dueAt).toBe(NOW + 7 * 86400)
      expect(card?.lastRatedAt).toBe(NOW)
    })

    it('updates scheduling state on subsequent upsert', async () => {
      await upsertCard(db, userId, 'sun', 'es', makeResult({ stability: 5, reps: 1 }), NOW)
      await upsertCard(db, userId, 'sun', 'es', makeResult({ stability: 12, reps: 2, dueAt: NOW + 12 * 86400 }), NOW + 86400)
      const card = await getCard(db, userId, 'sun', 'es')
      expect(card?.stability).toBeCloseTo(12)
      expect(card?.reps).toBe(2)
    })

    it('does not touch encounter_count so passive history is preserved', async () => {
      // Simulate passive encounters recorded before the first rating
      await batchRecordEncounters(db, userId, ['river'], 'es', NOW)
      await batchRecordEncounters(db, userId, ['river'], 'es', NOW + 1)
      // Rating should not reset or increment encounter_count
      await upsertCard(db, userId, 'river', 'es', makeResult(), NOW + 2)
      await upsertCard(db, userId, 'river', 'es', makeResult({ reps: 2 }), NOW + 3)
      const card = await getCard(db, userId, 'river', 'es')
      expect(card?.encounterCount).toBe(2)
    })

    it('transitions to relearning state', async () => {
      await upsertCard(db, userId, 'sky', 'es', makeResult({ state: 'relearning', lapses: 1 }), NOW)
      const card = await getCard(db, userId, 'sky', 'es')
      expect(card?.state).toBe('relearning')
      expect(card?.lapses).toBe(1)
    })
  })

  // ── batchRecordEncounters ──────────────────────────────────────────────────

  describe('batchRecordEncounters', () => {
    it('creates rows for new words', async () => {
      await batchRecordEncounters(db, userId, ['apple', 'tree'], 'es', NOW)
      const apple = await getCard(db, userId, 'apple', 'es')
      expect(apple?.encounterCount).toBe(1)
      expect(apple?.lastSeenAt).toBe(NOW)
    })

    it('increments encounter_count for existing card', async () => {
      await upsertCard(db, userId, 'moon', 'es', makeResult(), NOW)
      await batchRecordEncounters(db, userId, ['moon'], 'es', NOW + 1)
      const card = await getCard(db, userId, 'moon', 'es')
      expect(card?.encounterCount).toBe(2)
    })

    it('does not overwrite scheduling state for rated cards', async () => {
      const result = makeResult({ stability: 14, reps: 3, state: 'review' })
      await upsertCard(db, userId, 'star', 'es', result, NOW)
      await batchRecordEncounters(db, userId, ['star'], 'es', NOW + 1)
      const card = await getCard(db, userId, 'star', 'es')
      expect(card?.stability).toBeCloseTo(14)
      expect(card?.reps).toBe(3)
    })

    it('handles empty word list without error', async () => {
      await expect(batchRecordEncounters(db, userId, [], 'es', NOW)).resolves.toBeUndefined()
    })
  })

  // ── getDueCards ────────────────────────────────────────────────────────────

  describe('getDueCards', () => {
    it('returns empty array when no cards exist', async () => {
      const cards = await getDueCards(db, userId, 'es', NOW, 20)
      expect(cards).toHaveLength(0)
    })

    it('returns cards whose due_at <= now', async () => {
      await upsertCard(db, userId, 'overdue', 'es', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      const cards = await getDueCards(db, userId, 'es', NOW, 20)
      expect(cards).toHaveLength(1)
      expect(cards[0]?.word).toBe('overdue')
    })

    it('excludes cards not yet due', async () => {
      await upsertCard(db, userId, 'future', 'es', makeResult({ dueAt: NOW + 100, reps: 1 }), NOW)
      const cards = await getDueCards(db, userId, 'es', NOW, 20)
      expect(cards).toHaveLength(0)
    })

    it('excludes cards with reps=0 (encounter-only, never rated)', async () => {
      await batchRecordEncounters(db, userId, ['unrated'], 'es', NOW)
      const cards = await getDueCards(db, userId, 'es', NOW, 20)
      expect(cards).toHaveLength(0)
    })

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await upsertCard(db, userId, `word${i}`, 'es', makeResult({ dueAt: NOW - i, reps: 1 }), NOW - 86400)
      }
      const cards = await getDueCards(db, userId, 'es', NOW, 3)
      expect(cards).toHaveLength(3)
    })

    it('orders by most overdue first', async () => {
      await upsertCard(db, userId, 'recent', 'es', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      await upsertCard(db, userId, 'old', 'es', makeResult({ dueAt: NOW - 1000, reps: 1 }), NOW - 86400)
      const cards = await getDueCards(db, userId, 'es', NOW, 10)
      expect(cards[0]?.word).toBe('old')
    })

    it('includes translation text from translation_cache when available', async () => {
      await upsertCard(db, userId, 'house', 'es', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      await setTranslationCached(db, 'house', 'es', { t: 'casa', p: 'NOUN' })
      const cards = await getDueCards(db, userId, 'es', NOW, 10)
      expect(cards[0]?.translation).toBe('casa')
      expect(cards[0]?.posTag).toBe('NOUN')
    })

    it('returns empty string for translation when word not in translation_cache', async () => {
      await upsertCard(db, userId, 'unknown', 'es', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      const cards = await getDueCards(db, userId, 'es', NOW, 10)
      expect(cards[0]?.translation).toBe('')
    })

    it('only returns cards for the requested language', async () => {
      await upsertCard(db, userId, 'hello', 'es', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      await upsertCard(db, userId, 'hello', 'fr', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      const cards = await getDueCards(db, userId, 'fr', NOW, 20)
      expect(cards).toHaveLength(1)
      expect(cards[0]?.targetLang).toBe('fr')
    })
  })

  // ── getSrsStats ────────────────────────────────────────────────────────────

  describe('getSrsStats', () => {
    it('returns all-zero stats for a user with no cards', async () => {
      const stats = await getSrsStats(db, userId, 'es', NOW)
      expect(stats).toEqual({ total: 0, inReview: 0, relearning: 0, reviewedToday: 0, dueCount: 0 })
    })

    it('counts rated cards in total (encounter-only cards excluded)', async () => {
      await upsertCard(db, userId, 'a', 'es', makeResult({ reps: 1 }), NOW)
      await batchRecordEncounters(db, userId, ['b'], 'es', NOW) // reps=0, excluded
      const stats = await getSrsStats(db, userId, 'es', NOW)
      expect(stats.total).toBe(1)
    })

    it('counts review vs relearning states', async () => {
      await upsertCard(db, userId, 'r1', 'es', makeResult({ state: 'review', reps: 1 }), NOW)
      await upsertCard(db, userId, 'r2', 'es', makeResult({ state: 'review', reps: 1 }), NOW)
      await upsertCard(db, userId, 'rl', 'es', makeResult({ state: 'relearning', lapses: 1, reps: 2 }), NOW)
      const stats = await getSrsStats(db, userId, 'es', NOW)
      expect(stats.inReview).toBe(2)
      expect(stats.relearning).toBe(1)
      expect(stats.total).toBe(3)
    })

    it('counts reviewedToday for cards rated today', async () => {
      const todayStart = NOW - (NOW % 86400)
      await upsertCard(db, userId, 'today', 'es', makeResult({ reps: 1 }), todayStart + 1)
      await upsertCard(db, userId, 'yesterday', 'es', makeResult({ reps: 1 }), todayStart - 1)
      const stats = await getSrsStats(db, userId, 'es', NOW)
      expect(stats.reviewedToday).toBe(1)
    })

    it('counts dueCount for cards due at or before now', async () => {
      await upsertCard(db, userId, 'due', 'es', makeResult({ dueAt: NOW - 1, reps: 1 }), NOW - 86400)
      await upsertCard(db, userId, 'future', 'es', makeResult({ dueAt: NOW + 99, reps: 1 }), NOW)
      const stats = await getSrsStats(db, userId, 'es', NOW)
      expect(stats.dueCount).toBe(1)
    })

    it('scopes stats to the requested language', async () => {
      await upsertCard(db, userId, 'a', 'es', makeResult({ reps: 1 }), NOW)
      await upsertCard(db, userId, 'a', 'fr', makeResult({ reps: 1 }), NOW)
      const stats = await getSrsStats(db, userId, 'fr', NOW)
      expect(stats.total).toBe(1)
    })
  })
})
