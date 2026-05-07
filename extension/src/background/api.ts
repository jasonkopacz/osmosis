import { API_BASE_URL } from '../constants'
import type { TranslationEntry } from '../types'

function parseApiJson<T>(res: Response, bodyText: string): T {
  const t = bodyText.trim()
  if (!t) {
    throw new Error(`Empty response from API (HTTP ${res.status})`)
  }
  try {
    return JSON.parse(t) as T
  } catch {
    console.warn('[osmosis:api] non-JSON response body', {
      status: res.status,
      url: res.url,
      snippet: t.slice(0, 120),
    })
    if (res.status === 404) {
      throw new Error(
        `API route not found (404): ${res.url}. Deploy the latest backend or verify API_BASE_URL.`,
      )
    }
    if (t.startsWith('<!') || t.startsWith('<html') || t.includes('<!DOCTYPE')) {
      throw new Error(
        `API returned a web page instead of JSON (HTTP ${res.status}). Check that ${API_BASE_URL} is your deployed Worker.`,
      )
    }
    throw new Error(`Could not read API response (HTTP ${res.status}). Redeploy the backend or try again.`)
  }
}

async function authPost(path: string, body: object): Promise<string> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const bodyText = await res.text()
  const data = parseApiJson<{ token?: string; error?: string }>(res, bodyText)
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  if (!data.token) throw new Error('No token received')
  return data.token
}

export async function loginWithEmail(email: string, password: string): Promise<string> {
  return authPost('/auth/login', { email, password })
}

export async function requestEmailSignup(email: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/signup/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const bodyText = await res.text()
  const data = parseApiJson<{ ok?: boolean; error?: string }>(res, bodyText)
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
}

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const bodyText = await res.text()
  const data = parseApiJson<{ ok?: boolean; error?: string }>(res, bodyText)
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
}

export async function deleteAccount(token: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/user/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const bodyText = await res.text()
    const data = parseApiJson<{ error?: string }>(res, bodyText)
    throw new Error(data.error ?? `Request failed (${res.status})`)
  }
}

export async function translateBatch(
  words: string[],
  targetLang: string,
  token: string,
  contextsByWord?: Record<string, string>
): Promise<Map<string, TranslationEntry>> {
  const hasContexts = !!contextsByWord && Object.keys(contextsByWord).length > 0
  const res = await fetch(`${API_BASE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ words, targetLang, ...(hasContexts ? { contextsByWord } : {}) }),
  })
  if (res.status === 402) throw new Error('LIMIT_REACHED')
  if (res.status === 401) throw new Error('AUTH_EXPIRED')
  if (!res.ok) throw new Error(`API_ERROR:${res.status}`)
  const data = (await res.json()) as { translations: Record<string, TranslationEntry | string> }
  return new Map(
    Object.entries(data.translations).map(([word, val]) => [
      word,
      typeof val === 'string' ? { t: val } : val,
    ])
  )
}

export async function pronounceText(
  text: string,
  targetLang: string,
  token: string
): Promise<{ audioBase64: string; mimeType: string; voice: string }> {
  const res = await fetch(`${API_BASE_URL}/translate/pronounce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, targetLang }),
  })
  if (res.status === 402) throw new Error('LIMIT_REACHED')
  if (res.status === 401) throw new Error('AUTH_EXPIRED')
  if (!res.ok) {
    const bodyText = await res.text()
    let detail = bodyText
    try {
      const parsed = JSON.parse(bodyText) as { error?: string; detail?: string }
      detail = `${parsed.error ?? 'API_ERROR'}${parsed.detail ? ` (${parsed.detail})` : ''}`
    } catch {
      /* keep raw body text */
    }
    throw new Error(`API_ERROR:${res.status}:${detail}`)
  }
  return res.json() as Promise<{ audioBase64: string; mimeType: string; voice: string }>
}

export async function fetchUser(token: string): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
  return res.ok ? res.json() : null
}

export async function fetchPopularTranslations(lang: string, token: string, limit = 500): Promise<Map<string, TranslationEntry>> {
  const res = await fetch(
    `${API_BASE_URL}/translate/popular?lang=${encodeURIComponent(lang)}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return new Map()
  const data = await res.json() as { translations: Record<string, TranslationEntry | string> }
  return new Map(
    Object.entries(data.translations).map(([word, val]) => [
      word,
      typeof val === 'string' ? { t: val } : val,
    ])
  )
}

function readJsonError(res: Response, bodyText: string): string {
  try {
    const j = JSON.parse(bodyText) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return bodyText.trim() ? `${res.status}: ${bodyText.slice(0, 200)}` : `Request failed (${res.status})`
}

function normalizeChromeExtensionRedirectUri(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && /\.chromiumapp\.org$/.test(u.hostname)) {
      return `https://${u.hostname}/`
    }
  } catch {
    /* ignore */
  }
  return raw
}

export async function loginWithGoogle(): Promise<string> {
  const redirectUri = normalizeChromeExtensionRedirectUri(chrome.identity.getRedirectURL())
  const state = crypto.randomUUID()
  console.log('[osmosis:api] Google redirect_uri (must match Cloud Console exactly):', redirectUri)

  const urlRes = await fetch(
    `${API_BASE_URL}/auth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
  )
  const urlBody = await urlRes.text()
  if (!urlRes.ok) {
    const msg = readJsonError(urlRes, urlBody)
    console.warn('[osmosis:api] /auth/google/url failed', urlRes.status, msg)
    throw new Error(msg)
  }
  const { url } = JSON.parse(urlBody) as { url: string }

  // Store state before launching the flow so we can verify it on return
  await chrome.storage.session.set({ osmosis_oauth_state: state })

  console.log('[osmosis:api] calling launchWebAuthFlow...')
  const responseUrl = await new Promise<string | undefined>(resolve => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, redirectedTo => {
      const lastErr = chrome.runtime.lastError?.message
      console.log('[osmosis:api] launchWebAuthFlow callback', { redirectedTo, lastErr })
      if (lastErr) console.warn('[osmosis:api] launchWebAuthFlow error:', lastErr)
      resolve(redirectedTo)
    })
  })

  await chrome.storage.session.remove('osmosis_oauth_state')

  console.log('[osmosis:api] launchWebAuthFlow resolved, responseUrl:', responseUrl)
  if (!responseUrl) {
    throw new Error('Sign-in cancelled or blocked — check the service worker console for details')
  }

  const parsed = new URL(responseUrl)

  // Verify state to prevent OAuth CSRF
  const returnedState = parsed.searchParams.get('state')
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attempt')
  }

  const oauthErr = parsed.searchParams.get('error')
  if (oauthErr) {
    const desc = parsed.searchParams.get('error_description') ?? oauthErr
    console.warn('[osmosis:api] Google redirected with error', oauthErr, desc)
    throw new Error(
      oauthErr === 'redirect_uri_mismatch'
        ? `redirect_uri_mismatch: add this exact URL in Google Cloud → Credentials → your Web client → Authorized redirect URIs: ${redirectUri}`
        : desc
    )
  }
  const code = parsed.searchParams.get('code')
  if (!code) throw new Error('No authorization code from Google')

  const exch = await fetch(`${API_BASE_URL}/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  })
  const exchText = await exch.text()
  const body = parseApiJson<{ token?: string; error?: string }>(exch, exchText)
  if (!exch.ok) throw new Error(body.error ?? 'Google sign-in failed')
  if (!body.token) throw new Error('No token from server')
  return body.token
}
