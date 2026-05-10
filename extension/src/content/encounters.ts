import type { EncounterEntry } from '../types'

const MAX_ENCOUNTER_ENTRIES = 2000

export function encounterKey(lang: string): string {
  return `srs_encounters_${lang}`
}

export async function recordLocalEncounters(words: string[], lang: string): Promise<void> {
  const key = encounterKey(lang)
  const stored = await chrome.storage.local.get(key)
  const log = (stored[key] ?? {}) as Record<string, EncounterEntry>
  const now = Date.now()

  for (const word of words) {
    const w = word.toLowerCase()
    const existing = log[w]
    if (existing) {
      log[w] = { ...existing, count: existing.count + 1, lastSeen: now }
    } else {
      log[w] = { count: 1, firstSeen: now, lastSeen: now }
    }
  }

  const entries = Object.entries(log)
  if (entries.length > MAX_ENCOUNTER_ENTRIES) {
    entries.sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    const trimmed = Object.fromEntries(entries.slice(0, MAX_ENCOUNTER_ENTRIES))
    await chrome.storage.local.set({ [key]: trimmed })
  } else {
    await chrome.storage.local.set({ [key]: log })
  }
}
