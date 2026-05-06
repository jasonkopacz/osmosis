import { describe, it, expect } from 'vitest'
import { SessionCache } from '../src/background/cache'

describe('SessionCache', () => {
  it('returns null on miss', () => {
    expect(new SessionCache().get('hello', 'de')).toBeNull()
  })
  it('returns cached value on hit', () => {
    const c = new SessionCache()
    c.set('hello', 'de', { t: 'hallo' })
    expect(c.get('hello', 'de')).toEqual({ t: 'hallo' })
  })
  it('treats different languages as separate', () => {
    const c = new SessionCache()
    c.set('hello', 'de', { t: 'hallo' })
    expect(c.get('hello', 'fr')).toBeNull()
  })
  it('clear removes all entries', () => {
    const c = new SessionCache()
    c.set('hello', 'de', { t: 'hallo' })
    c.set('world', 'fr', { t: 'monde' })
    c.clear()
    expect(c.get('hello', 'de')).toBeNull()
    expect(c.get('world', 'fr')).toBeNull()
  })
})
