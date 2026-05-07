import { SessionCache } from './cache'
import { getToken, setToken, clearToken } from './auth'
import { getUserProfileCache, setUserProfileCache } from './userProfileCache'
import { translateBatch, pronounceText, fetchUser, loginWithGoogle, loginWithEmail, requestEmailSignup, fetchPopularTranslations, requestPasswordReset, deleteAccount } from './api'
import type { Message, UserProfile, TranslationEntry } from '../types'

const cache = new SessionCache()
void cache.init()
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000

let lastPrewarmedLang: string | null = null

async function preWarmCache(lang: string, token: string): Promise<void> {
  try {
    const popular = await fetchPopularTranslations(lang, token)
    if (popular.size === 0) return
    popular.forEach((val, word) => cache.set(word, lang, val))
    lastPrewarmedLang = lang
    console.log(`[osmosis:bg] pre-warmed ${popular.size} translations for "${lang}"`)
  } catch (err) {
    console.warn('[osmosis:bg] pre-warm failed', err)
  }
}

async function afterLogin(token: string): Promise<{ token: string }> {
  await setToken(token)
  cache.clear()
  lastPrewarmedLang = null
  const user = (await fetchUser(token)) as UserProfile | null
  if (user) await setUserProfileCache(user)
  const r = await chrome.storage.sync.get('osmosis_settings')
  const lang = (r.osmosis_settings as { targetLang?: string } | undefined)?.targetLang
  if (lang) void preWarmCache(lang, token)
  return { token }
}

async function refreshUserProfileInBackground(token: string): Promise<void> {
  try {
    const user = (await fetchUser(token)) as UserProfile | null
    if (user) {
      await setUserProfileCache(user)
      console.log('[osmosis:bg] user profile refresh OK')
    } else {
      await clearToken()
      console.warn('[osmosis:bg] user profile refresh: session invalid, cleared token')
    }
  } catch (err) {
    console.warn('[osmosis:bg] user profile refresh failed', err)
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch(err => sendResponse({ error: String(err) }))
  return true
})


async function handle(msg: Message): Promise<unknown> {
  if (msg.type === 'TRANSLATE') {
    await cache.ensureReady()
    const token = await getToken()
    if (!token) {
      console.warn('[osmosis:bg] TRANSLATE rejected: not logged in')
      return { error: 'NOT_LOGGED_IN' }
    }

    if (msg.targetLang !== lastPrewarmedLang) {
      void preWarmCache(msg.targetLang, token)
    }

    const result: Record<string, TranslationEntry> = {}
    const uncached = msg.words.filter(w => {
      const hit = cache.get(w, msg.targetLang)
      if (hit) result[w] = hit
      return !hit
    })

    console.log('[osmosis:bg] TRANSLATE', { total: msg.words.length, uncached: uncached.length, lang: msg.targetLang })

    if (uncached.length === 0) return { translations: result }

    const uncachedContextsByWord = Object.fromEntries(
      uncached
        .map(word => [word, msg.contextsByWord?.[word]] as const)
        .filter(([, context]): context is string => typeof context === 'string' && context.length > 0)
    )
    const contextWordCount = Object.keys(uncachedContextsByWord).length
    if (contextWordCount > 0) {
      console.log('[osmosis:bg] TRANSLATE context attached', {
        uncachedWithContext: contextWordCount,
        uncachedTotal: uncached.length,
        coveragePct: Number(((contextWordCount / uncached.length) * 100).toFixed(1)),
        uncachedContextsByWord,
      })
    } else {
      console.log('[osmosis:bg] TRANSLATE context attached', {
        uncachedWithContext: 0,
        uncachedTotal: uncached.length,
        coveragePct: 0,
      })
    }

    try {
      const fresh = await translateBatch(uncached, msg.targetLang, token, uncachedContextsByWord)
      fresh.forEach((val, key) => {
        result[key] = val
        cache.set(key, msg.targetLang, val)
      })
      return { translations: result }
    } catch (err) {
      const s = String(err)
      if (s.includes('LIMIT_REACHED')) return { error: 'LIMIT_REACHED' }
      if (s.includes('AUTH_EXPIRED')) {
        await clearToken()
        return { error: 'AUTH_EXPIRED' }
      }
      console.warn('[osmosis:bg] TRANSLATE API error', s)
      // Return whatever we have from cache rather than nothing
      if (Object.keys(result).length > 0) return { translations: result }
      return { error: 'API_ERROR' }
    }
  }

  if (msg.type === 'PRONOUNCE') {
    const token = await getToken()
    if (!token) return { error: 'NOT_LOGGED_IN' }
    try {
      const text = msg.text.trim().slice(0, 120)
      if (!text) return { error: 'INVALID_TEXT' }
      console.log('[osmosis:bg] PRONOUNCE', { text, targetLang: msg.targetLang })
      const result = await pronounceText(text, msg.targetLang, token)
      return result
    } catch (err) {
      const s = String(err)
      if (s.includes('LIMIT_REACHED')) return { error: 'LIMIT_REACHED' }
      if (s.includes('AUTH_EXPIRED')) {
        await clearToken()
        return { error: 'AUTH_EXPIRED' }
      }
      console.warn('[osmosis:bg] PRONOUNCE API error', s)
      return { error: 'API_ERROR' }
    }
  }

  if (msg.type === 'GET_USER') {
    const token = await getToken()
    if (!token) {
      console.log('[osmosis:bg] GET_USER: no token')
      return null
    }
    const cached = await getUserProfileCache()
    const cacheAge = cached ? Date.now() - cached.fetchedAt : null
    const cacheFresh = cached && cacheAge !== null && cacheAge < PROFILE_CACHE_TTL_MS
    if (cacheFresh && cached.profile) {
      console.log('[osmosis:bg] GET_USER: using cached profile', { cacheAge_ms: cacheAge })
      void refreshUserProfileInBackground(token)
      return cached.profile
    }
    console.log('[osmosis:bg] GET_USER: fetching /user/me')
    try {
      const user = (await fetchUser(token)) as UserProfile | null
      if (user) {
        await setUserProfileCache(user)
        return user
      }
      await clearToken()
      return null
    } catch (err) {
      console.warn('[osmosis:bg] GET_USER: fetch error', err)
      if (cached?.profile) {
        console.log('[osmosis:bg] GET_USER: returning stale cache after fetch failure')
        return cached.profile
      }
      return null
    }
  }

  if (msg.type === 'GOOGLE_LOGIN') {
    try {
      const token = await loginWithGoogle()
      console.log('[osmosis:bg] GOOGLE_LOGIN: success')
      const result = await afterLogin(token)
      // Popup closed when the OAuth window stole focus — reopen it now that the flow is done
      void chrome.action.openPopup().catch(() => {/* already open, or window not focused */})
      return result
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[osmosis:bg] GOOGLE_LOGIN failed', errMsg)
      return { error: errMsg }
    }
  }

  if (msg.type === 'EMAIL_LOGIN') {
    try {
      const token = await loginWithEmail(msg.email, msg.password)
      console.log('[osmosis:bg] EMAIL_LOGIN: success')
      return afterLogin(token)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[osmosis:bg] EMAIL_LOGIN failed', errMsg)
      return { error: errMsg }
    }
  }

  if (msg.type === 'EMAIL_SIGNUP') {
    try {
      await requestEmailSignup(msg.email, msg.password)
      console.log('[osmosis:bg] EMAIL_SIGNUP: verification email requested')
      return { ok: true }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[osmosis:bg] EMAIL_SIGNUP failed', errMsg)
      return { error: errMsg }
    }
  }

  if (msg.type === 'SESSION_FROM_VERIFY') {
    try {
      console.log('[osmosis:bg] SESSION_FROM_VERIFY: applying session')
      return await afterLogin(msg.token)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[osmosis:bg] SESSION_FROM_VERIFY failed', errMsg)
      return { error: errMsg }
    }
  }

  if (msg.type === 'FORGOT_PASSWORD') {
    try {
      await requestPasswordReset(msg.email)
      return { ok: true }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[osmosis:bg] FORGOT_PASSWORD failed', errMsg)
      return { error: errMsg }
    }
  }

  if (msg.type === 'DELETE_ACCOUNT') {
    try {
      const token = await getToken()
      if (!token) return { error: 'Not signed in' }
      await deleteAccount(token)
      await clearToken()
      console.log('[osmosis:bg] DELETE_ACCOUNT: account deleted')
      return { ok: true }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[osmosis:bg] DELETE_ACCOUNT failed', errMsg)
      return { error: errMsg }
    }
  }

  return { error: 'UNKNOWN_MESSAGE' }
}
