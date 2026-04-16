import type { Env } from '../types'

type GoogleWebClientFile = { web?: { client_id?: string; client_secret?: string } }

export function getGoogleWebClientCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const raw = env.GOOGLE_WEB_CLIENT_JSON?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as GoogleWebClientFile
      const clientId = parsed.web?.client_id?.trim()
      const clientSecret = parsed.web?.client_secret?.trim()
      if (clientId && clientSecret) return { clientId, clientSecret }
      console.warn('[googleOAuth] GOOGLE_WEB_CLIENT_JSON missing web.client_id or web.client_secret')
    } catch (err) {
      console.warn('[googleOAuth] GOOGLE_WEB_CLIENT_JSON is not valid JSON', err)
    }
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  if (clientId && clientSecret) return { clientId, clientSecret }
  return null
}

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

export async function exchangeGoogleAuthCode(
  env: Env,
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const creds = getGoogleWebClientCredentials(env)
  if (!creds) throw new Error('Google OAuth not configured')
  const { clientId, clientSecret } = creds

  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())

  const body = new URLSearchParams({
    code: code.trim(),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirect,
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
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
