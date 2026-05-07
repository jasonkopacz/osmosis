import { collectWords } from './walker'
import { isEligible } from './filter'
import { sampleWords } from './scorer'
import { applyReplacements, clearReplacements, injectTooltipStyles } from './replacer'
import type { UserSettings, Message } from '../types'
import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  MIN_TRANSLATION_PERCENTAGE,
  MAX_TRANSLATION_PERCENTAGE,
} from '../constants'
import { normalizeTargetLang } from '../languages'

let settings: UserSettings = DEFAULT_SETTINGS
let domObserver: MutationObserver | null = null
let mutationTimer: ReturnType<typeof setTimeout> | null = null
let lastMutationRun = 0
const MUTATION_COOLDOWN_MS = 5_000
const MUTATION_TEXT_THRESHOLD = 30 // ignore trivial DOM changes (ads, badges, analytics)
const LOG_CONTEXT_PREVIEW = true
const CONTEXT_PREVIEW_LIMIT = 5

function sentenceAroundOffset(text: string, offset: number): string | null {
  const normalizedOffset = Math.max(0, Math.min(offset, Math.max(0, text.length - 1)))
  const boundaryPattern = /[.!?\n]/g
  let start = 0
  let end = text.length
  let match: RegExpExecArray | null

  while ((match = boundaryPattern.exec(text)) !== null) {
    const idx = match.index
    if (idx < normalizedOffset) {
      start = idx + 1
      continue
    }
    end = idx + 1
    break
  }

  const sentence = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return sentence.length > 0 ? sentence : null
}

async function loadSettings(): Promise<UserSettings> {
  const r = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS)
  const raw = r[STORAGE_KEYS.SETTINGS] as Partial<UserSettings> | undefined
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...raw }
  const clampedPercentage = Math.max(
    MIN_TRANSLATION_PERCENTAGE,
    Math.min(MAX_TRANSLATION_PERCENTAGE, merged.percentage)
  )
  if (clampedPercentage !== merged.percentage) {
    console.log('[osmosis:content] clamped percentage setting', {
      from: merged.percentage,
      to: clampedPercentage,
    })
  }
  return {
    ...merged,
    percentage: clampedPercentage,
    targetLang: normalizeTargetLang(merged.targetLang),
  }
}

function hasMeaningfulNewText(mutations: MutationRecord[]): boolean {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      const text = node.textContent?.trim() ?? ''
      if (text.length >= MUTATION_TEXT_THRESHOLD) return true
    }
  }
  return false
}

function scheduleFromMutation(mutations: MutationRecord[]): void {
  if (!hasMeaningfulNewText(mutations)) return
  if (mutationTimer !== null) clearTimeout(mutationTimer)
  mutationTimer = setTimeout(() => {
    mutationTimer = null
    const now = Date.now()
    if (now - lastMutationRun < MUTATION_COOLDOWN_MS) return
    lastMutationRun = now
    void runPipeline()
  }, 800)
}

function pauseObserver(): void {
  domObserver?.disconnect()
  if (mutationTimer !== null) { clearTimeout(mutationTimer); mutationTimer = null }
}

function resumeObserver(): void {
  if (settings.enabled && domObserver) {
    domObserver.observe(document.body, { childList: true, subtree: true })
  }
}

async function runPipeline(): Promise<void> {
  pauseObserver() // stop watching during our own DOM mutations
  try {
    if (!settings.enabled) {
      console.log('[osmosis:content] disabled, skipping')
      clearReplacements()
      return
    }
    clearReplacements()
    injectTooltipStyles()

    const allEntries = collectWords(document.body)
    const eligibleEntries = allEntries.filter(({ word, offset, node }) => isEligible(word, node.textContent?.slice(0, offset) ?? ''))
    if (eligibleEntries.length === 0) {
      console.log('[osmosis:content] no eligible words')
      return
    }

    // Deduplicate before sampling so percentage applies to unique words, not occurrences.
    // Without this, a long article (e.g. 3000 occurrences, 20% → 600) always hits MAX_WORDS
    // at any percentage, making the slider appear stuck.
    const uniqueEligible = [...new Set(eligibleEntries.map(e => e.word))]
    const unique = sampleWords(uniqueEligible, settings.percentage, location.href)
    const sampledSet = new Set(unique)
    const contextsByWord: Record<string, string> = {}
    const wordsBySentence = new Map<string, Set<string>>()
    const wordsWithoutContext = new Set<string>()
    for (const { word, node, offset } of eligibleEntries) {
      if (!sampledSet.has(word)) continue
      if (contextsByWord[word]) continue
      const sentence = sentenceAroundOffset(node.textContent ?? '', offset)
      if (!sentence) {
        wordsWithoutContext.add(word)
        continue
      }
      contextsByWord[word] = sentence
      if (!wordsBySentence.has(sentence)) wordsBySentence.set(sentence, new Set())
      wordsBySentence.get(sentence)!.add(word)
    }
    if (LOG_CONTEXT_PREVIEW) {
      const contextEntries = Object.entries(contextsByWord)
      const preview = contextEntries
        .slice(0, CONTEXT_PREVIEW_LIMIT)
        .map(([word, context]) => ({ word, context }))
      const sentenceGroups = Array.from(wordsBySentence.entries()).map(([sentence, words]) => ({
        sentence,
        words: Array.from(words.values()),
      }))
      console.log('[osmosis:content] context extraction details', {
        sampledWords: unique.length,
        wordsWithContext: contextEntries.length,
        wordsWithoutContext: wordsWithoutContext.size,
        contextCoveragePct: unique.length > 0 ? Number(((contextEntries.length / unique.length) * 100).toFixed(1)) : 0,
        uniqueSentenceCount: wordsBySentence.size,
        contextsByWord,
        sentenceGroups,
        wordsMissingContext: Array.from(wordsWithoutContext.values()),
        preview,
      })
    }
    void chrome.storage.local.set({
      [STORAGE_KEYS.PAGE_STATS]: { sampled: unique.length, eligible: uniqueEligible.length, lang: settings.targetLang },
    })
    console.log('[osmosis:content] pipeline', {
      eligible: eligibleEntries.length,
      uniqueEligible: uniqueEligible.length,
      sampled: unique.length,
      contextWords: Object.keys(contextsByWord).length,
      contextSentences: wordsBySentence.size,
      lang: settings.targetLang,
    })

    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      words: unique,
      targetLang: settings.targetLang,
      contextsByWord,
    } as Message)) as { translations?: Record<string, import('../types').TranslationEntry>; error?: string } | undefined

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
    applyReplacements(new Map(Object.entries(res.translations)), eligibleEntries, settings.targetLang)
  } finally {
    resumeObserver() // resume watching for new dynamic content
  }
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'SETTINGS_CHANGED') {
    settings = {
      ...msg.settings,
      percentage: Math.max(
        MIN_TRANSLATION_PERCENTAGE,
        Math.min(MAX_TRANSLATION_PERCENTAGE, msg.settings.percentage)
      ),
    }
    void runPipeline()
  }
})

async function init(): Promise<void> {
  console.log('[osmosis:content] init')
  settings = await loadSettings()
  domObserver = new MutationObserver((mutations) => scheduleFromMutation(mutations))
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

if (location.hostname === 'osmosis-api.jtkopacz.workers.dev') {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="osmosis-session"]')
  const token = meta?.content
  if (token) {
    void chrome.runtime.sendMessage({ type: 'SESSION_FROM_VERIFY', token } as Message)
  }
}
