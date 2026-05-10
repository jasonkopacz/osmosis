import { describe, it, expect, beforeEach, vi } from 'vitest'
import { recordLocalEncounters, encounterKey } from '../src/content/encounters'
import type { EncounterEntry } from '../src/types'

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

function getLog(lang: string): Record<string, EncounterEntry> {
  return (store[encounterKey(lang)] ?? {}) as Record<string, EncounterEntry>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('encounterKey', () => {
  it('namespaces by language', () => {
    expect(encounterKey('es')).toBe('srs_encounters_es')
    expect(encounterKey('fr')).toBe('srs_encounters_fr')
    expect(encounterKey('zh-Hans')).toBe('srs_encounters_zh-Hans')
  })
})

describe('recordLocalEncounters', () => {
  it('creates an entry for a new word with count 1', async () => {
    await recordLocalEncounters(['hello'], 'es')
    const log = getLog('es')
    expect(log['hello']?.count).toBe(1)
  })

  it('increments count on a second encounter', async () => {
    await recordLocalEncounters(['hello'], 'es')
    await recordLocalEncounters(['hello'], 'es')
    expect(getLog('es')['hello']?.count).toBe(2)
  })

  it('normalises words to lowercase', async () => {
    await recordLocalEncounters(['Hello', 'WORLD'], 'es')
    const log = getLog('es')
    expect(log['hello']).toBeDefined()
    expect(log['world']).toBeDefined()
    expect(log['Hello']).toBeUndefined()
  })

  it('tracks multiple words in one call', async () => {
    await recordLocalEncounters(['apple', 'banana', 'cherry'], 'es')
    const log = getLog('es')
    expect(log['apple']?.count).toBe(1)
    expect(log['banana']?.count).toBe(1)
    expect(log['cherry']?.count).toBe(1)
  })

  it('sets firstSeen on creation', async () => {
    const before = Date.now()
    await recordLocalEncounters(['sun'], 'es')
    const after = Date.now()
    const entry = getLog('es')['sun']!
    expect(entry.firstSeen).toBeGreaterThanOrEqual(before)
    expect(entry.firstSeen).toBeLessThanOrEqual(after)
  })

  it('preserves firstSeen and updates lastSeen on re-encounter', async () => {
    await recordLocalEncounters(['moon'], 'es')
    const firstSeen = getLog('es')['moon']!.firstSeen
    await new Promise(r => setTimeout(r, 5))
    await recordLocalEncounters(['moon'], 'es')
    const entry = getLog('es')['moon']!
    expect(entry.firstSeen).toBe(firstSeen)
    expect(entry.lastSeen).toBeGreaterThanOrEqual(firstSeen)
  })

  it('keeps separate logs per language', async () => {
    await recordLocalEncounters(['tree'], 'es')
    await recordLocalEncounters(['tree'], 'fr')
    expect(getLog('es')['tree']?.count).toBe(1)
    expect(getLog('fr')['tree']?.count).toBe(1)
  })

  it('handles an empty word list without writing', async () => {
    await recordLocalEncounters([], 'es')
    expect(getLog('es')).toEqual({})
  })

  it('evicts oldest entries when the log exceeds 2000 words', async () => {
    // Pre-fill with 2000 entries with staggered lastSeen times
    const oldLog: Record<string, EncounterEntry> = {}
    const base = Date.now() - 1_000_000
    for (let i = 0; i < 2000; i++) {
      oldLog[`word${i}`] = { count: 1, firstSeen: base, lastSeen: base + i }
    }
    store[encounterKey('es')] = oldLog

    // Add one more word — must evict the oldest (word0, which has lastSeen = base + 0)
    await recordLocalEncounters(['newcomer'], 'es')
    const log = getLog('es')

    expect(Object.keys(log)).toHaveLength(2000)
    expect(log['newcomer']).toBeDefined()
    // word0 had the smallest lastSeen, so it should be evicted
    expect(log['word0']).toBeUndefined()
    // word1999 had the largest lastSeen among originals, so it should survive
    expect(log['word1999']).toBeDefined()
  })

  it('does not evict when below the 2000 word limit', async () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`)
    await recordLocalEncounters(words, 'es')
    expect(Object.keys(getLog('es'))).toHaveLength(100)
  })
})
