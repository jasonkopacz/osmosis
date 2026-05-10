import type { WordEntry } from './walker'
import type { TranslationEntry } from '../types'
import { isEligible } from './filter'
import replacerStyles from './styles/replacer.css?raw'

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
    host.style.display = 'none'
    host.style.left = '0'
    host.style.top = '0'
    host.style.opacity = '0'
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
  originalWord.style.cssText = 'font-weight:700;font-size:14px;color:#ffffff;letter-spacing:0.005em'
  originalWord.textContent = original
  headerRow.appendChild(originalWord)
  if (pos) {
    const posTag = document.createElement('span')
    posTag.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'background:#0c2840',
      'border:1px solid rgba(110,180,220,.14)',
      'color:#b9cbe0',
      'padding:2px 6px',
      'border-radius:4px',
      'font-size:10px',
      'text-transform:uppercase',
      'letter-spacing:0.14em',
      'white-space:nowrap',
    ].join(';')
    posTag.textContent = pos
    headerRow.appendChild(posTag)
  }
  frag.appendChild(headerRow)

  const translatedWord = document.createElement('div')
  translatedWord.style.cssText = 'margin-top:4px;color:#5cc6f5;font-size:14px;font-weight:600'
  translatedWord.textContent = translated
  frag.appendChild(translatedWord)

  if (alts) {
    const altsLabel = document.createElement('div')
    altsLabel.style.cssText = 'color:#6f8aa6;font-size:10px;margin-top:6px;text-transform:uppercase;letter-spacing:0.14em'
    altsLabel.textContent = 'Alt translations'
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
        'padding:2px 8px',
        'border-radius:4px',
        'border:1px solid rgba(110,180,220,.14)',
        'background:#03101c',
        'color:#cdeaff',
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
    '-webkit-appearance:none',
    'background:linear-gradient(180deg,#5cc6f5 0%,#2aa4e0 100%)',
    'border:1px solid rgba(255,255,255,0.18)',
    'color:#042033',
    'font-size:11px',
    'font-weight:700',
    'line-height:1.2',
    'padding:4px 10px',
    'border-radius:8px',
    'cursor:pointer',
    'pointer-events:auto',
    'box-shadow:0 0 0 1px rgba(42,164,224,.45),0 4px 12px -4px rgba(42,164,224,.55)',
    'transition:filter 120ms cubic-bezier(.2,.8,.2,1)',
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
