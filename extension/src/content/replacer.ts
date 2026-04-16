import type { WordEntry } from './walker'
import { isEligible } from './filter'

const STYLE_ID = 'osmosis-styles'
const TOOLTIP_HOST_ID = 'osmosis-tooltip-host'

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
      'padding:3px 8px',
      'font-size:12px',
      'line-height:1.3',
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

function bindTooltipSpan(span: HTMLSpanElement) {
  const host = ensureTooltipHost()
  const onMove = () => positionTooltip(span, host)
  const show = () => {
    detachActiveTooltip?.()
    const text = span.getAttribute('data-original') ?? ''
    host.textContent = text
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

export function applyReplacements(translationMap: Map<string, string>, entries: WordEntry[]): void {
  if (translationMap.size === 0) return

  const byNode = new Map<Text, Array<{ word: string; offset: number; translation: string }>>()

  for (const { word, node, offset } of entries) {
    const prevChar = node.textContent?.[offset - 1] ?? ''
    if (!isEligible(word, prevChar)) continue
    const translation = translationMap.get(word) ?? translationMap.get(word.toLowerCase())
    if (!translation) continue
    if (!byNode.has(node)) byNode.set(node, [])
    byNode.get(node)!.push({ word, offset, translation })
  }

  for (const [node, matches] of byNode) {
    if (!node.parentNode) continue
    matches.sort((a, b) => b.offset - a.offset)

    let remaining: Text = node
    for (const { word, offset, translation } of matches) {
      const text = remaining.textContent ?? ''
      const idx = text.indexOf(word, offset)
      if (idx === -1) continue

      const before = document.createTextNode(text.slice(0, idx))
      const span = document.createElement('span')
      span.className = 'osmosis-word'
      span.setAttribute('data-original', word)
      span.textContent = translation
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
