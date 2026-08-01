import { collectWords } from './walker'
import { isEligible } from './filter'
import { sampleWords } from './scorer'
import { applyReplacements, clearReplacements, injectTooltipStyles, setWordSuppressedCallback } from './replacer'
import type { UserSettings, Message } from '../types'
import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  MIN_TRANSLATION_PERCENTAGE,
  MAX_TRANSLATION_PERCENTAGE,
  API_BASE_URL,
} from '../constants'
import { passesCefrFilter } from './cefr'
import { collectPhrases, uniquePhrases } from './phraseScanner'
import { applyPhraseReplacements } from './replacer'
import { getSuppressedWords } from '../utils/suppressedWords'
import { normalizeTargetLang } from '../languages'
import { log, warn } from '../logger'
import { saveWordContext } from '../utils/contextStore'
import { getMasteredWords } from '../utils/masteredWords'

let settings: UserSettings = DEFAULT_SETTINGS
let domObserver: MutationObserver | null = null
let mutationTimer: ReturnType<typeof setTimeout> | null = null
let pipelineRunning = false
let pendingPipelineRerun = false
let cachedTranslationMap: Map<string, import('../types').TranslationEntry | string> = new Map()
let cachedTargetLang = ''
const MUTATION_TEXT_THRESHOLD = 30 // ignore trivial DOM changes (ads, badges, analytics)

let masteredWordsCache: { words: Set<string>; lang: string; fetchedAt: number } | null = null
const MASTERED_WORDS_CACHE_TTL_MS = 30_000

async function getCachedMasteredWords(lang: string): Promise<Set<string>> {
  const now = Date.now()
  if (masteredWordsCache && masteredWordsCache.lang === lang && now - masteredWordsCache.fetchedAt < MASTERED_WORDS_CACHE_TTL_MS) {
    return masteredWordsCache.words
  }
  const words = await getMasteredWords(lang)
  masteredWordsCache = { words, lang, fetchedAt: now }
  return words
}

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
    log('[osmosis:content] clamped percentage setting', {
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

function collectMeaningfulNewNodes(mutations: MutationRecord[]): Element[] {
  if (document.getElementById('osmosis-tooltip-host')?.classList.contains('osmosis-tooltip--visible')) return []
  const roots = new Set<Element>()
  for (const m of mutations) {
    const target = m.target as Element
    if (target.id === 'osmosis-tooltip-host' || target.closest?.('#osmosis-tooltip-host')) continue
    if (target.classList?.contains('osmosis-word')) continue
    for (const node of m.addedNodes) {
      if ((node.textContent?.trim().length ?? 0) < MUTATION_TEXT_THRESHOLD) continue
      const root = node instanceof Element ? node : node.parentElement
      if (root) roots.add(root)
    }
  }
  return [...roots]
}

async function runIncrementalPipeline(roots: Element[]): Promise<void> {
  if (cachedTranslationMap.size === 0 || !settings.enabled) return
  pauseObserver()
  try {
    for (const root of roots) {
      applyPhraseReplacements(cachedTranslationMap, collectPhrases(root), cachedTargetLang)
      applyReplacements(cachedTranslationMap, collectWords(root), cachedTargetLang)
    }
  } finally {
    resumeObserver()
  }
}

function scheduleFromMutation(mutations: MutationRecord[]): void {
  const roots = collectMeaningfulNewNodes(mutations)
  if (roots.length === 0) return
  if (mutationTimer !== null) clearTimeout(mutationTimer)
  mutationTimer = setTimeout(() => {
    mutationTimer = null
    void runIncrementalPipeline(roots)
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
      log('[osmosis:content] disabled, skipping')
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
    const masteredWords = await getCachedMasteredWords(settings.targetLang)
    const sampledWords = sampleWords(cefrFiltered, settings.percentage, location.href, masteredWords)
    const sampledWordSet = new Set(sampledWords)

    if (sampledWords.length === 0 && uniquePhraseCandidates.length === 0) {
      log('[osmosis:content] nothing to translate after filtering')
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

    log('[osmosis:content] pipeline', {
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
      warn('[osmosis:content] monthly limit reached')
      return
    }
    if (res.error === 'NOT_LOGGED_IN' || res.error || !res.translations) {
      if (res.error && res.error !== 'NOT_LOGGED_IN') warn('[osmosis:content] translate error', res.error)
      return
    }

    // ── Phase 6: Apply phrase spans first, then word spans ─────────────────
    const translationMap = new Map(Object.entries(res.translations))
    const suppressed = await getSuppressedWords(settings.targetLang)
    for (const w of suppressed) translationMap.delete(w)
    cachedTranslationMap = translationMap
    cachedTargetLang = settings.targetLang
    applyPhraseReplacements(translationMap, allPhraseEntries, settings.targetLang)
    applyReplacements(translationMap, nonOverlappingWordEntries, settings.targetLang)

    // ── Phase 7: Final PAGE_STATS ─────────────────────────────────────────────
    const translatedItems = Object.keys(res.translations)
    // Write actual translated count now that we know it — popup listens for this
    void chrome.storage.local.set({
      [STORAGE_KEYS.PAGE_STATS]: {
        sampled: translatedItems.length,
        eligible: cefrFiltered.length,
        phrases: uniquePhraseCandidates.length,
        lang: settings.targetLang,
        cefr: cefrMin,
      },
    })

    // ── Phase 8: Persist sentence context for fill-in-the-blank quiz ─────────
    for (const [word, sentence] of Object.entries(contextsByWord)) {
      if (res.translations[word]) {
        void saveWordContext(word, settings.targetLang, sentence)
      }
    }
  } finally {
    pipelineRunning = false
    resumeObserver()
    if (pendingPipelineRerun) {
      pendingPipelineRerun = false
      void runPipeline()
    }
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
      targetLang: normalizeTargetLang(msg.settings.targetLang),
    }
    if (pipelineRunning) {
      pendingPipelineRerun = true
    } else {
      void runPipeline()
    }
  }
})

async function init(): Promise<void> {
  log('[osmosis:content] init')

  // Never translate on the backend's own pages (e.g. email verification).
  // Handle the session token if present, then bail out before loading settings
  // or running the pipeline — avoiding the race where settings.enabled is still
  // true while SESSION_FROM_VERIFY is still in-flight setting it to false.
  if (location.hostname === new URL(API_BASE_URL).hostname) {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="osmosis-session"]')
    const token = meta?.content
    if (token) {
      void chrome.runtime.sendMessage({ type: 'SESSION_FROM_VERIFY', token } as Message)
    }
    return
  }

  setWordSuppressedCallback((word, lang) => {
    if (lang === cachedTargetLang) cachedTranslationMap.delete(word.toLowerCase())
  })

  settings = await loadSettings()
  domObserver = new MutationObserver((mutations) => scheduleFromMutation(mutations))
  log('[osmosis:content] settings loaded', settings)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void runPipeline()
    })
  } else {
    await runPipeline()
  }
}

void init()
