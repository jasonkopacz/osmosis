import type { WordEntry } from './walker'
import type { TranslationEntry } from '../types'
import { isEligible } from './filter'

const STYLE_ID = 'osmosis-styles'
const TOOLTIP_HOST_ID = 'osmosis-tooltip-host'

const POS_LABELS: Record<string, string> = {
  VERB: 'verb', NOUN: 'noun', ADJ: 'adj.', ADV: 'adv.',
  PRON: 'pron.', PREP: 'prep.', DET: 'det.', CONJ: 'conj.', INTJ: 'interj.',
}

function posLabel(tag: string): string {
  return POS_LABELS[tag] ?? tag.toLowerCase()
}

let detachActiveTooltip: (() => void) | null = null

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
      'pointer-events:none',
      'box-sizing:border-box',
    ].join(';')
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

  return frag
}

function bindTooltipSpan(span: HTMLSpanElement) {
  const host = ensureTooltipHost()
  const onMove = () => positionTooltip(span, host)
  const show = () => {
    detachActiveTooltip?.()
    host.replaceChildren(buildTooltipContent(span))
    host.style.display = 'block'
    positionTooltip(span, host)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    detachActiveTooltip = () => {
      host.style.display = 'none'
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      detachActiveTooltip = null
    }
  }
  const hide = () => detachActiveTooltip?.()
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

export function applyReplacements(translationMap: Map<string, TranslationEntry>, entries: WordEntry[]): void {
  if (translationMap.size === 0) return

  const byNode = new Map<Text, Array<{ word: string; offset: number; entry: TranslationEntry }>>()

  for (const { word, node, offset } of entries) {
    const prevChar = node.textContent?.[offset - 1] ?? ''
    if (!isEligible(word, prevChar)) continue
    const entry = translationMap.get(word) ?? translationMap.get(word.toLowerCase())
    if (!entry) continue
    if (!byNode.has(node)) byNode.set(node, [])
    byNode.get(node)!.push({ word, offset, entry })
  }

  for (const [node, matches] of byNode) {
    if (!node.parentNode) continue
    matches.sort((a, b) => b.offset - a.offset)

    let remaining: Text = node
    for (const { word, offset, entry } of matches) {
      const text = remaining.textContent ?? ''
      const idx = text.indexOf(word, offset)
      if (idx === -1) continue

      const before = document.createTextNode(text.slice(0, idx))
      const span = document.createElement('span')
      span.className = 'osmosis-word'
      span.setAttribute('data-original', word)
      if (entry.p) span.setAttribute('data-pos', posLabel(entry.p))
      if (entry.a?.length) {
        const altsText = entry.a.map(a => `${a.t} (${posLabel(a.p)})`).join(' · ')
        span.setAttribute('data-alts', altsText)
      }
      span.textContent = entry.t
      bindTooltipSpan(span)
      const after = document.createTextNode(text.slice(idx + word.length))

      remaining.parentNode!.replaceChild(after, remaining)
      after.parentNode!.insertBefore(span, after)
      after.parentNode!.insertBefore(before, span)

      remaining = before
    }
  }
}

export function clearReplacements(): void {
  detachActiveTooltip?.()
  const parents = new Set<Node>()
  document.querySelectorAll<HTMLSpanElement>('.osmosis-word').forEach(span => {
    if (span.parentNode) {
      parents.add(span.parentNode)
      span.parentNode.replaceChild(document.createTextNode(span.getAttribute('data-original') ?? ''), span)
    }
  })
  parents.forEach(parent => (parent as Element).normalize?.())
}
