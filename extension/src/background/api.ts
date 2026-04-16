import { API_BASE_URL } from '../constants'

export async function translateBatch(words: string[], targetLang: string, token: string): Promise<Map<string, string>> {
  const res = await fetch(`${API_BASE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ words, targetLang }),
  })
  if (res.status === 402) throw new Error('LIMIT_REACHED')
  if (res.status === 401) throw new Error('AUTH_EXPIRED')
  if (!res.ok) throw new Error(`API_ERROR:${res.status}`)
  const data = (await res.json()) as { translations: Record<string, string> }
  return new Map(Object.entries(data.translations))
}

export async function fetchUser(token: string): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
  return res.ok ? res.json() : null
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
  const body = (await exch.json()) as { token?: string; error?: string }
  if (!exch.ok) throw new Error(body.error ?? 'Google sign-in failed')
  if (!body.token) throw new Error('No token from server')
  return body.token
}
