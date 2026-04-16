import type { Env } from '../types'

export type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
  scope?: string
  refresh_token?: string
}

export type GoogleUserInfo = {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export function isChromeExtensionRedirectUri(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri)
    return u.protocol === 'https:' && u.pathname === '/' && /\.chromiumapp\.org$/.test(u.hostname)
  } catch {
    return false
  }
}

export async function exchangeGoogleAuthCode(
  env: Env,
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const clientId = env.GOOGLE_CLIENT_ID
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured')

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn('[googleOAuth] token exchange failed', res.status, t)
    throw new Error(`Google token exchange failed: ${res.status}`)
  }
  return (await res.json()) as GoogleTokenResponse
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn('[googleOAuth] userinfo failed', res.status, t)
    throw new Error(`Google userinfo failed: ${res.status}`)
  }
  return (await res.json()) as GoogleUserInfo
}

export function buildGoogleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
