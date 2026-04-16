import { describe, it, expect } from 'vitest'
import {
  buildGoogleAuthorizeUrl,
  getGoogleWebClientCredentials,
  isChromeExtensionRedirectUri,
  normalizeChromeExtensionRedirectUri,
} from '../../src/services/google'
import type { Env } from '../../src/types'

function env(partial: Partial<Env>): Env {
  return partial as Env
}

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

describe('normalizeChromeExtensionRedirectUri', () => {
  it('normalizes chromiumapp host to trailing slash', () => {
    expect(normalizeChromeExtensionRedirectUri('https://abc.chromiumapp.org')).toBe('https://abc.chromiumapp.org/')
  })
  it('returns original when not chromiumapp', () => {
    expect(normalizeChromeExtensionRedirectUri('https://example.com/cb')).toBe('https://example.com/cb')
  })
})

describe('getGoogleWebClientCredentials', () => {
  it('returns null when unset', () => {
    expect(getGoogleWebClientCredentials(env({}))).toBeNull()
  })
  it('reads from GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET', () => {
    expect(
      getGoogleWebClientCredentials(
        env({ GOOGLE_CLIENT_ID: ' id ', GOOGLE_CLIENT_SECRET: ' secret ' })
      )
    ).toEqual({ clientId: 'id', clientSecret: 'secret' })
  })
  it('prefers GOOGLE_WEB_CLIENT_JSON when valid', () => {
    const json = JSON.stringify({
      web: { client_id: 'fromjson', client_secret: 'sec' },
    })
    expect(
      getGoogleWebClientCredentials(
        env({
          GOOGLE_WEB_CLIENT_JSON: json,
          GOOGLE_CLIENT_ID: 'ignored',
          GOOGLE_CLIENT_SECRET: 'ignored',
        })
      )
    ).toEqual({ clientId: 'fromjson', clientSecret: 'sec' })
  })
  it('falls back to env vars when JSON is invalid', () => {
    expect(
      getGoogleWebClientCredentials(
        env({
          GOOGLE_WEB_CLIENT_JSON: 'not-json',
          GOOGLE_CLIENT_ID: 'fallback',
          GOOGLE_CLIENT_SECRET: 'sec',
        })
      )
    ).toEqual({ clientId: 'fallback', clientSecret: 'sec' })
  })
})

describe('buildGoogleAuthorizeUrl', () => {
  it('points at Google OAuth and includes required query params', () => {
    const url = buildGoogleAuthorizeUrl(
      'client-id',
      'https://ext.chromiumapp.org',
      'state-xyz'
    )
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe('client-id')
    expect(u.searchParams.get('redirect_uri')).toBe('https://ext.chromiumapp.org/')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('state')).toBe('state-xyz')
    expect(u.searchParams.get('scope')).toContain('email')
  })
})
