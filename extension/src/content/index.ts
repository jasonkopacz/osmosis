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
import { recordLocalEncounters } from './encounters'
import { passesCefrFilter } from './cefr'
import { collectPhrases, uniquePhrases } from './phraseScanner'
import { applyPhraseReplacements } from './replacer'
import { normalizeTargetLang } from '../languages'

let settings: UserSettings = DEFAULT_SETTINGS
let domObserver: MutationObserver | null = null
let mutationTimer: ReturnType<typeof setTimeout> | null = null
let lastMutationRun = 0
let pipelineRunning = false
const MUTATION_COOLDOWN_MS = 5_000
const MUTATION_TEXT_THRESHOLD = 30 // ignore trivial DOM changes (ads, badges, analytics)

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
  if (pipelineRunning) return
  pipelineRunning = true
  pauseObserver() // stop watching during our own DOM mutations
  try {
    if (!settings.enabled) {
      console.log('[osmosis:content] disabled, skipping')
      clearReplacements()
      return
    }
    clearReplacements()
    injectTooltipStyles()

    // ── Phase 1: Collect all candidates before any DOM changes ────────────
    // Phrases run first and always show 100% of matches — the list is curated
    // and sparse enough that full coverage doesn't create visual noise.
    const allPhraseEntries = collectPhrases(document.body)
    const uniquePhraseCandidates = uniquePhrases(allPhraseEntries)

    // Words — collected before DOM changes so offsets are stable.
    const allWordEntries = collectWords(document.body)
    const eligibleWordEntries = allWordEntries.filter(
      ({ word, offset, node }) => isEligible(word, node.textContent?.slice(0, offset) ?? '')
    )

    // ── Phase 2: Exclude words whose offsets fall inside a phrase match ────
    // Prevents "of course" being phrase-replaced while "course" is also
    // individually replaced inside the same span.
    const phraseNodeCoverage = new Map<Text, Array<[number, number]>>()
    for (const e of allPhraseEntries) {
      if (!phraseNodeCoverage.has(e.node)) phraseNodeCoverage.set(e.node, [])
      phraseNodeCoverage.get(e.node)!.push([e.start, e.end])
    }
    const nonOverlappingWordEntries = eligibleWordEntries.filter(({ node, offset }) => {
      const ranges = phraseNodeCoverage.get(node)
      return !ranges?.some(([start, end]) => offset >= start && offset < end)
    })

    // ── Phase 3: CEFR filter + word sampling ──────────────────────────────
    const allUnique = [...new Set(nonOverlappingWordEntries.map(e => e.word))]
    const cefrMin = settings.cefrMinLevel ?? 'all'
    const cefrFiltered = cefrMin === 'all'
      ? allUnique
      : allUnique.filter(w => passesCefrFilter(w, cefrMin))
    const sampledWords = sampleWords(cefrFiltered, settings.percentage, location.href)
    const sampledWordSet = new Set(sampledWords)

    if (sampledWords.length === 0 && uniquePhraseCandidates.length === 0) {
      console.log('[osmosis:content] nothing to translate after filtering')
      void chrome.storage.local.set({
        [STORAGE_KEYS.PAGE_STATS]: { sampled: 0, eligible: cefrFiltered.length, lang: settings.targetLang, cefr: cefrMin },
      })
      return
    }

    // ── Phase 4: Context extraction for sampled words ─────────────────────
    const contextsByWord: Record<string, string> = {}
    const wordsBySentence = new Map<string, Set<string>>()
    const wordsWithoutContext = new Set<string>()
    for (const { word, node, offset } of nonOverlappingWordEntries) {
      if (!sampledWordSet.has(word) || contextsByWord[word]) continue
      const sentence = sentenceAroundOffset(node.textContent ?? '', offset)
      if (!sentence) { wordsWithoutContext.add(word); continue }
      contextsByWord[word] = sentence
      if (!wordsBySentence.has(sentence)) wordsBySentence.set(sentence, new Set())
      wordsBySentence.get(sentence)!.add(word)
    }

    void chrome.storage.local.set({
      [STORAGE_KEYS.PAGE_STATS]: {
        sampled: sampledWords.length,
        eligible: cefrFiltered.length,
        phrases: uniquePhraseCandidates.length,
        lang: settings.targetLang,
        cefr: cefrMin,
      },
    })
    console.log('[osmosis:content] pipeline', {
      phrases: uniquePhraseCandidates.length,
      uniqueEligibleWords: cefrFiltered.length,
      sampledWords: sampledWords.length,
      lang: settings.targetLang,
    })

    // ── Phase 5: Single translate batch (phrases + words, deduped) ────────
    const allToTranslate = [...new Set([...uniquePhraseCandidates, ...sampledWords])]

    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      words: allToTranslate,
      targetLang: settings.targetLang,
      contextsByWord,
    } as Message)) as { translations?: Record<string, import('../types').TranslationEntry>; error?: string } | undefined

    if (!res) return

    if (res.error === 'LIMIT_REACHED') {
      await chrome.storage.local.set({ osmosis_limit_reached: true })
      console.warn('[osmosis:content] monthly limit reached')
      return
    }
    if (res.error === 'NOT_LOGGED_IN' || res.error || !res.translations) {
      if (res.error && res.error !== 'NOT_LOGGED_IN') console.warn('[osmosis:content] translate error', res.error)
      return
    }

    // ── Phase 6: Apply phrase spans first, then word spans ─────────────────
    const translationMap = new Map(Object.entries(res.translations))
    applyPhraseReplacements(translationMap, allPhraseEntries, settings.targetLang)
    applyReplacements(translationMap, nonOverlappingWordEntries, settings.targetLang)

    // ── Phase 7: Encounter tracking ────────────────────────────────────────
    const translatedItems = Object.keys(res.translations)
    if (translatedItems.length > 0) {
      void recordLocalEncounters(translatedItems, settings.targetLang)
      void chrome.runtime.sendMessage({
        type: 'SRS_REPORT_ENCOUNTERS',
        words: translatedItems,
        targetLang: settings.targetLang,
      } as Message)
    }
  } finally {
    pipelineRunning = false
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
