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
      'transform:translate(-50%,calc(-100% - 6px))',
      'background:#1f2937',
      'color:#f9fafb',
      'border:1px solid #374151',
      'border-radius:6px',
      'padding:4px 8px',
      'font-size:12px',
      'line-height:1.4',
      'white-space:nowrap',
      'pointer-events:auto',
      'box-sizing:border-box',
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

  // Line 1: original English word
  const line1 = document.createElement('div')
  line1.textContent = pos ? `${original} · ${pos}` : original
  frag.appendChild(line1)

  // Line 2: alternatives (only if present)
  if (alts) {
    const line2 = document.createElement('div')
    line2.style.cssText = 'color:#9ca3af;font-size:11px;margin-top:1px'
    line2.textContent = `also: ${alts}`
    frag.appendChild(line2)
  }

  const pronounceRow = document.createElement('div')
  pronounceRow.style.cssText = 'margin-top:4px;display:flex;align-items:center'
  const pronounceButton = document.createElement('button')
  pronounceButton.type = 'button'
  pronounceButton.textContent = '🔊 Pronounce'
  pronounceButton.style.cssText = [
    'appearance:none',
    'border:1px solid #4b5563',
    'background:#111827',
    'color:#e5e7eb',
    'font-size:11px',
    'line-height:1.2',
    'padding:2px 6px',
    'border-radius:4px',
    'cursor:pointer',
    'pointer-events:auto',
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
    positionTooltip(span, host)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    detachActiveTooltip = () => {
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
