import { SessionCache } from './cache'
import { API_BASE_URL } from '../constants'
import { getToken, setToken, clearToken, getRefreshToken, setRefreshToken } from './auth'
import { getUserProfileCache, setUserProfileCache } from './userProfileCache'
import { translateBatch, pronounceText, fetchUser, loginWithGoogle, loginWithEmail, requestEmailSignup, fetchPopularTranslations, requestPasswordReset, deleteAccount, fetchBillingUrl, srsRateWord, srsGetDue, srsGetStats, srsReportEncounters, refreshAuthToken, reportBadTranslation, reportProperNoun } from './api'
import { updateStreakLog, getStreakInfo } from './streak'
import { addEncounteredWords, getSessionWords, getSessionCount, clearSession, markSessionActive, removeWordFromSession, REVIEW_THRESHOLD } from './reviewSession'
import { getWordContexts } from '../utils/contextStore'
import { addSuppressedWord, getSuppressedWords } from '../utils/suppressedWords'
import { addMasteredWord, removeMasteredWord } from '../utils/masteredWords'
import type { Message, TranslationEntry, SrsDueCard } from '../types'
import { log, warn } from '../logger'

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
    log(`[osmosis:bg] pre-warmed ${popular.size} translations for "${lang}"`)
  } catch (err) {
    warn('[osmosis:bg] pre-warm failed', err)
  }
}

async function afterLogin(token: string, refreshToken?: string): Promise<{ token: string }> {
  await setToken(token)
  if (refreshToken) await setRefreshToken(refreshToken)
  cache.clear()
  lastPrewarmedLang = null
  const user = await fetchUser(token)
  if (user) await setUserProfileCache(user)
  const r = await chrome.storage.sync.get('osmosis_settings')
  const lang = (r.osmosis_settings as { targetLang?: string } | undefined)?.targetLang
  if (lang) void preWarmCache(lang, token)
  return { token }
}

async function tryRefreshAndRetry<T>(retryFn: (token: string) => Promise<T>): Promise<T | { error: string }> {
  const storedRefresh = await getRefreshToken()
  if (!storedRefresh) {
    await clearToken()
    return { error: 'AUTH_EXPIRED' }
  }
  try {
    const { token: newToken, refreshToken: newRefresh } = await refreshAuthToken(storedRefresh)
    await setToken(newToken)
    await setRefreshToken(newRefresh)
    return retryFn(newToken)
  } catch {
    await clearToken()
    return { error: 'AUTH_EXPIRED' }
  }
}

async function refreshUserProfileInBackground(token: string): Promise<void> {
  try {
    const user = await fetchUser(token)
    if (user) {
      await setUserProfileCache(user)
      log('[osmosis:bg] user profile refresh OK')
    } else {
      await clearToken()
      warn('[osmosis:bg] user profile refresh: session invalid, cleared token')
    }
  } catch (err) {
    warn('[osmosis:bg] user profile refresh failed', err)
  }
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function verbFormBucket(word: string): 'ing' | 'ed' | 's' | 'base' {
  const w = word.toLowerCase()
  if (w.endsWith('ing') && w.length > 4) return 'ing'
  if (w.endsWith('ed')  && w.length > 3) return 'ed'
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return 's'
  return 'base'
}

// ── Message handlers ───────────────────────────────────────────────────────────

async function handleTranslate(msg: Extract<Message, { type: 'TRANSLATE' }>): Promise<unknown> {
  await cache.ensureReady()
  const token = await getToken()
  if (!token) {
    warn('[osmosis:bg] TRANSLATE rejected: not logged in')
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

  log('[osmosis:bg] TRANSLATE', { total: msg.words.length, uncached: uncached.length, lang: msg.targetLang })

  if (uncached.length === 0) return { translations: result }

  const uncachedContextsByWord: Record<string, string> = {}
  for (const word of uncached) {
    const ctx = msg.contextsByWord?.[word]
    if (typeof ctx === 'string' && ctx.length > 0) uncachedContextsByWord[word] = ctx
  }
  const contextWordCount = Object.keys(uncachedContextsByWord).length
  log('[osmosis:bg] TRANSLATE context attached', {
    uncachedWithContext: contextWordCount,
    uncachedTotal: uncached.length,
    coveragePct: Number(((contextWordCount / uncached.length) * 100).toFixed(1)),
  })

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
      return tryRefreshAndRetry(newToken =>
        translateBatch(uncached, msg.targetLang, newToken, uncachedContextsByWord).then(fresh => {
          fresh.forEach((val, key) => {
            result[key] = val
            cache.set(key, msg.targetLang, val)
          })
          return { translations: result }
        })
      )
    }
    warn('[osmosis:bg] TRANSLATE API error', s)
    if (Object.keys(result).length > 0) return { translations: result }
    return { error: 'API_ERROR' }
  }
}

async function handlePronounce(msg: Extract<Message, { type: 'PRONOUNCE' }>): Promise<unknown> {
  const token = await getToken()
  if (!token) return { error: 'NOT_LOGGED_IN' }
  try {
    const text = msg.text.trim().slice(0, 120)
    if (!text) return { error: 'INVALID_TEXT' }
    log('[osmosis:bg] PRONOUNCE', { text, targetLang: msg.targetLang })
    return await pronounceText(text, msg.targetLang, token)
  } catch (err) {
    const s = String(err)
    if (s.includes('LIMIT_REACHED')) return { error: 'LIMIT_REACHED' }
    if (s.includes('AUTH_EXPIRED')) {
      const retryText = msg.text.trim().slice(0, 120)
      return tryRefreshAndRetry(newToken => pronounceText(retryText, msg.targetLang, newToken))
    }
    warn('[osmosis:bg] PRONOUNCE API error', s)
    return { error: 'API_ERROR' }
  }
}

async function handleGetUser(): Promise<unknown> {
  const token = await getToken()
  if (!token) {
    log('[osmosis:bg] GET_USER: no token')
    return null
  }
  const cached = await getUserProfileCache()
  const cacheAge = cached ? Date.now() - cached.fetchedAt : null
  const cacheFresh = cached && cacheAge !== null && cacheAge < PROFILE_CACHE_TTL_MS
  if (cacheFresh && cached.profile) {
    log('[osmosis:bg] GET_USER: using cached profile', { cacheAge_ms: cacheAge })
    void refreshUserProfileInBackground(token)
    return cached.profile
  }
  log('[osmosis:bg] GET_USER: fetching /user/me')
  try {
    const user = await fetchUser(token)
    if (user) {
      await setUserProfileCache(user)
      return user
    }
    await clearToken()
    return null
  } catch (err) {
    warn('[osmosis:bg] GET_USER: fetch error', err)
    if (cached?.profile) {
      log('[osmosis:bg] GET_USER: returning stale cache after fetch failure')
      return cached.profile
    }
    return null
  }
}

async function handleGoogleLogin(): Promise<unknown> {
  try {
    const { token, refreshToken } = await loginWithGoogle()
    log('[osmosis:bg] GOOGLE_LOGIN: success')
    const result = await afterLogin(token, refreshToken)
    void chrome.action.openPopup().catch(() => {})
    return result
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    warn('[osmosis:bg] GOOGLE_LOGIN failed', errMsg)
    return { error: errMsg }
  }
}

async function handleEmailLogin(msg: Extract<Message, { type: 'EMAIL_LOGIN' }>): Promise<unknown> {
  try {
    const { token, refreshToken } = await loginWithEmail(msg.email, msg.password)
    log('[osmosis:bg] EMAIL_LOGIN: success')
    return afterLogin(token, refreshToken)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    warn('[osmosis:bg] EMAIL_LOGIN failed', errMsg)
    return { error: errMsg }
  }
}

async function handleEmailSignup(msg: Extract<Message, { type: 'EMAIL_SIGNUP' }>): Promise<unknown> {
  try {
    await requestEmailSignup(msg.email, msg.password, msg.passwordConfirm)
    log('[osmosis:bg] EMAIL_SIGNUP: verification email requested')
    return { ok: true }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    warn('[osmosis:bg] EMAIL_SIGNUP failed', errMsg)
    return { error: errMsg }
  }
}

async function handleSessionFromVerify(msg: Extract<Message, { type: 'SESSION_FROM_VERIFY' }>): Promise<unknown> {
  try {
    log('[osmosis:bg] SESSION_FROM_VERIFY: applying session')
    const result = await afterLogin(msg.token, msg.refreshToken)
    const stored = await chrome.storage.sync.get('osmosis_settings')
    const current = (stored['osmosis_settings'] ?? {}) as Record<string, unknown>
    await Promise.all([
      chrome.storage.sync.set({ osmosis_settings: { ...current, enabled: false } }),
      chrome.storage.local.remove('osmosis_onboarded'),
    ])
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
    const target = windows.find(w => w.focused) ?? windows[0]
    if (target?.id != null) {
      void chrome.action.openPopup({ windowId: target.id }).catch(() => {})
    }
    return result
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    warn('[osmosis:bg] SESSION_FROM_VERIFY failed', errMsg)
    return { error: errMsg }
  }
}

async function handleForgotPassword(msg: Extract<Message, { type: 'FORGOT_PASSWORD' }>): Promise<unknown> {
  try {
    await requestPasswordReset(msg.email)
    return { ok: true }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    warn('[osmosis:bg] FORGOT_PASSWORD failed', errMsg)
    return { error: errMsg }
  }
}

async function handleDeleteAccount(): Promise<unknown> {
  try {
    const token = await getToken()
    if (!token) return { error: 'Not signed in' }
    await deleteAccount(token)
    await clearToken()
    log('[osmosis:bg] DELETE_ACCOUNT: account deleted')
    return { ok: true }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    warn('[osmosis:bg] DELETE_ACCOUNT failed', errMsg)
    return { error: errMsg }
  }
}

async function handleGetBillingUrl(path: '/user/checkout' | '/user/portal'): Promise<unknown> {
  const token = await getToken()
  if (!token) return { error: 'NOT_LOGGED_IN' }
  try {
    const url = await fetchBillingUrl(path, token)
    return { url }
  } catch (err) {
    const s = String(err)
    if (s.includes('AUTH_EXPIRED')) {
      return tryRefreshAndRetry(newToken =>
        fetchBillingUrl(path, newToken).then(url => ({ url }))
      )
    }
    return { error: err instanceof Error ? err.message : 'Something went wrong. Try again.' }
  }
}

async function handleSignOut(): Promise<unknown> {
  await clearToken()
  cache.clear()
  lastPrewarmedLang = null
  log('[osmosis:bg] SIGN_OUT: session cleared')
  return { ok: true }
}

async function handleSrsRate(msg: Extract<Message, { type: 'SRS_RATE' }>): Promise<unknown> {
  const token = await getToken()
  if (!token) return { error: 'NOT_LOGGED_IN' }
  try {
    const result = await srsRateWord(msg.word, msg.targetLang, msg.rating, token)
    if (result.state === 'review' && result.intervalDays >= 7) {
      void addMasteredWord(msg.word, msg.targetLang)
        .catch(err => warn('[osmosis:bg] addMasteredWord failed', err))
    } else if (result.state === 'relearning') {
      void removeMasteredWord(msg.word, msg.targetLang)
        .catch(err => warn('[osmosis:bg] removeMasteredWord failed', err))
    }
    if (msg.rating === 4) {
      void updateStreakLog(1)
        .catch(err => warn('[osmosis:bg] streak update failed', err))
    }
    return result
  } catch (err) {
    const s = String(err)
    if (s.includes('AUTH_EXPIRED')) {
      return tryRefreshAndRetry(newToken => srsRateWord(msg.word, msg.targetLang, msg.rating, newToken))
    }
    warn('[osmosis:bg] SRS_RATE error', s)
    return { error: 'API_ERROR' }
  }
}

async function handleSrsGetDue(msg: Extract<Message, { type: 'SRS_GET_DUE' }>): Promise<unknown> {
  const token = await getToken()
  if (!token) return { error: 'NOT_LOGGED_IN' }
  try {
    return await srsGetDue(msg.targetLang, token, msg.limit)
  } catch (err) {
    const s = String(err)
    if (s.includes('AUTH_EXPIRED')) {
      return tryRefreshAndRetry(newToken => srsGetDue(msg.targetLang, newToken, msg.limit))
    }
    warn('[osmosis:bg] SRS_GET_DUE error', s)
    return { error: 'API_ERROR' }
  }
}

async function handleSrsGetStats(msg: Extract<Message, { type: 'SRS_GET_STATS' }>): Promise<unknown> {
  const token = await getToken()
  if (!token) return { error: 'NOT_LOGGED_IN' }
  try {
    const [stats, sessionCount] = await Promise.all([
      srsGetStats(msg.targetLang, token),
      getSessionCount(msg.targetLang),
    ])
    return {
      ...stats,
      sessionCount,
      reviewReady: sessionCount >= REVIEW_THRESHOLD || stats.dueCount > 0,
    }
  } catch (err) {
    const s = String(err)
    if (s.includes('AUTH_EXPIRED')) {
      return tryRefreshAndRetry(newToken => srsGetStats(msg.targetLang, newToken))
    }
    warn('[osmosis:bg] SRS_GET_STATS error', s)
    return { error: 'API_ERROR' }
  }
}

async function handleSrsGetReviewSession(msg: Extract<Message, { type: 'SRS_GET_REVIEW_SESSION' }>): Promise<unknown> {
  const token = await getToken()
  if (!token) return { error: 'NOT_LOGGED_IN' }
  try {
    const limit = msg.limit ?? REVIEW_THRESHOLD
    const [dueResult, sessionWords, suppressed] = await Promise.all([
      srsGetDue(msg.targetLang, token, limit),
      getSessionWords(msg.targetLang),
      getSuppressedWords(msg.targetLang),
    ])
    const dueCards: SrsDueCard[] = dueResult.cards ?? []
    const dueWordSet = new Set(dueCards.map(c => c.word.toLowerCase()))

    const sessionCards: SrsDueCard[] = []
    for (const word of sessionWords) {
      if (dueWordSet.has(word) || suppressed.has(word.toLowerCase())) continue
      const entry = cache.get(word, msg.targetLang)
      if (!entry) continue
      sessionCards.push({
        word,
        targetLang: msg.targetLang,
        translation: entry.t,
        posTag: entry.p,
        alternatives: entry.a ? [...entry.a] : undefined,
        lemma: entry.n,
        state: 'review',
        stability: 0,
        difficulty: 5,
        lapses: 0,
        reps: 0,
        dueAt: Date.now(),
      })
    }

    const combined: SrsDueCard[] = []
    const max = Math.max(dueCards.length, sessionCards.length)
    for (let i = 0; i < max && combined.length < limit; i++) {
      if (i < dueCards.length) combined.push(dueCards[i]!)
      if (i < sessionCards.length && combined.length < limit) combined.push(sessionCards[i]!)
    }

    const allWords = combined.map(c => c.word)
    const contexts = await getWordContexts(allWords, msg.targetLang)

    const enriched = combined.map(card => {
      const ctx = contexts.get(card.word.toLowerCase())
      if (!ctx) return card

      const others = combined.filter(c => c.word.toLowerCase() !== card.word.toLowerCase())
      if (others.length < 3) return card

      const correctLemma = card.lemma ?? null
      const correctIsBase = correctLemma !== null
        ? card.word.toLowerCase() === correctLemma.toLowerCase()
        : null
      const correctBucket = card.posTag === 'VERB' ? verbFormBucket(card.word) : null

      const sameForm = (c: typeof card): boolean => {
        if (c.posTag !== card.posTag) return false
        if (correctLemma !== null && c.lemma !== undefined) {
          const cIsBase = c.word.toLowerCase() === c.lemma.toLowerCase()
          return cIsBase === correctIsBase
        }
        return correctBucket !== null && verbFormBucket(c.word) === correctBucket
      }

      const tier1 = others.filter(sameForm)
      const tier2 = others.filter(c => c.posTag === card.posTag && !tier1.includes(c))
      const tier3 = others.filter(c => !tier1.includes(c) && !tier2.includes(c))
      const distractors = [...fisherYates(tier1), ...fisherYates(tier2), ...fisherYates(tier3)]
        .slice(0, 3)
        .map(c => c.word)

      const choices = fisherYates([card.word, ...distractors])
      return { ...card, context: ctx, choices }
    })

    if (enriched.length > 0) {
      void markSessionActive(msg.targetLang).catch(() => {})
    }

    return { cards: enriched }
  } catch (err) {
    const s = String(err)
    if (s.includes('AUTH_EXPIRED')) {
      return tryRefreshAndRetry(newToken => srsGetDue(msg.targetLang, newToken, msg.limit ?? REVIEW_THRESHOLD))
    }
    warn('[osmosis:bg] SRS_GET_REVIEW_SESSION error', s)
    return { error: 'API_ERROR' }
  }
}

async function handleSrsSessionComplete(msg: Extract<Message, { type: 'SRS_SESSION_COMPLETE' }>): Promise<unknown> {
  void clearSession(msg.targetLang)
    .catch(err => warn('[osmosis:bg] clear session failed', err))
  return { ok: true }
}

async function handleSrsReportEncounters(msg: Extract<Message, { type: 'SRS_REPORT_ENCOUNTERS' }>): Promise<unknown> {
  const token = await getToken()
  if (token) {
    void srsReportEncounters(msg.words, msg.targetLang, token)
      .catch(err => warn('[osmosis:bg] SRS_REPORT_ENCOUNTERS failed', err))
  }
  void addEncounteredWords(msg.words, msg.targetLang)
    .catch(err => warn('[osmosis:bg] session words update failed', err))
  return { ok: true }
}

async function handleReportProperNoun(msg: Extract<Message, { type: 'REPORT_PROPER_NOUN' }>): Promise<unknown> {
  const token = await getToken()
  if (!token) return { verified: false }
  try {
    const result = await reportProperNoun(msg.word, msg.targetLang, token)
    if (result.verified) {
      cache.remove(msg.word, msg.targetLang)
      void addSuppressedWord(msg.word, msg.targetLang)
        .catch(err => warn('[osmosis:bg] suppress word failed', err))
      void removeWordFromSession(msg.word, msg.targetLang)
        .catch(err => warn('[osmosis:bg] remove session word failed', err))
    }
    return result
  } catch (err) {
    const s = String(err)
    if (s.includes('AUTH_EXPIRED')) {
      return tryRefreshAndRetry(async newToken => {
        const result = await reportProperNoun(msg.word, msg.targetLang, newToken)
        if (result.verified) {
          cache.remove(msg.word, msg.targetLang)
          void addSuppressedWord(msg.word, msg.targetLang).catch(() => {})
          void removeWordFromSession(msg.word, msg.targetLang).catch(() => {})
        }
        return result
      })
    }
    warn('[osmosis:bg] REPORT_PROPER_NOUN error', s)
    return { verified: false }
  }
}

async function handleReportBadTranslation(msg: Extract<Message, { type: 'REPORT_BAD_TRANSLATION' }>): Promise<unknown> {
  const token = await getToken()
  if (token) {
    void reportBadTranslation(msg.word, msg.targetLang, msg.translation, msg.reason, token, msg.removeFromSrs ?? false)
      .catch(err => warn('[osmosis:bg] REPORT_BAD_TRANSLATION failed', err))
  }
  return { ok: true }
}

async function handleSrsGetStreak(): Promise<unknown> {
  try {
    return await getStreakInfo()
  } catch (err) {
    warn('[osmosis:bg] SRS_GET_STREAK error', err)
    return { error: 'API_ERROR' }
  }
}

// ── Dispatch ───────────────────────────────────────────────────────────────────

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'TRANSLATE':              return handleTranslate(msg)
    case 'PRONOUNCE':              return handlePronounce(msg)
    case 'GET_USER':               return handleGetUser()
    case 'GOOGLE_LOGIN':           return handleGoogleLogin()
    case 'EMAIL_LOGIN':            return handleEmailLogin(msg)
    case 'EMAIL_SIGNUP':           return handleEmailSignup(msg)
    case 'SESSION_FROM_VERIFY':    return handleSessionFromVerify(msg)
    case 'FORGOT_PASSWORD':        return handleForgotPassword(msg)
    case 'DELETE_ACCOUNT':         return handleDeleteAccount()
    case 'GET_CHECKOUT_URL':       return handleGetBillingUrl('/user/checkout')
    case 'GET_PORTAL_URL':         return handleGetBillingUrl('/user/portal')
    case 'SIGN_OUT':               return handleSignOut()
    case 'SRS_RATE':               return handleSrsRate(msg)
    case 'SRS_GET_DUE':            return handleSrsGetDue(msg)
    case 'SRS_GET_STATS':          return handleSrsGetStats(msg)
    case 'SRS_GET_REVIEW_SESSION': return handleSrsGetReviewSession(msg)
    case 'SRS_SESSION_COMPLETE':   return handleSrsSessionComplete(msg)
    case 'SRS_REPORT_ENCOUNTERS':  return handleSrsReportEncounters(msg)
    case 'REPORT_PROPER_NOUN':     return handleReportProperNoun(msg)
    case 'REPORT_BAD_TRANSLATION': return handleReportBadTranslation(msg)
    case 'SRS_GET_STREAK':         return handleSrsGetStreak()
    // SETTINGS_CHANGED is handled by content/index.ts, not the background worker
    default: return { error: 'UNKNOWN_MESSAGE' }
  }
}

// ── Listeners ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('HANDLER_TIMEOUT')), 15_000)
  )
  Promise.race([handle(message), timeout])
    .then(sendResponse)
    .catch(err => sendResponse({ error: String(err) }))
  return true
})

// Messages from externally_connectable web pages (e.g. the email verification page)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== new URL(API_BASE_URL).origin) {
    sendResponse({ error: 'UNAUTHORIZED_ORIGIN' })
    return false
  }
  if (message?.type !== 'SESSION_FROM_VERIFY') {
    sendResponse({ error: 'UNKNOWN_MESSAGE' })
    return false
  }
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('HANDLER_TIMEOUT')), 15_000)
  )
  Promise.race([handle(message as Message), timeout])
    .then(sendResponse)
    .catch(err => sendResponse({ error: String(err) }))
  return true
})
