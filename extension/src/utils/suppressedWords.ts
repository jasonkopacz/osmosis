const KEY_PREFIX = 'osmosis_suppressed'

function storageKey(lang: string): string {
  return `${KEY_PREFIX}::${lang.toLowerCase()}`
}

export async function getSuppressedWords(lang: string): Promise<Set<string>> {
  const k = storageKey(lang)
  const r = await chrome.storage.local.get(k)
  const obj = r[k] as Record<string, true> | undefined
  return obj ? new Set(Object.keys(obj)) : new Set()
}

export async function addSuppressedWord(word: string, lang: string): Promise<void> {
  const k = storageKey(lang)
  const r = await chrome.storage.local.get(k)
  const obj = (r[k] as Record<string, true> | undefined) ?? {}
  await chrome.storage.local.set({ [k]: { ...obj, [word.toLowerCase()]: true } })
}
