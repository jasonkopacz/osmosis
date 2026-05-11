import { STORAGE_KEYS, REVIEW_THRESHOLD } from '../constants'

export { REVIEW_THRESHOLD }

interface SessionStore { words: string[] }

function pendingKey(lang: string): string {
  return `${STORAGE_KEYS.SESSION_WORDS}::${lang}`
}

function activeKey(lang: string): string {
  return `${STORAGE_KEYS.SESSION_WORDS}_active::${lang}`
}

// ── Pending word accumulation ─────────────────────────────────────────────────
// Words accumulate here while no review session is in progress.
// Once a session starts, new encounters are held back until it completes.

export async function addEncounteredWords(words: string[], lang: string): Promise<void> {
  if (await isSessionActive(lang)) return  // hold new words until current session completes
  const k = pendingKey(lang)
  const r = await chrome.storage.local.get(k)
  const existing = (r[k] ?? { words: [] }) as SessionStore
  const wordSet = new Set(existing.words)
  for (const w of words) wordSet.add(w.toLowerCase())
  await chrome.storage.local.set({ [k]: { words: Array.from(wordSet) } })
}

export async function getSessionWords(lang: string): Promise<string[]> {
  const r = await chrome.storage.local.get(pendingKey(lang))
  return ((r[pendingKey(lang)] ?? { words: [] }) as SessionStore).words
}

export async function getSessionCount(lang: string): Promise<number> {
  return (await getSessionWords(lang)).length
}

// ── Active session flag ───────────────────────────────────────────────────────
// Set when a review session starts so new encounters are held back.
// Cleared when the session completes, at which point the pending pool resets.

export async function markSessionActive(lang: string): Promise<void> {
  await chrome.storage.local.set({ [activeKey(lang)]: true })
}

export async function isSessionActive(lang: string): Promise<boolean> {
  const r = await chrome.storage.local.get(activeKey(lang))
  return r[activeKey(lang)] === true
}

// Clears both the pending word pool and the active flag.
// Call this when a review session is fully completed.
export async function clearSession(lang: string): Promise<void> {
  await chrome.storage.local.remove([pendingKey(lang), activeKey(lang)])
}
