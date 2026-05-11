import { STORAGE_KEYS } from '../constants'

export const REVIEW_THRESHOLD = 25

interface SessionStore { words: string[] }

function key(lang: string): string {
  return `${STORAGE_KEYS.SESSION_WORDS}::${lang}`
}

export async function addEncounteredWords(words: string[], lang: string): Promise<void> {
  const k = key(lang)
  const r = await chrome.storage.local.get(k)
  const existing = (r[k] ?? { words: [] }) as SessionStore
  const wordSet = new Set(existing.words)
  for (const w of words) wordSet.add(w.toLowerCase())
  await chrome.storage.local.set({ [k]: { words: Array.from(wordSet) } })
}

export async function getSessionWords(lang: string): Promise<string[]> {
  const k = key(lang)
  const r = await chrome.storage.local.get(k)
  return ((r[k] ?? { words: [] }) as SessionStore).words
}

export async function getSessionCount(lang: string): Promise<number> {
  return (await getSessionWords(lang)).length
}

export async function clearSession(lang: string): Promise<void> {
  await chrome.storage.local.remove(key(lang))
}
