import { SessionCache } from './cache'
import { getToken, setToken, clearToken } from './auth'
import { getUserProfileCache, setUserProfileCache } from './userProfileCache'
import { translateBatch, fetchUser, loginWithGoogle, fetchPopularTranslations } from './api'
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

    try {
      const fresh = await translateBatch(uncached, msg.targetLang, token)
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
      await setToken(token)
      cache.clear()
      lastPrewarmedLang = null
      const user = (await fetchUser(token)) as UserProfile | null
      if (user) await setUserProfileCache(user)
      const r = await chrome.storage.sync.get('osmosis_settings')
      const lang = (r.osmosis_settings as { targetLang?: string } | undefined)?.targetLang
      if (lang) void preWarmCache(lang, token)
      console.log('[osmosis:bg] GOOGLE_LOGIN: success')
      return { token }
    } catch (err) {
      const errMsg = String(err).replace('Error: ', '')
      console.warn('[osmosis:bg] GOOGLE_LOGIN failed', errMsg)
      return { error: errMsg }
    }
  }

  return { error: 'UNKNOWN_MESSAGE' }
}
