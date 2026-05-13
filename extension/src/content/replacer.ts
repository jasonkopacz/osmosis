import type { WordEntry } from './walker'
import type { PhraseEntry } from './phraseScanner'
import type { TranslationEntry, Message } from '../types'
import { recordLocalEncounters } from './encounters'
import { isEligible } from './filter'
import replacerStyles from './styles/replacer.css?raw'
import { log, warn } from '../logger'

const STYLE_ID = 'osmosis-styles'
const TOOLTIP_HOST_ID = 'osmosis-tooltip-host'

function matchCase(original: string, translation: string): string {
  if (!translation) return translation
  if (original[0] === original[0].toUpperCase()) {
    return translation.charAt(0).toUpperCase() + translation.slice(1)
  }
  return translation.toLowerCase()
}

import { posLabel } from '../utils/pos'

function coerceEntry(entry: TranslationEntry | string): TranslationEntry {
  return typeof entry === 'string' ? { t: entry } : entry
}

let detachActiveTooltip: (() => void) | null = null
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
let tooltipShowTimer: ReturnType<typeof setTimeout> | null = null
let currentTooltipSpan: HTMLSpanElement | null = null
let activeAudio: HTMLAudioElement | null = null
// Tracks words hovered this page session to avoid duplicate encounter reports
const reportedHovers = new Set<string>()

function clearTooltipHideTimer() {
  if (tooltipHideTimer !== null) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
}

function clearTooltipShowTimer() {
  if (tooltipShowTimer !== null) {
    clearTimeout(tooltipShowTimer)
    tooltipShowTimer = null
  }
}

function scheduleTooltipHide() {
  clearTooltipHideTimer()
  tooltipHideTimer = setTimeout(() => {
    detachActiveTooltip?.()
  }, 120)
}

function stopActiveAudio() {
  if (!activeAudio) return
  activeAudio.pause()
  activeAudio.currentTime = 0
  activeAudio = null
}

function localeFromTargetLang(targetLang: string): string {
  const lower = targetLang.toLowerCase()
  if (lower.startsWith('es')) return 'es-ES'
  if (lower.startsWith('fr')) return 'fr-FR'
  if (lower.startsWith('de')) return 'de-DE'
  if (lower.startsWith('it')) return 'it-IT'
  if (lower.startsWith('pt')) return 'pt-BR'
  if (lower.startsWith('ja')) return 'ja-JP'
  if (lower.startsWith('ko')) return 'ko-KR'
  if (lower.startsWith('zh')) return 'zh-CN'
  return targetLang
}

function playBrowserPronunciation(text: string, targetLang: string): boolean {
  if (!('speechSynthesis' in window)) return false
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = localeFromTargetLang(targetLang)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}

function ensureTooltipHost(): HTMLDivElement {
  let host = document.getElementById(TOOLTIP_HOST_ID) as HTMLDivElement | null
  if (!host) {
    host = document.createElement('div')
    host.id = TOOLTIP_HOST_ID
    host.setAttribute('role', 'tooltip')
    // Initial position is arbitrary — positionTooltip overwrites before show
    host.style.left = '0'
    host.style.top = '0'
    host.addEventListener('mouseenter', () => clearTooltipHideTimer())
    host.addEventListener('mouseleave', () => scheduleTooltipHide())
    document.documentElement.appendChild(host)
  }
  return host
}

function positionTooltip(span: HTMLElement, host: HTMLElement) {
  const r = span.getBoundingClientRect()
  host.style.left = `${r.left + r.width / 2}px`
  host.style.top = `${r.top}px`
}

function buildTooltipContent(span: HTMLSpanElement): DocumentFragment {
  const frag = document.createDocumentFragment()

  const original = span.getAttribute('data-original') ?? ''
  const translated = span.getAttribute('data-translation') ?? ''
  const targetLang = span.getAttribute('data-target-lang') ?? ''
  const pos = span.getAttribute('data-pos') ?? ''
  const alts = span.getAttribute('data-alts') ?? ''

  const headerRow = document.createElement('div')
  headerRow.className = 'osmo-tt-header'
  const originalWord = document.createElement('div')
  originalWord.className = 'osmo-tt-word'
  originalWord.textContent = original
  headerRow.appendChild(originalWord)
  if (pos) {
    const posTag = document.createElement('span')
    posTag.className = 'osmo-tt-pos'
    posTag.textContent = pos
    headerRow.appendChild(posTag)
  }
  frag.appendChild(headerRow)

  const translatedWord = document.createElement('div')
  translatedWord.className = 'osmo-tt-translation'
  translatedWord.textContent = translated
  frag.appendChild(translatedWord)

  if (alts) {
    const altsLabel = document.createElement('div')
    altsLabel.className = 'osmo-tt-alts-label'
    altsLabel.textContent = 'Alt translations'
    frag.appendChild(altsLabel)

    const chips = document.createElement('div')
    chips.className = 'osmo-tt-chips'
    for (const alt of alts.split(' · ')) {
      const chip = document.createElement('span')
      chip.className = 'osmo-tt-chip'
      chip.textContent = alt
      chips.appendChild(chip)
    }
    frag.appendChild(chips)
  }

  const pronounceRow = document.createElement('div')
  pronounceRow.className = 'osmo-tt-pronounce-row'
  const pronounceButton = document.createElement('button')
  pronounceButton.type = 'button'
  pronounceButton.className = 'osmo-tt-play-btn'
  pronounceButton.textContent = 'Play Pronunciation'
  pronounceButton.addEventListener('click', async (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (!translated || !targetLang) return
    const previousLabel = pronounceButton.textContent
    pronounceButton.disabled = true
    pronounceButton.textContent = 'Loading...'
    stopActiveAudio()
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'PRONOUNCE',
        text: translated,
        targetLang,
      })) as { audioBase64?: string; mimeType?: string; voice?: string; error?: string } | undefined
      if (!res) return
      if (res.error) {
        warn('[osmosis:content] pronounce error', res.error)
        const usedFallback = playBrowserPronunciation(translated, targetLang)
        if (usedFallback) {
          log('[osmosis:content] pronounce fallback used', { translated, targetLang })
          pronounceButton.textContent = 'Fallback voice'
        } else {
          pronounceButton.textContent = 'Error'
        }
        return
      }
      if (!res.audioBase64 || !res.mimeType) {
        pronounceButton.textContent = 'No audio'
        return
      }
      log('[osmosis:content] pronounce success', {
        original,
        translated,
        targetLang,
        voice: res.voice,
      })
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`)
      activeAudio = audio
      void audio.play().catch(err => warn('[osmosis:content] audio playback failed', err))
    } finally {
      pronounceButton.disabled = false
      pronounceButton.textContent = previousLabel
    }
  })
  pronounceRow.appendChild(pronounceButton)
  frag.appendChild(pronounceRow)

  frag.appendChild(buildRatingRow(original, targetLang))

  return frag
}

function buildRatingRow(original: string, targetLang: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'osmo-tt-rate'

  const knowBtn = document.createElement('button')
  knowBtn.type = 'button'
  knowBtn.className = 'osmo-tt-rate-btn osmo-tt-rate-btn--know'
  knowBtn.textContent = '✓ Know it'

  const learnBtn = document.createElement('button')
  learnBtn.type = 'button'
  learnBtn.className = 'osmo-tt-rate-btn osmo-tt-rate-btn--learn'
  learnBtn.textContent = '↺ Learning'

  function handleRating(rating: 1 | 4): void {
    knowBtn.classList.add('osmo-tt-rate-btn--done')
    learnBtn.classList.add('osmo-tt-rate-btn--done')
    const activeBtn = rating === 4 ? knowBtn : learnBtn
    activeBtn.textContent = rating === 4 ? '✓ Saved' : '↺ Got it'
    void chrome.runtime.sendMessage({ type: 'SRS_RATE', word: original, targetLang, rating })
      .catch(() => { /* fire-and-forget */ })
  }

  knowBtn.addEventListener('click', (ev) => { ev.stopPropagation(); handleRating(4) })
  learnBtn.addEventListener('click', (ev) => { ev.stopPropagation(); handleRating(1) })

  row.append(knowBtn, learnBtn)
  return row
}

function bindTooltipSpan(span: HTMLSpanElement) {
  const host = ensureTooltipHost()
  const onMove = () => positionTooltip(span, host)
  const show = () => {
    clearTooltipHideTimer()
    detachActiveTooltip?.()
    currentTooltipSpan = span
    host.replaceChildren(buildTooltipContent(span))
    positionTooltip(span, host)
    host.classList.add('osmosis-tooltip--visible')

    // Report this hover as an encounter — once per word per page session
    const word = span.getAttribute('data-original') ?? ''
    const lang = span.getAttribute('data-target-lang') ?? ''
    const hoverKey = `${word}:${lang}`
    if (word && lang && !reportedHovers.has(hoverKey)) {
      reportedHovers.add(hoverKey)
      void recordLocalEncounters([word], lang)
      void chrome.runtime.sendMessage({
        type: 'SRS_REPORT_ENCOUNTERS',
        words: [word],
        targetLang: lang,
      } as Message).catch(() => {})
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    detachActiveTooltip = () => {
      host.classList.remove('osmosis-tooltip--visible')
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      currentTooltipSpan = null
      detachActiveTooltip = null
    }
  }
  span.addEventListener('mouseenter', () => {
    clearTooltipShowTimer()
    tooltipShowTimer = setTimeout(show, 400)
  })
  span.addEventListener('mouseleave', () => {
    clearTooltipShowTimer()
    if (currentTooltipSpan === span) scheduleTooltipHide()
  })
}

export function injectTooltipStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = replacerStyles
  document.head.appendChild(style)
}

export function applyReplacements(
  translationMap: Map<string, TranslationEntry | string>,
  entries: WordEntry[],
  targetLang: string
): void {
  if (translationMap.size === 0) return

  const byNode = new Map<Text, Array<{ word: string; offset: number; entry: TranslationEntry }>>()

  for (const { word, node, offset } of entries) {
    if (!isEligible(word, node.textContent?.slice(0, offset) ?? '')) continue
    const rawEntry = translationMap.get(word.toLowerCase())
    if (!rawEntry) continue
    const entry = coerceEntry(rawEntry)
    if (entry.t.toLowerCase() === word.toLowerCase()) continue
    if (!byNode.has(node)) byNode.set(node, [])
    byNode.get(node)!.push({ word, offset, entry })
  }

  for (const [node, matches] of byNode) {
    if (!node.parentNode) continue
    const text = node.textContent ?? ''
    matches.sort((a, b) => a.offset - b.offset)
    const fragment = document.createDocumentFragment()
    let cursor = 0

    for (const { word, offset, entry } of matches) {
      const idx = text.indexOf(word, offset)
      if (idx < cursor) continue
      if (idx === -1) continue
      if (idx > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, idx)))

      const span = document.createElement('span')
      span.className = 'osmosis-word'
      span.setAttribute('data-original', word)
      if (entry.p) span.setAttribute('data-pos', posLabel(entry.p))
      if (entry.a?.length) {
        const altsText = entry.a.map(a => `${a.t} (${posLabel(a.p)})`).join(' · ')
        span.setAttribute('data-alts', altsText)
      }
      span.setAttribute('data-translation', entry.t)
      span.setAttribute('data-target-lang', targetLang)
      span.textContent = matchCase(word, entry.t)
      bindTooltipSpan(span)
      fragment.appendChild(span)
      cursor = idx + word.length
    }

    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode.replaceChild(fragment, node)
  }
}

/**
 * Replace matched phrase spans with translated versions.
 * Phrases are matched case-insensitively; the translation replaces the original surface text.
 * Works identically to applyReplacements but uses PhraseEntry (start/end offsets) instead
 * of WordEntry (single-word offset).
 */
export function applyPhraseReplacements(
  translationMap: Map<string, TranslationEntry | string>,
  entries: PhraseEntry[],
  targetLang: string,
): void {
  if (translationMap.size === 0) return

  // Group entries by text node; filter to those that have a translation
  const byNode = new Map<Text, Array<{ surface: string; phrase: string; start: number; end: number; entry: TranslationEntry }>>()

  for (const { phrase, surface, node, start, end } of entries) {
    const rawEntry = translationMap.get(phrase) ?? translationMap.get(phrase.toLowerCase())
    if (!rawEntry) continue
    const entry = coerceEntry(rawEntry)
    if (entry.t.toLowerCase() === phrase.toLowerCase()) continue
    if (!byNode.has(node)) byNode.set(node, [])
    byNode.get(node)!.push({ surface, phrase, start, end, entry })
  }

  for (const [node, matches] of byNode) {
    if (!node.parentNode) continue
    const text = node.textContent ?? ''
    matches.sort((a, b) => a.start - b.start)

    const fragment = document.createDocumentFragment()
    let cursor = 0

    for (const { surface, start, end, entry } of matches) {
      if (start < cursor) continue  // skip if overlapping (shouldn't happen after scan dedup)

      if (start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, start)))

      const span = document.createElement('span')
      span.className = 'osmosis-word'
      span.setAttribute('data-original', surface)
      span.setAttribute('data-translation', entry.t)
      span.setAttribute('data-target-lang', targetLang)
      // Preserve the original casing of the first word for natural reading
      span.textContent = matchCase(surface, entry.t)
      bindTooltipSpan(span)
      fragment.appendChild(span)
      cursor = end
    }

    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode.replaceChild(fragment, node)
  }
}

export function clearReplacements(): void {
  clearTooltipHideTimer()
  clearTooltipShowTimer()
  detachActiveTooltip?.()
  stopActiveAudio()
  reportedHovers.clear()
  const parents = new Set<Node>()
  document.querySelectorAll<HTMLSpanElement>('.osmosis-word').forEach(span => {
    if (span.parentNode) {
      parents.add(span.parentNode)
      span.parentNode.replaceChild(document.createTextNode(span.getAttribute('data-original') ?? ''), span)
    }
  })
  parents.forEach(parent => (parent as Element).normalize?.())
}
