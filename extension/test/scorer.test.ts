import { describe, it, expect } from 'vitest'
import { scoreWord, sampleWords } from '../src/content/scorer'

describe('scoreWord', () => {
  it('gives ultra-common words lower score than learnable words', () => {
    expect(scoreWord('the')).toBeLessThan(scoreWord('forest'))
  })
  it('gives unknown words score 2 (learnable)', () => {
    expect(scoreWord('xyzqwerty')).toBe(2)
  })
})

describe('sampleWords', () => {
  const words = ['forest', 'beautiful', 'ancient', 'running', 'quickly', 'mountain', 'river', 'valley', 'stone', 'light']

  it('returns the correct count for the percentage', () => {
    expect(sampleWords(words, 30, 'https://example.com').length).toBe(Math.round(words.length * 0.3))
  })

  it('is deterministic for same URL', () => {
    const a = sampleWords(words, 30, 'https://example.com')
    const b = sampleWords(words, 30, 'https://example.com')
    expect(a).toEqual(b)
  })

  it('differs for different URLs', () => {
    const a = sampleWords(words, 30, 'https://site-a.com')
    const b = sampleWords(words, 30, 'https://site-b.com')
    expect(a).not.toEqual(b)
  })

  it('never exceeds 200 words', () => {
    const many = Array.from({ length: 1000 }, (_, i) => `word${i}`)
    expect(sampleWords(many, 50, 'https://x.com').length).toBeLessThanOrEqual(200)
  })
})
