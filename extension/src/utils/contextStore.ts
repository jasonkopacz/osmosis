const KEY_PREFIX = 'osmosis_ctx'

function storageKey(word: string, lang: string): string {
  return `${KEY_PREFIX}::${word.toLowerCase()}::${lang}`
}

function isGoodSentence(sentence: string, word: string): boolean {
  const s = sentence.trim()
  return s.length >= 40 && s.length <= 200 && s.toLowerCase().includes(word.toLowerCase())
}

export async function saveWordContext(word: string, lang: string, sentence: string): Promise<void> {
  if (!isGoodSentence(sentence, word)) return
  const k = storageKey(word, lang)
  const r = await chrome.storage.local.get(k)
  if (r[k]) return  // keep the first good sentence, don't overwrite
  await chrome.storage.local.set({ [k]: sentence.trim() })
}

export async function clearAllWordContexts(): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const keys = Object.keys(all).filter(k => k.startsWith(KEY_PREFIX + '::'))
  if (keys.length > 0) await chrome.storage.local.remove(keys)
}

export async function getWordContexts(words: string[], lang: string): Promise<Map<string, string>> {
  if (words.length === 0) return new Map()
  const keys = words.map(w => storageKey(w, lang))
  const r = await chrome.storage.local.get(keys)
  const result = new Map<string, string>()
  for (const word of words) {
    const val = r[storageKey(word, lang)] as string | undefined
    if (val) result.set(word.toLowerCase(), val)
  }
  return result
}
