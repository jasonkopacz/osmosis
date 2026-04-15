import { describe, it, expect } from 'vitest'
import { isEligible } from '../src/content/filter'

describe('isEligible', () => {
  it('accepts a normal lowercase word', () => expect(isEligible('forest', ' ')).toBe(true))
  it('accepts sentence-start capital', () => expect(isEligible('The', '.')).toBe(true))
  it('rejects 2-char word', () => expect(isEligible('is', ' ')).toBe(false))
  it('rejects all-caps acronym', () => expect(isEligible('API', ' ')).toBe(false))
  it('rejects word with digit', () => expect(isEligible('v3', ' ')).toBe(false))
  it('rejects mid-sentence capital (proper noun)', () => expect(isEligible('Jason', 'a')).toBe(false))
  it('rejects word with dot (URL-like)', () => expect(isEligible('foo.bar', ' ')).toBe(false))
})
