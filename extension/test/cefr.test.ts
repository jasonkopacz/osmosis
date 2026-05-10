import { describe, it, expect } from 'vitest'
import { passesCefrFilter, CEFR_LEVELS, CEFR_LABELS, CEFR_DESCRIPTIONS } from '../src/content/cefr'
import type { CefrMinLevel } from '../src/content/cefr'

// ── passesCefrFilter ─────────────────────────────────────────────────────────

describe('passesCefrFilter — all (off)', () => {
  it('passes any word when level is "all"', () => {
    // "the" is rank 1 (A1), the most common word possible
    expect(passesCefrFilter('the', 'all')).toBe(true)
    // unknown/rare word treated as C2
    expect(passesCefrFilter('xyzqwerty', 'all')).toBe(true)
  })
})

describe('passesCefrFilter — A1 minimum', () => {
  it('passes A1 words', () => {
    // "time" rank ~50 → A1
    expect(passesCefrFilter('time', 'A1')).toBe(true)
  })
  it('passes B1 words (above A1)', () => {
    // "ancient" is a less common word → B1 or above
    expect(passesCefrFilter('ancient', 'A1')).toBe(true)
  })
  it('passes C2 words (unknown → treated as rare)', () => {
    expect(passesCefrFilter('xyzqwerty', 'A1')).toBe(true)
  })
})

describe('passesCefrFilter — B1 minimum', () => {
  it('excludes A1 words (very common)', () => {
    // "the" is rank 1 → A1, should be excluded with B1 filter
    expect(passesCefrFilter('the', 'B1')).toBe(false)
  })
  it('excludes A2 words', () => {
    // "around" is roughly rank 1000 → A2
    expect(passesCefrFilter('around', 'B1')).toBe(false)
  })
  it('passes C2 words (rare/unknown words always pass)', () => {
    expect(passesCefrFilter('xyzqwerty', 'B1')).toBe(true)
  })
})

describe('passesCefrFilter — C1 minimum', () => {
  it('excludes common words', () => {
    expect(passesCefrFilter('the', 'C1')).toBe(false)
    expect(passesCefrFilter('time', 'C1')).toBe(false)
  })
  it('passes C2 (rare) words', () => {
    expect(passesCefrFilter('xyzqwerty', 'C1')).toBe(true)
  })
})

describe('passesCefrFilter — C2 minimum', () => {
  it('excludes all known-frequency words', () => {
    // Anything in the corpus (rank 1–10000) is at most C1
    expect(passesCefrFilter('the', 'C2')).toBe(false)
    // Even rank 9000+ words are C1 not C2
    expect(passesCefrFilter('around', 'C2')).toBe(false)
  })
  it('passes unknown/rare words (not in corpus → C2)', () => {
    expect(passesCefrFilter('xyzqwerty', 'C2')).toBe(true)
    expect(passesCefrFilter('zzz_notaword_zzz', 'C2')).toBe(true)
  })
})

describe('passesCefrFilter — monotonicity', () => {
  const testWords = ['the', 'time', 'river', 'around', 'philosophy', 'xyzqwerty']
  const levels: CefrMinLevel[] = ['all', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']

  it('raising the minimum level never lets more words through', () => {
    for (const word of testWords) {
      let prevPassed = true
      for (const level of levels) {
        const passed = passesCefrFilter(word, level)
        if (!prevPassed) {
          // Once a level filters the word out, stricter levels must too
          expect(passed).toBe(false)
        }
        prevPassed = passed
      }
    }
  })
})

describe('passesCefrFilter — case insensitivity', () => {
  it('treats uppercase and lowercase the same', () => {
    expect(passesCefrFilter('The', 'B1')).toBe(passesCefrFilter('the', 'B1'))
    expect(passesCefrFilter('TIME', 'B1')).toBe(passesCefrFilter('time', 'B1'))
  })
})

// ── CEFR_LEVELS ordering ─────────────────────────────────────────────────────

describe('CEFR_LEVELS', () => {
  it('starts with "all" and then A1 through C2', () => {
    expect(CEFR_LEVELS[0]).toBe('all')
    expect(CEFR_LEVELS[1]).toBe('A1')
    expect(CEFR_LEVELS[CEFR_LEVELS.length - 1]).toBe('C2')
  })

  it('has 7 entries (all + 6 CEFR levels)', () => {
    expect(CEFR_LEVELS).toHaveLength(7)
  })
})

// ── CEFR_LABELS / CEFR_DESCRIPTIONS completeness ────────────────────────────

describe('CEFR_LABELS', () => {
  it('has a label for every level', () => {
    for (const level of CEFR_LEVELS) {
      expect(CEFR_LABELS[level]).toBeTruthy()
    }
  })
})

describe('CEFR_DESCRIPTIONS', () => {
  it('has a description for every level', () => {
    for (const level of CEFR_LEVELS) {
      expect(CEFR_DESCRIPTIONS[level]).toBeTruthy()
    }
  })
})
