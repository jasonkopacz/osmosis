import { describe, it, expect } from 'vitest'
import { scheduleNew, scheduleExisting } from '../../src/utils/fsrs'
import type { CardParams } from '../../src/utils/fsrs'

const NOW = 1_700_000_000 // arbitrary unix second

// ── scheduleNew ──────────────────────────────────────────────────────────────

describe('scheduleNew', () => {
  it('always produces review state', () => {
    for (const r of [1, 2, 3, 4] as const) {
      expect(scheduleNew(r, NOW).state).toBe('review')
    }
  })

  it('always produces interval >= 1 day', () => {
    for (const r of [1, 2, 3, 4] as const) {
      expect(scheduleNew(r, NOW).intervalDays).toBeGreaterThanOrEqual(1)
    }
  })

  it('sets dueAt in the future', () => {
    for (const r of [1, 2, 3, 4] as const) {
      expect(scheduleNew(r, NOW).dueAt).toBeGreaterThan(NOW)
    }
  })

  it('starts reps at 1', () => {
    for (const r of [1, 2, 3, 4] as const) {
      expect(scheduleNew(r, NOW).reps).toBe(1)
    }
  })

  it('starts lapses at 0', () => {
    for (const r of [1, 2, 3, 4] as const) {
      expect(scheduleNew(r, NOW).lapses).toBe(0)
    }
  })

  it('stability increases with rating (Again < Hard < Good < Easy)', () => {
    const s = [1, 2, 3, 4].map(r => scheduleNew(r as 1|2|3|4, NOW).stability)
    expect(s[0]).toBeLessThan(s[1]!)
    expect(s[1]).toBeLessThan(s[2]!)
    expect(s[2]).toBeLessThan(s[3]!)
  })

  it('interval increases with rating', () => {
    const ivls = [1, 2, 3, 4].map(r => scheduleNew(r as 1|2|3|4, NOW).intervalDays)
    expect(ivls[0]).toBeLessThanOrEqual(ivls[1]!)
    expect(ivls[1]).toBeLessThanOrEqual(ivls[2]!)
    expect(ivls[2]).toBeLessThanOrEqual(ivls[3]!)
  })

  it('difficulty stays in [1, 10]', () => {
    for (const r of [1, 2, 3, 4] as const) {
      const d = scheduleNew(r, NOW).difficulty
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(10)
    }
  })

  it('uses trained FSRS-4.5 initial stability for Easy (≈ 15.47)', () => {
    const { stability } = scheduleNew(4, NOW)
    expect(stability).toBeCloseTo(15.47, 1)
  })

  it('uses trained FSRS-4.5 initial stability for Again (≈ 0.41)', () => {
    const { stability } = scheduleNew(1, NOW)
    expect(stability).toBeCloseTo(0.41, 1)
  })
})

// ── scheduleExisting — recall (ratings 2, 3, 4) ──────────────────────────────

describe('scheduleExisting — recall', () => {
  const baseCard: CardParams = {
    stability: 10,
    difficulty: 5,
    lapses: 0,
    reps: 3,
    state: 'review',
    lastRatedAt: NOW - 10 * 86400, // 10 days ago
  }

  it('stays in review state', () => {
    for (const r of [2, 3, 4] as const) {
      expect(scheduleExisting(baseCard, r, NOW).state).toBe('review')
    }
  })

  it('increments reps by 1', () => {
    for (const r of [2, 3, 4] as const) {
      expect(scheduleExisting(baseCard, r, NOW).reps).toBe(baseCard.reps + 1)
    }
  })

  it('does not increment lapses', () => {
    for (const r of [2, 3, 4] as const) {
      expect(scheduleExisting(baseCard, r, NOW).lapses).toBe(baseCard.lapses)
    }
  })

  it('Good rating grows stability', () => {
    const { stability } = scheduleExisting(baseCard, 3, NOW)
    expect(stability).toBeGreaterThan(baseCard.stability)
  })

  it('Easy rating grows stability more than Good', () => {
    const good = scheduleExisting(baseCard, 3, NOW).stability
    const easy = scheduleExisting(baseCard, 4, NOW).stability
    expect(easy).toBeGreaterThan(good)
  })

  it('Hard rating grows stability less than Good', () => {
    const hard = scheduleExisting(baseCard, 2, NOW).stability
    const good = scheduleExisting(baseCard, 3, NOW).stability
    expect(hard).toBeLessThan(good)
  })

  it('interval is always >= 1 day', () => {
    for (const r of [2, 3, 4] as const) {
      expect(scheduleExisting(baseCard, r, NOW).intervalDays).toBeGreaterThanOrEqual(1)
    }
  })

  it('difficulty stays in [1, 10]', () => {
    for (const r of [2, 3, 4] as const) {
      const d = scheduleExisting(baseCard, r, NOW).difficulty
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(10)
    }
  })
})

// ── scheduleExisting — lapse (rating 1) ──────────────────────────────────────

describe('scheduleExisting — lapse', () => {
  const baseCard: CardParams = {
    stability: 20,
    difficulty: 4,
    lapses: 1,
    reps: 5,
    state: 'review',
    lastRatedAt: NOW - 20 * 86400,
  }

  it('transitions to relearning state', () => {
    expect(scheduleExisting(baseCard, 1, NOW).state).toBe('relearning')
  })

  it('increments lapses', () => {
    expect(scheduleExisting(baseCard, 1, NOW).lapses).toBe(baseCard.lapses + 1)
  })

  it('increments reps', () => {
    expect(scheduleExisting(baseCard, 1, NOW).reps).toBe(baseCard.reps + 1)
  })

  it('stability is lower than before the lapse', () => {
    const { stability } = scheduleExisting(baseCard, 1, NOW)
    expect(stability).toBeLessThan(baseCard.stability)
  })

  it('stability is positive after lapse', () => {
    const { stability } = scheduleExisting(baseCard, 1, NOW)
    expect(stability).toBeGreaterThan(0)
  })

  it('interval is >= 1 day', () => {
    expect(scheduleExisting(baseCard, 1, NOW).intervalDays).toBeGreaterThanOrEqual(1)
  })

  it('difficulty increases (card gets harder)', () => {
    const { difficulty } = scheduleExisting(baseCard, 1, NOW)
    expect(difficulty).toBeGreaterThanOrEqual(baseCard.difficulty)
  })

  it('difficulty stays in [1, 10]', () => {
    const { difficulty } = scheduleExisting({ ...baseCard, difficulty: 9.5 }, 1, NOW)
    expect(difficulty).toBeLessThanOrEqual(10)
  })
})

// ── scheduleExisting — relearning recovery ────────────────────────────────────

describe('scheduleExisting — relearning recovery', () => {
  const relearningCard: CardParams = {
    stability: 2,
    difficulty: 7,
    lapses: 2,
    reps: 6,
    state: 'relearning',
    lastRatedAt: NOW - 2 * 86400,
  }

  it('Good rating moves relearning card back to review', () => {
    expect(scheduleExisting(relearningCard, 3, NOW).state).toBe('review')
  })

  it('Again on relearning card stays relearning and increments lapses', () => {
    const result = scheduleExisting(relearningCard, 1, NOW)
    expect(result.state).toBe('relearning')
    expect(result.lapses).toBe(relearningCard.lapses + 1)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('never-reviewed card (lastRatedAt=0) schedules without error', () => {
    const card: CardParams = {
      stability: 5,
      difficulty: 5,
      lapses: 0,
      reps: 0,
      state: 'review',
      lastRatedAt: 0,
    }
    expect(() => scheduleExisting(card, 3, NOW)).not.toThrow()
  })

  it('due date is consistent with intervalDays', () => {
    const result = scheduleNew(3, NOW)
    expect(result.dueAt).toBe(NOW + result.intervalDays * 86400)
  })
})
