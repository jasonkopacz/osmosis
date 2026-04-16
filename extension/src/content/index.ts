import { collectWords } from './walker'
import { isEligible } from './filter'
import { sampleWords } from './scorer'
import { applyReplacements, clearReplacements, injectTooltipStyles } from './replacer'
import type { UserSettings, Message } from '../types'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants'
import { normalizeTargetLang } from '../languages'

let settings: UserSettings = DEFAULT_SETTINGS

async function loadSettings(): Promise<UserSettings> {
  const r = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS)
  const raw = r[STORAGE_KEYS.SETTINGS] as Partial<UserSettings> | undefined
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...raw }
  return { ...merged, targetLang: normalizeTargetLang(merged.targetLang) }
}

async function runPipeline(): Promise<void> {
  if (!settings.enabled) {
    console.log('[osmosis:content] disabled, skipping')
    clearReplacements()
    return
  }
  clearReplacements()
  injectTooltipStyles()

  const allEntries = collectWords(document.body)
  const eligibleEntries = allEntries.filter(({ word, offset, node }) => isEligible(word, node.textContent?.[offset - 1] ?? ''))
  if (eligibleEntries.length === 0) {
    console.log('[osmosis:content] no eligible words')
    return
  }

  const eligibleWords = eligibleEntries.map(e => e.word)
  const unique = [...new Set(sampleWords(eligibleWords, settings.percentage, location.href))]
  console.log('[osmosis:content] pipeline', {
    eligible: eligibleEntries.length,
    sampled: unique.length,
    lang: settings.targetLang,
  })

  const res = (await chrome.runtime.sendMessage({
    type: 'TRANSLATE',
    words: unique,
    targetLang: settings.targetLang,
  } as Message)) as { translations?: Record<string, string>; error?: string } | undefined

  if (!res) return // service worker inactive

  if (res.error === 'LIMIT_REACHED') {
    await chrome.storage.local.set({ osmosis_limit_reached: true })
    console.warn('[osmosis:content] monthly limit reached')
    return
  }
  if (res.error === 'NOT_LOGGED_IN') {
    return
  }
  if (res.error || !res.translations) {
    if (res.error) console.warn('[osmosis:content] translate error', res.error)
    return
  }
  applyReplacements(new Map(Object.entries(res.translations)), eligibleEntries)
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'SETTINGS_CHANGED') {
    settings = msg.settings
    void runPipeline()
  }
})

async function init(): Promise<void> {
  console.log('[osmosis:content] init')
  settings = await loadSettings()
  console.log('[osmosis:content] settings loaded', settings)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void runPipeline()
    })
  } else {
    await runPipeline()
  }
}

void init()
