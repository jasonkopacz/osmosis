import { SessionCache } from './cache'
import { getToken, setToken, clearToken } from './auth'
import { translateBatch, fetchUser, loginWithGoogle, login, signup } from './api'
import type { Message } from '../types'

const cache = new SessionCache()

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch(err => sendResponse({ error: String(err) }))
  return true
})

async function handle(msg: Message): Promise<unknown> {
  if (msg.type === 'TRANSLATE') {
    const token = await getToken()
    if (!token) {
      console.warn('[osmosis:bg] TRANSLATE rejected: not logged in')
      return { error: 'NOT_LOGGED_IN' }
    }

    const result: Record<string, string> = {}
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
    return token ? await fetchUser(token) : null
  }

  if (msg.type === 'EMAIL_LOGIN' || msg.type === 'EMAIL_SIGNUP') {
    try {
      const token = msg.type === 'EMAIL_LOGIN'
        ? await login(msg.email, msg.password)
        : await signup(msg.email, msg.password)
      await setToken(token)
      cache.clear()
      return { token }
    } catch (err) {
      return { error: String(err).replace('Error: ', '') }
    }
  }

  if (msg.type === 'GOOGLE_LOGIN') {
    await chrome.storage.local.remove('osmosis_auth_error')
    try {
      const token = await loginWithGoogle()
      await setToken(token)
      cache.clear()
      return { token }
    } catch (err) {
      const errMsg = String(err).replace('Error: ', '')
      await chrome.storage.local.set({ osmosis_auth_error: errMsg })
      return { error: errMsg }
    }
  }

  if (msg.type === 'LOGOUT') {
    console.log('[osmosis:bg] LOGOUT message received, clearing session')
    await clearToken()
    cache.clear()
    return { ok: true }
  }

  return { error: 'UNKNOWN_MESSAGE' }
}
