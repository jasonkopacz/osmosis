import type { WordEntry } from './walker'
import type { TranslationEntry } from '../types'
import { isEligible } from './filter'

const STYLE_ID = 'osmosis-styles'
const TOOLTIP_HOST_ID = 'osmosis-tooltip-host'

function matchCase(original: string, translation: string): string {
  if (!translation) return translation
  if (original[0] === original[0].toUpperCase()) {
    return translation.charAt(0).toUpperCase() + translation.slice(1)
  }
  return translation.toLowerCase()
}

const POS_LABELS: Record<string, string> = {
  VERB: 'verb', NOUN: 'noun', ADJ: 'adj.', ADV: 'adv.',
  PRON: 'pron.', PREP: 'prep.', DET: 'det.', CONJ: 'conj.', INTJ: 'interj.',
}

function posLabel(tag: string): string {
  return POS_LABELS[tag] ?? tag.toLowerCase()
}

function coerceEntry(entry: TranslationEntry | string): TranslationEntry {
  return typeof entry === 'string' ? { t: entry } : entry
}

let detachActiveTooltip: (() => void) | null = null
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
let currentTooltipSpan: HTMLSpanElement | null = null
let activeAudio: HTMLAudioElement | null = null

function clearTooltipHideTimer() {
  if (tooltipHideTimer !== null) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
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
    host.style.cssText = [
      'display:none',
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:2147483647',
      'transform:translate(-50%,-100%)',
      'background:linear-gradient(180deg,#0f172a 0%,#111827 100%)',
      'color:#f8fafc',
      'border:1px solid #334155',
      'border-radius:10px',
      'padding:8px 10px',
      'font-size:12px',
      'line-height:1.35',
      'white-space:normal',
      'min-width:170px',
      'max-width:280px',
      'box-shadow:0 10px 24px rgba(0,0,0,0.28),0 2px 8px rgba(0,0,0,0.2)',
      'backdrop-filter:blur(4px)',
      'pointer-events:auto',
      'box-sizing:border-box',
      'opacity:0',
      'transition:opacity 120ms ease',
    ].join(';')
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
  headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px'
  const originalWord = document.createElement('div')
  originalWord.style.cssText = 'font-weight:700;font-size:13px;color:#ffffff;letter-spacing:0.01em'
  originalWord.textContent = original
  headerRow.appendChild(originalWord)
  if (pos) {
    const posTag = document.createElement('span')
    posTag.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'border:1px solid #475569',
      'background:#1e293b',
      'color:#cbd5e1',
      'padding:1px 6px',
      'border-radius:999px',
      'font-size:10px',
      'text-transform:uppercase',
      'letter-spacing:0.04em',
      'white-space:nowrap',
    ].join(';')
    posTag.textContent = pos
    headerRow.appendChild(posTag)
  }
  frag.appendChild(headerRow)

  const translatedWord = document.createElement('div')
  translatedWord.style.cssText = 'margin-top:4px;color:#93c5fd;font-size:13px;font-weight:600'
  translatedWord.textContent = translated
  frag.appendChild(translatedWord)

  if (alts) {
    const altsLabel = document.createElement('div')
    altsLabel.style.cssText = 'color:#94a3b8;font-size:10px;margin-top:6px;text-transform:uppercase;letter-spacing:0.05em'
    altsLabel.textContent = 'Alternatives'
    frag.appendChild(altsLabel)

    const chips = document.createElement('div')
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px'
    for (const alt of alts.split(' · ')) {
      const chip = document.createElement('span')
      chip.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'max-width:100%',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
        'padding:2px 6px',
        'border-radius:999px',
        'border:1px solid #475569',
        'background:#0b1220',
        'color:#dbeafe',
        'font-size:10px',
      ].join(';')
      chip.textContent = alt
      chips.appendChild(chip)
    }
    frag.appendChild(chips)
  }

  const pronounceRow = document.createElement('div')
  pronounceRow.style.cssText = 'margin-top:8px;display:flex;align-items:center;justify-content:flex-end'
  const pronounceButton = document.createElement('button')
  pronounceButton.type = 'button'
  pronounceButton.textContent = 'Play Pronunciation'
  pronounceButton.style.cssText = [
    'appearance:none',
    'border:1px solid #2563eb',
    'background:linear-gradient(180deg,#2563eb 0%,#1d4ed8 100%)',
    'color:#eff6ff',
    'font-size:11px',
    'font-weight:600',
    'line-height:1.2',
    'padding:4px 8px',
    'border-radius:7px',
    'cursor:pointer',
    'pointer-events:auto',
    'box-shadow:0 2px 6px rgba(29,78,216,0.35)',
  ].join(';')
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
        console.warn('[osmosis:content] pronounce error', res.error)
        const usedFallback = playBrowserPronunciation(translated, targetLang)
        if (usedFallback) {
          console.log('[osmosis:content] pronounce fallback used', { translated, targetLang })
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
      console.log('[osmosis:content] pronounce success', {
        original,
        translated,
        targetLang,
        voice: res.voice,
      })
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`)
      activeAudio = audio
      void audio.play().catch(err => console.warn('[osmosis:content] audio playback failed', err))
    } finally {
      pronounceButton.disabled = false
      pronounceButton.textContent = previousLabel
    }
  })
  pronounceRow.appendChild(pronounceButton)
  frag.appendChild(pronounceRow)

  return frag
}

function bindTooltipSpan(span: HTMLSpanElement) {
  const host = ensureTooltipHost()
  const onMove = () => positionTooltip(span, host)
  const show = () => {
    clearTooltipHideTimer()
    detachActiveTooltip?.()
    currentTooltipSpan = span
    host.replaceChildren(buildTooltipContent(span))
    host.style.display = 'block'
    host.style.opacity = '1'
    positionTooltip(span, host)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    detachActiveTooltip = () => {
      host.style.opacity = '0'
      host.style.display = 'none'
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      currentTooltipSpan = null
      detachActiveTooltip = null
    }
  }
  const hide = () => {
    if (currentTooltipSpan === span) scheduleTooltipHide()
  }
  span.addEventListener('mouseenter', show)
  span.addEventListener('mouseleave', hide)
}

export function injectTooltipStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .osmosis-word {
      border-bottom: 2px solid rgba(59,130,246,0.7);
      cursor: inherit;
      position: relative;
      z-index: 1;
      display: inline-block;
      vertical-align: baseline;
      pointer-events: auto;
    }
  `
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
    const rawEntry = translationMap.get(word) ?? translationMap.get(word.toLowerCase())
    if (!rawEntry) continue
    const entry = coerceEntry(rawEntry)
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

export function clearReplacements(): void {
  clearTooltipHideTimer()
  detachActiveTooltip?.()
  stopActiveAudio()
  const parents = new Set<Node>()
  document.querySelectorAll<HTMLSpanElement>('.osmosis-word').forEach(span => {
    if (span.parentNode) {
      parents.add(span.parentNode)
      span.parentNode.replaceChild(document.createTextNode(span.getAttribute('data-original') ?? ''), span)
    }
  })
  parents.forEach(parent => (parent as Element).normalize?.())
}
