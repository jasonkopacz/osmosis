import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  computeStreak,
  computeLongest,
  updateStreakLog,
  getStreakInfo,
  todayStr,
  prevDay,
  daysAgoStr,
  STREAK_GOAL,
  STREAK_KEY,
} from '../src/background/streak'
import type { StreakLog } from '../src/background/streak'

// ── Chrome storage mock ───────────────────────────────────────────────────────

const store: Record<string, unknown> = {}

beforeEach(() => {
  Object.keys(store).forEach(k => { delete store[k] })
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
        set: vi.fn((obj: Record<string, unknown>) => { Object.assign(store, obj); return Promise.resolve() }),
      },
    },
  })
})

// ── Date helpers ──────────────────────────────────────────────────────────────

describe('todayStr', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('prevDay', () => {
  it('returns the previous calendar day', () => {
    expect(prevDay('2026-01-01')).toBe('2025-12-31')
    expect(prevDay('2026-03-01')).toBe('2026-02-28')
    expect(prevDay('2026-05-10')).toBe('2026-05-09')
  })

  it('handles month boundaries', () => {
    expect(prevDay('2026-02-01')).toBe('2026-01-31')
    expect(prevDay('2026-12-01')).toBe('2026-11-30')
  })
})

describe('daysAgoStr', () => {
  it('returns today for 0 days ago', () => {
    expect(daysAgoStr(0)).toBe(todayStr())
  })

  it('returns a date in the past for positive n', () => {
    expect(daysAgoStr(1)).toBe(prevDay(todayStr()))
  })
})

// ── computeStreak — pure logic ────────────────────────────────────────────────

describe('computeStreak', () => {
  const today = '2026-05-10'

  it('returns zeros for an empty log', () => {
    const result = computeStreak({}, today)
    expect(result).toMatchObject({ streak: 0, todayCount: 0, goalMet: false, atRisk: false })
  })

  it('streak=1 when only today meets the goal', () => {
    const log: StreakLog = { [today]: STREAK_GOAL }
    expect(computeStreak(log, today).streak).toBe(1)
  })

  it('goalMet=true when today count >= STREAK_GOAL', () => {
    const log: StreakLog = { [today]: STREAK_GOAL + 5 }
    const result = computeStreak(log, today)
    expect(result.goalMet).toBe(true)
    expect(result.todayCount).toBe(STREAK_GOAL + 5)
  })

  it('goalMet=false when today count < STREAK_GOAL', () => {
    const log: StreakLog = { [today]: STREAK_GOAL - 1 }
    expect(computeStreak(log, today).goalMet).toBe(false)
  })

  it('counts consecutive days including today when goal met', () => {
    const yesterday = prevDay(today)
    const twoDaysAgo = prevDay(yesterday)
    const log: StreakLog = {
      [today]: STREAK_GOAL,
      [yesterday]: STREAK_GOAL,
      [twoDaysAgo]: STREAK_GOAL,
    }
    expect(computeStreak(log, today).streak).toBe(3)
  })

  it('streak starts from yesterday when today goal not yet met', () => {
    const yesterday = prevDay(today)
    const twoDaysAgo = prevDay(yesterday)
    const log: StreakLog = {
      [today]: 3,                // not yet at goal
      [yesterday]: STREAK_GOAL,
      [twoDaysAgo]: STREAK_GOAL,
    }
    const result = computeStreak(log, today)
    expect(result.streak).toBe(2)   // yesterday + two days ago
    expect(result.atRisk).toBe(true)
    expect(result.goalMet).toBe(false)
  })

  it('atRisk=true when streak is alive but today not done', () => {
    const log: StreakLog = { [prevDay(today)]: STREAK_GOAL, [today]: 0 }
    const result = computeStreak(log, today)
    expect(result.atRisk).toBe(true)
    expect(result.streak).toBe(1)
  })

  it('atRisk=false when streak = 0', () => {
    const result = computeStreak({}, today)
    expect(result.atRisk).toBe(false)
  })

  it('atRisk=false when streak > 0 and goal met today', () => {
    const log: StreakLog = { [today]: STREAK_GOAL, [prevDay(today)]: STREAK_GOAL }
    expect(computeStreak(log, today).atRisk).toBe(false)
  })

  it('streak breaks when a day is skipped', () => {
    const yesterday = prevDay(today)
    const threeDaysAgo = prevDay(prevDay(yesterday)) // skip day before yesterday
    const log: StreakLog = {
      [today]: STREAK_GOAL,
      // yesterday missing — streak broken
      [threeDaysAgo]: STREAK_GOAL,
    }
    expect(computeStreak(log, today).streak).toBe(1) // only today counts
  })

  it('does not count days below the goal threshold', () => {
    const yesterday = prevDay(today)
    const log: StreakLog = {
      [today]: STREAK_GOAL,
      [yesterday]: STREAK_GOAL - 1, // just under goal
    }
    expect(computeStreak(log, today).streak).toBe(1)
  })

  it('single day streak is 1 not 0', () => {
    const log: StreakLog = { [today]: STREAK_GOAL }
    expect(computeStreak(log, today).streak).toBe(1)
  })
})

// ── computeLongest ────────────────────────────────────────────────────────────

describe('computeLongest', () => {
  const today = '2026-05-10'

  it('returns 0 for empty log', () => {
    expect(computeLongest({})).toBe(0)
  })

  it('returns 1 for a single qualifying day', () => {
    expect(computeLongest({ [today]: STREAK_GOAL })).toBe(1)
  })

  it('finds the longest consecutive run', () => {
    const d1 = '2026-05-01'; const d2 = '2026-05-02'; const d3 = '2026-05-03'
    const d5 = '2026-05-05'; const d6 = '2026-05-06'
    const log: StreakLog = {
      [d1]: STREAK_GOAL, [d2]: STREAK_GOAL, [d3]: STREAK_GOAL,  // run of 3
      [d5]: STREAK_GOAL, [d6]: STREAK_GOAL,                       // run of 2
    }
    expect(computeLongest(log)).toBe(3)
  })

  it('ignores days below the goal', () => {
    const log: StreakLog = {
      '2026-05-01': STREAK_GOAL,
      '2026-05-02': STREAK_GOAL - 1, // below goal — breaks run
      '2026-05-03': STREAK_GOAL,
    }
    expect(computeLongest(log)).toBe(1)
  })

  it('handles a single long run', () => {
    const log: StreakLog = {}
    for (let i = 1; i <= 30; i++) {
      log[`2026-01-${String(i).padStart(2, '0')}`] = STREAK_GOAL
    }
    expect(computeLongest(log)).toBe(30)
  })
})

// ── updateStreakLog (I/O) ─────────────────────────────────────────────────────

describe('updateStreakLog', () => {
  it('creates an entry for today on first call', async () => {
    await updateStreakLog(5)
    const log = store[STREAK_KEY] as StreakLog
    expect(log[todayStr()]).toBe(5)
  })

  it('accumulates counts across multiple calls', async () => {
    await updateStreakLog(5)
    await updateStreakLog(8)
    const log = store[STREAK_KEY] as StreakLog
    expect(log[todayStr()]).toBe(13)
  })

  it('does nothing for wordCount <= 0', async () => {
    await updateStreakLog(0)
    await updateStreakLog(-1)
    expect(store[STREAK_KEY]).toBeUndefined()
  })

  it('preserves entries from previous days', async () => {
    const yesterday = prevDay(todayStr())
    store[STREAK_KEY] = { [yesterday]: 20 } as StreakLog
    await updateStreakLog(5)
    const log = store[STREAK_KEY] as StreakLog
    expect(log[yesterday]).toBe(20)
    expect(log[todayStr()]).toBe(5)
  })

  it('prunes entries older than 366 days', async () => {
    const ancient = '2020-01-01'
    store[STREAK_KEY] = { [ancient]: 50 } as StreakLog
    await updateStreakLog(1)
    const log = store[STREAK_KEY] as StreakLog
    expect(log[ancient]).toBeUndefined()
  })
})

// ── getStreakInfo (I/O) ───────────────────────────────────────────────────────

describe('getStreakInfo', () => {
  it('returns all-zero info when storage is empty', async () => {
    const info = await getStreakInfo()
    expect(info.streak).toBe(0)
    expect(info.todayCount).toBe(0)
    expect(info.goalMet).toBe(false)
    expect(info.goalTarget).toBe(STREAK_GOAL)
  })

  it('reflects stored data correctly', async () => {
    const today = todayStr()
    store[STREAK_KEY] = { [today]: STREAK_GOAL } as StreakLog
    const info = await getStreakInfo()
    expect(info.goalMet).toBe(true)
    expect(info.todayCount).toBe(STREAK_GOAL)
    expect(info.streak).toBe(1)
  })

  it('reports atRisk when yesterday was active but today is not', async () => {
    const yesterday = prevDay(todayStr())
    store[STREAK_KEY] = { [yesterday]: STREAK_GOAL } as StreakLog
    const info = await getStreakInfo()
    expect(info.atRisk).toBe(true)
    expect(info.streak).toBe(1)
  })
})
