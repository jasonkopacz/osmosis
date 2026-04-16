import { describe, it, expect } from 'vitest'
import { LANGUAGES, normalizeTargetLang } from '../src/shared/languages'

describe('LANGUAGES', () => {
  it('contains at least 50 languages', () => {
    expect(LANGUAGES.length).toBeGreaterThan(50)
  })

  it('every entry has a non-empty code, name, and flag', () => {
    for (const lang of LANGUAGES) {
      expect(lang.code.length).toBeGreaterThan(0)
      expect(lang.name.length).toBeGreaterThan(0)
      expect(lang.flag.length).toBeGreaterThan(0)
    }
  })

  it('all codes are unique', () => {
    const codes = LANGUAGES.map(l => l.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('contains common languages', () => {
    const codes = new Set(LANGUAGES.map(l => l.code))
    expect(codes.has('de')).toBe(true)  // German
    expect(codes.has('fr')).toBe(true)  // French
    expect(codes.has('es')).toBe(true)  // Spanish
    expect(codes.has('ja')).toBe(true)  // Japanese
    expect(codes.has('zh-Hans')).toBe(true)  // Chinese Simplified
  })
})

describe('normalizeTargetLang', () => {
  it('maps legacy "no" code to "nb"', () => {
    expect(normalizeTargetLang('no')).toBe('nb')
  })

  it('passes through valid codes unchanged', () => {
    expect(normalizeTargetLang('de')).toBe('de')
    expect(normalizeTargetLang('fr')).toBe('fr')
    expect(normalizeTargetLang('zh-Hans')).toBe('zh-Hans')
  })

  it('passes through unknown codes unchanged', () => {
    expect(normalizeTargetLang('xx')).toBe('xx')
  })
})
