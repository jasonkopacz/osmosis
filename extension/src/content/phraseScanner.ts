import { PHRASE_SET } from '../data/phrases'

export type PhraseEntry = {
  phrase: string   // lowercase canonical form
  surface: string  // original casing from the page
  node: Text
  start: number    // byte offset in node.textContent
  end: number
}

// Same skip set as walker.ts
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'NAV', 'BUTTON', 'SELECT', 'OPTION'])

/** Word-boundary character: whitespace or common punctuation. */
function isWB(ch: string | undefined): boolean {
  return ch === undefined || /[\s .,;:!?'"()\[\]{}\-–—\/\\]/.test(ch)
}

/**
 * Find all non-overlapping phrase matches within a single text string.
 * Longer phrases take priority when two phrases start at the same position.
 */
export function findPhrasesInText(text: string): Array<{ phrase: string; start: number; end: number }> {
  if (text.length < 4) return []
  const lower = text.toLowerCase()
  const raw: Array<{ phrase: string; start: number; end: number }> = []

  for (const phrase of PHRASE_SET) {
    let pos = 0
    while (pos <= lower.length - phrase.length) {
      const idx = lower.indexOf(phrase, pos)
      if (idx === -1) break

      const beforeOk = isWB(lower[idx - 1])
      const afterOk  = isWB(lower[idx + phrase.length])

      if (beforeOk && afterOk) {
        raw.push({ phrase, start: idx, end: idx + phrase.length })
        pos = idx + phrase.length   // skip past this match
      } else {
        pos = idx + 1
      }
    }
  }

  if (raw.length === 0) return []

  // Sort by start position; on tie prefer the longer phrase
  raw.sort((a, b) => a.start !== b.start ? a.start - b.start : b.phrase.length - a.phrase.length)

  // Remove overlapping matches (greedy left-to-right)
  const result: typeof raw = []
  let lastEnd = 0
  for (const m of raw) {
    if (m.start >= lastEnd) {
      result.push(m)
      lastEnd = m.end
    }
  }
  return result
}

/** Walk all eligible text nodes under `root` and collect phrase matches. */
export function collectPhrases(root: Element | Document): PhraseEntry[] {
  const entries: PhraseEntry[] = []
  const doc = root.nodeType === Node.DOCUMENT_NODE
    ? root as Document
    : (root as Element).ownerDocument!

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement
      while (el) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT
        el = el.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent ?? ''
    for (const { phrase, start, end } of findPhrasesInText(text)) {
      entries.push({ phrase, surface: text.slice(start, end), node, start, end })
    }
  }
  return entries
}

/** Returns deduplicated canonical phrases found across all entries. */
export function uniquePhrases(entries: PhraseEntry[]): string[] {
  return [...new Set(entries.map(e => e.phrase))]
}

