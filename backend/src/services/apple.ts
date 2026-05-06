import type { Env } from '../types'

type AppleTokenResponse = {
  access_token: string
  id_token: string
  token_type?: string
  expires_in?: number
}

type AppleIdTokenPayload = {
  sub: string
  email?: string
  email_verified?: string | boolean
}

export function getAppleCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = env.APPLE_CLIENT_ID?.trim()
  const clientSecret = env.APPLE_CLIENT_SECRET?.trim()
  if (clientId && clientSecret) return { clientId, clientSecret }
  return null
}

export function isChromeExtensionRedirectUri(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri)
    const hostOk = u.protocol === 'https:' && /\.chromiumapp\.org$/.test(u.hostname)
    const pathOk = u.pathname === '/' || u.pathname === ''
    return hostOk && pathOk
  } catch {
    return false
  }
}

export function normalizeChromeExtensionRedirectUri(redirectUri: string): string {
  try {
    const u = new URL(redirectUri)
    if (u.protocol === 'https:' && /\.chromiumapp\.org$/.test(u.hostname)) {
      return `https://${u.hostname}/`
    }
  } catch {
    /* ignore */
  }
  return redirectUri
}

export function buildAppleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirect,
    response_type: 'code',
    response_mode: 'query',
    scope: 'name email',
    state,
  })
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`
}

export async function exchangeAppleAuthCode(env: Env, code: string, redirectUri: string): Promise<AppleTokenResponse> {
  const creds = getAppleCredentials(env)
  if (!creds) throw new Error('Apple OAuth not configured')
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code.trim(),
    redirect_uri: redirect,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn('[appleOAuth] token exchange failed', res.status, t)
    throw new Error(`Apple token exchange failed: ${res.status}`)
  }
  return (await res.json()) as AppleTokenResponse
}

function decodeJwtPayload<T>(jwt: string): T {
  const parts = jwt.split('.')
  if (parts.length < 2) throw new Error('Invalid JWT format')
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const json = atob(padded)
  return JSON.parse(json) as T
}

export function parseAppleIdToken(idToken: string): AppleIdTokenPayload {
  return decodeJwtPayload<AppleIdTokenPayload>(idToken)
}
