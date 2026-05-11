import { describe, it, expect } from 'vitest'
import { findPhrasesInText, samplePhrases, uniquePhrases } from '../src/content/phraseScanner'
import type { PhraseEntry } from '../src/content/phraseScanner'

// ── findPhrasesInText ─────────────────────────────────────────────────────────

describe('findPhrasesInText', () => {
  it('finds a simple phrase', () => {
    const matches = findPhrasesInText('By the way, the weather is nice.')
    expect(matches.some(m => m.phrase === 'by the way')).toBe(true)
  })

  it('is case-insensitive', () => {
    const matches = findPhrasesInText('OF COURSE this works.')
    expect(matches.some(m => m.phrase === 'of course')).toBe(true)
  })

  it('returns correct start/end offsets', () => {
    const text = 'Hello. Of course it works.'
    const matches = findPhrasesInText(text)
    const m = matches.find(x => x.phrase === 'of course')
    expect(m).toBeDefined()
    expect(text.slice(m!.start, m!.end).toLowerCase()).toBe('of course')
  })

  it('respects word boundaries — does not match mid-word', () => {
    // "in fact" should not match inside "infact" (no space boundary)
    const matches = findPhrasesInText('This is infact not a match.')
    expect(matches.some(m => m.phrase === 'in fact')).toBe(false)
  })

  it('matches phrase at the very start of text', () => {
    const matches = findPhrasesInText('of course you can.')
    expect(matches.some(m => m.phrase === 'of course')).toBe(true)
  })

  it('matches phrase at the very end of text', () => {
    const matches = findPhrasesInText('We did it right now')
    expect(matches.some(m => m.phrase === 'right now')).toBe(true)
  })

  it('finds multiple non-overlapping phrases in one string', () => {
    const text = 'By the way, of course, right now is the time.'
    const matches = findPhrasesInText(text)
    const phrases = matches.map(m => m.phrase)
    expect(phrases).toContain('by the way')
    expect(phrases).toContain('of course')
    expect(phrases).toContain('right now')
  })

  it('does not return overlapping matches', () => {
    const matches = findPhrasesInText('by the way and by the way again')
    // "by the way" should match twice (non-overlapping, different positions)
    const wayMatches = matches.filter(m => m.phrase === 'by the way')
    expect(wayMatches).toHaveLength(2)
    // Verify they don't overlap
    for (let i = 1; i < wayMatches.length; i++) {
      expect(wayMatches[i]!.start).toBeGreaterThanOrEqual(wayMatches[i - 1]!.end)
    }
  })

  it('returns empty array for text with no phrases', () => {
    expect(findPhrasesInText('xyzqwerty zzz zzz')).toHaveLength(0)
  })

  it('returns empty array for short text', () => {
    expect(findPhrasesInText('hi')).toHaveLength(0)
  })

  it('all returned matches are sorted by start offset', () => {
    const text = 'In fact, by the way, of course, take care everyone.'
    const matches = findPhrasesInText(text)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.end)
    }
  })
})

// ── uniquePhrases ─────────────────────────────────────────────────────────────

describe('uniquePhrases', () => {
  it('returns deduplicated canonical phrases', () => {
    const entries: PhraseEntry[] = [
      { phrase: 'of course', surface: 'Of course', node: null as unknown as Text, start: 0, end: 9 },
      { phrase: 'of course', surface: 'of course', node: null as unknown as Text, start: 20, end: 29 },
      { phrase: 'in fact',   surface: 'In fact',   node: null as unknown as Text, start: 40, end: 47 },
    ]
    const unique = uniquePhrases(entries)
    expect(unique).toHaveLength(2)
    expect(unique).toContain('of course')
    expect(unique).toContain('in fact')
  })

  it('returns empty array for empty entries', () => {
    expect(uniquePhrases([])).toHaveLength(0)
  })
})

// ── samplePhrases ─────────────────────────────────────────────────────────────

describe('samplePhrases', () => {
  const candidates = ['by the way', 'of course', 'in fact', 'right now', 'take care',
                       'make sense', 'carry out', 'find out', 'so far', 'at least']

  it('returns the correct number of phrases for the percentage', () => {
    const sampled = samplePhrases(candidates, 50, 'https://example.com')
    expect(sampled.size).toBe(Math.round(candidates.length * 0.5))
  })

  it('is deterministic for the same URL', () => {
    const a = samplePhrases(candidates, 30, 'https://example.com')
    const b = samplePhrases(candidates, 30, 'https://example.com')
    expect([...a].sort()).toEqual([...b].sort())
  })

  it('differs for different URLs', () => {
    const a = samplePhrases(candidates, 50, 'https://site-a.com')
    const b = samplePhrases(candidates, 50, 'https://site-b.com')
    // May occasionally collide by chance, but with 10 items and 50% this is extremely unlikely
    expect([...a].sort()).not.toEqual([...b].sort())
  })

  it('returns at least 1 phrase even for very low percentage', () => {
    const sampled = samplePhrases(candidates, 1, 'https://example.com')
    expect(sampled.size).toBeGreaterThanOrEqual(1)
  })

  it('only returns phrases from the candidates list', () => {
    const sampled = samplePhrases(candidates, 80, 'https://example.com')
    for (const p of sampled) {
      expect(candidates).toContain(p)
    }
  })
})
