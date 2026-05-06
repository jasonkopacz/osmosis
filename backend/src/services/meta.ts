import type { Env } from '../types'

type MetaTokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
}

type MetaUserInfo = {
  id: string
  email?: string
}

export function getMetaCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = env.META_CLIENT_ID?.trim()
  const clientSecret = env.META_CLIENT_SECRET?.trim()
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

export function buildMetaAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirect,
    state,
    response_type: 'code',
    scope: 'email',
  })
  return `https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`
}

export async function exchangeMetaAuthCode(env: Env, code: string, redirectUri: string): Promise<MetaTokenResponse> {
  const creds = getMetaCredentials(env)
  if (!creds) throw new Error('Meta OAuth not configured')
  const redirect = normalizeChromeExtensionRedirectUri(redirectUri.trim())
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirect,
    code: code.trim(),
  })
  const res = await fetch(`https://graph.facebook.com/v23.0/oauth/access_token?${params.toString()}`)
  if (!res.ok) {
    const t = await res.text()
    console.warn('[metaOAuth] token exchange failed', res.status, t)
    throw new Error(`Meta token exchange failed: ${res.status}`)
  }
  return (await res.json()) as MetaTokenResponse
}

export async function fetchMetaUserInfo(accessToken: string): Promise<MetaUserInfo> {
  const params = new URLSearchParams({ fields: 'id,email', access_token: accessToken })
  const res = await fetch(`https://graph.facebook.com/me?${params.toString()}`)
  if (!res.ok) {
    const t = await res.text()
    console.warn('[metaOAuth] user info fetch failed', res.status, t)
    throw new Error(`Meta user info failed: ${res.status}`)
  }
  return (await res.json()) as MetaUserInfo
}
