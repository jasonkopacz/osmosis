import { describe, it, expect } from 'vitest'
import { freeTierCharLimit } from '../src/lib/limits'
import type { Env } from '../src/types'

function env(partial: Partial<Env>): Env {
  return partial as Env
}

describe('freeTierCharLimit', () => {
  it('defaults to 50_000 when unset', () => {
    expect(freeTierCharLimit(env({}))).toBe(50_000)
  })
  it('parses numeric string', () => {
    expect(freeTierCharLimit(env({ FREE_TIER_CHAR_LIMIT: '5' }))).toBe(5)
  })
  it('falls back on invalid', () => {
    expect(freeTierCharLimit(env({ FREE_TIER_CHAR_LIMIT: 'nope' }))).toBe(50_000)
  })
})
