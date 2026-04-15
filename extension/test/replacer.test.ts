import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { applyReplacements, clearReplacements } from '../src/content/replacer'

beforeEach(() => {
  const dom = new JSDOM('<p>The quick brown fox</p>')
  global.document = dom.window.document as unknown as Document
})

describe('applyReplacements', () => {
  it('replaces a word with its translation', () => {
    applyReplacements(new Map([['quick', 'schnell']]))
    expect(document.body.textContent).toContain('schnell')
  })

  it('sets data-original to the original word', () => {
    applyReplacements(new Map([['quick', 'schnell']]))
    expect(document.querySelector('.osmosis-word')?.getAttribute('data-original')).toBe('quick')
  })

  it('adds osmosis-word class', () => {
    applyReplacements(new Map([['quick', 'schnell']]))
    expect(document.querySelectorAll('.osmosis-word').length).toBeGreaterThan(0)
  })
})

describe('clearReplacements', () => {
  it('removes spans and restores originals', () => {
    applyReplacements(new Map([['quick', 'schnell']]))
    clearReplacements()
    expect(document.body.textContent).toContain('quick')
    expect(document.querySelectorAll('.osmosis-word').length).toBe(0)
  })
})
