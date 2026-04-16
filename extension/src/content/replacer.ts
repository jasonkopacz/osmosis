import type { WordEntry } from './walker'
import { isEligible } from './filter'

const STYLE_ID = 'osmosis-styles'

export function injectTooltipStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .osmosis-word {
      border-bottom: 2px solid rgba(59,130,246,0.7);
      cursor: pointer;
      position: relative;
    }
    .osmosis-word::after {
      content: attr(data-original);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: #f9fafb;
      border: 1px solid #374151;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 2147483647;
      display: none;
    }
    .osmosis-word:hover::after { display: block; }
  `
  document.head.appendChild(style)
}

export function applyReplacements(translationMap: Map<string, string>, entries: WordEntry[]): void {
  if (translationMap.size === 0) return

  // Group all eligible matches by text node
  const byNode = new Map<Text, Array<{ word: string; offset: number; translation: string }>>()

  for (const { word, node, offset } of entries) {
    const prevChar = node.textContent?.[offset - 1] ?? ''
    if (!isEligible(word, prevChar)) continue
    const translation = translationMap.get(word) ?? translationMap.get(word.toLowerCase())
    if (!translation) continue
    if (!byNode.has(node)) byNode.set(node, [])
    byNode.get(node)!.push({ word, offset, translation })
  }

  // Process each node right-to-left so earlier splits don't invalidate later offsets
  for (const [node, matches] of byNode) {
    if (!node.parentNode) continue
    matches.sort((a, b) => b.offset - a.offset)

    let remaining: Text = node
    for (const { word, offset, translation } of matches) {
      const text = remaining.textContent ?? ''
      const idx = offset
      if (idx < 0 || idx + word.length > text.length) {
        console.warn('[osmosis:replacer] skipping match with out-of-bounds offset', {
          word,
          offset,
          textLength: text.length,
        })
        continue
      }

      const before = document.createTextNode(text.slice(0, idx))
      const span = document.createElement('span')
      span.className = 'osmosis-word'
      span.setAttribute('data-original', word)
      span.textContent = translation
      const after = document.createTextNode(text.slice(idx + word.length))

      remaining.parentNode!.replaceChild(after, remaining)
      after.parentNode!.insertBefore(span, after)
      after.parentNode!.insertBefore(before, span)

      remaining = before
    }
  }
}

export function clearReplacements(): void {
  const parents = new Set<Node>()
  document.querySelectorAll<HTMLSpanElement>('.osmosis-word').forEach(span => {
    if (span.parentNode) {
      parents.add(span.parentNode)
      span.parentNode.replaceChild(document.createTextNode(span.getAttribute('data-original') ?? ''), span)
    }
  })
  parents.forEach(parent => (parent as Element).normalize?.())
}
