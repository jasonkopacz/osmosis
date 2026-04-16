import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { applyReplacements, clearReplacements } from '../src/content/replacer'
import { collectWords } from '../src/content/walker'

function setup(html: string) {
  const dom = new JSDOM(`<body>${html}</body>`)
  global.document = dom.window.document as unknown as Document
  global.Node = dom.window.Node
  global.NodeFilter = dom.window.NodeFilter
}

describe('applyReplacements', () => {
  beforeEach(() => setup('<p>The quick brown fox</p>'))

  it('replaces a word with its translation', () => {
    const entries = collectWords(document.body)
    applyReplacements(new Map([['quick', 'schnell']]), entries)
    expect(document.body.textContent).toContain('schnell')
  })

  it('sets data-original to the original word', () => {
    const entries = collectWords(document.body)
    applyReplacements(new Map([['quick', 'schnell']]), entries)
    expect(document.querySelector('.osmosis-word')?.getAttribute('data-original')).toBe('quick')
  })

  it('adds osmosis-word class', () => {
    const entries = collectWords(document.body)
    applyReplacements(new Map([['quick', 'schnell']]), entries)
    expect(document.querySelectorAll('.osmosis-word').length).toBeGreaterThan(0)
  })

  it('does nothing when translation map is empty', () => {
    const original = document.body.textContent
    const entries = collectWords(document.body)
    applyReplacements(new Map(), entries)
    expect(document.body.textContent).toBe(original)
  })

  it('replaces multiple words independently', () => {
    setup('<p>The quick brown fox</p>')
    const entries = collectWords(document.body)
    applyReplacements(new Map([['quick', 'schnell'], ['fox', 'Fuchs']]), entries)
    expect(document.body.textContent).toContain('schnell')
    expect(document.body.textContent).toContain('Fuchs')
    expect(document.querySelectorAll('.osmosis-word').length).toBe(2)
  })
})

describe('clearReplacements', () => {
  it('removes spans and restores originals', () => {
    setup('<p>The quick brown fox</p>')
    const entries = collectWords(document.body)
    applyReplacements(new Map([['quick', 'schnell']]), entries)
    clearReplacements()
    expect(document.body.textContent).toContain('quick')
    expect(document.querySelectorAll('.osmosis-word').length).toBe(0)
  })

  it('is idempotent when no replacements exist', () => {
    setup('<p>Untouched text</p>')
    clearReplacements()
    expect(document.body.textContent).toContain('Untouched text')
  })
})
