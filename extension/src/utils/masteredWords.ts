const KEY_PREFIX = 'osmosis_mastered'

function storageKey(lang: string): string {
  return `${KEY_PREFIX}::${lang.toLowerCase()}`
}

export async function getMasteredWords(lang: string): Promise<Set<string>> {
  const k = storageKey(lang)
  const r = await chrome.storage.local.get(k)
  const obj = r[k] as Record<string, true> | undefined
  return obj ? new Set(Object.keys(obj)) : new Set()
}

export async function addMasteredWord(word: string, lang: string): Promise<void> {
  const k = storageKey(lang)
  const r = await chrome.storage.local.get(k)
  const obj = (r[k] as Record<string, true> | undefined) ?? {}
  await chrome.storage.local.set({ [k]: { ...obj, [word.toLowerCase()]: true } })
}

export async function removeMasteredWord(word: string, lang: string): Promise<void> {
  const k = storageKey(lang)
  const r = await chrome.storage.local.get(k)
  const obj = (r[k] as Record<string, true> | undefined) ?? {}
  const updated = { ...obj }
  delete updated[word.toLowerCase()]
  await chrome.storage.local.set({ [k]: updated })
}
