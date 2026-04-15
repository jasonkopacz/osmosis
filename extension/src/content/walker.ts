const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'NAV', 'BUTTON', 'SELECT', 'OPTION'])

export type WordEntry = { word: string; node: Text; offset: number }

function documentFor(root: Element | Document): Document {
  if (root.nodeType === Node.DOCUMENT_NODE) return root as Document
  return root.ownerDocument!
}

export function collectWords(root: Element | Document): WordEntry[] {
  const entries: WordEntry[] = []
  const doc = documentFor(root)
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
    for (const m of text.matchAll(/\b([a-zA-Z']+)\b/g)) {
      entries.push({ word: m[1]!, node, offset: m.index ?? 0 })
    }
  }
  return entries
}
