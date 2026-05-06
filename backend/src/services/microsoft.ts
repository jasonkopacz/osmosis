import type { Env } from '../types'

type MicrosoftTokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
}

type MicrosoftUserInfo = {
  id: string
  mail?: string
  userPrincipalName?: string
}

const MS_AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'

export function getMicrosoftCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = env.MICROSOFT_CLIENT_ID?.trim()
  const clientSecret = env.MICROSOFT_CLIENT_SECRET?.trim()
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

export function buildMicrosoftAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    response_type: 'code',
    redirect_uri: redirect,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    prompt: 'select_account',
  })
  return `${MS_AUTH_BASE}/authorize?${params.toString()}`
}

export async function exchangeMicrosoftAuthCode(env: Env, code: string, redirectUri: string): Promise<MicrosoftTokenResponse> {
  const creds = getMicrosoftCredentials(env)
  if (!creds) throw new Error('Microsoft OAuth not configured')
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code: code.trim(),
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  })
  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn('[microsoftOAuth] token exchange failed', res.status, t)
    throw new Error(`Microsoft token exchange failed: ${res.status}`)
  }
  return (await res.json()) as MicrosoftTokenResponse
}

export async function fetchMicrosoftUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn('[microsoftOAuth] user info fetch failed', res.status, t)
    throw new Error(`Microsoft user info failed: ${res.status}`)
  }
  return (await res.json()) as MicrosoftUserInfo
}
