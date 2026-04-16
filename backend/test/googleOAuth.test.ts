import { describe, it, expect } from 'vitest'
import { isChromeExtensionRedirectUri } from '../src/services/google'

describe('isChromeExtensionRedirectUri', () => {
  it('accepts chromiumapp.org root', () => {
    expect(isChromeExtensionRedirectUri('https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/')).toBe(true)
  })
  it('rejects arbitrary https', () => {
    expect(isChromeExtensionRedirectUri('https://evil.com/callback')).toBe(false)
  })
  it('rejects path other than root', () => {
    expect(isChromeExtensionRedirectUri('https://abc.chromiumapp.org/foo')).toBe(false)
  })
})
