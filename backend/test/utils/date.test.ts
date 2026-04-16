import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { currentYearMonth } from '../../src/utils/date'

describe('currentYearMonth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns UTC YYYY-MM', () => {
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
    expect(currentYearMonth()).toBe('2026-04')
  })

  it('zero-pads month', () => {
    vi.setSystemTime(new Date('2026-01-05T00:00:00.000Z'))
    expect(currentYearMonth()).toBe('2026-01')
  })
})
