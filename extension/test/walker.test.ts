import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { collectWords } from '../src/content/walker'

const dom = (html: string) => new JSDOM(html).window.document

describe('collectWords', () => {
  it('collects words from a paragraph', () => {
    const words = collectWords(dom('<p>Hello world</p>').body!).map(w => w.word)
    expect(words).toContain('Hello')
    expect(words).toContain('world')
  })

  it('skips words inside script tags', () => {
    const words = collectWords(dom('<script>var foo="bar"</script><p>hello</p>').body!).map(w => w.word)
    expect(words).not.toContain('foo')
  })

  it('skips words inside code tags', () => {
    const words = collectWords(dom('<code>getElementById</code><p>text</p>').body!).map(w => w.word)
    expect(words).not.toContain('getElementById')
  })

  it('skips words inside nav tags', () => {
    const words = collectWords(dom('<nav>Home About</nav><p>article</p>').body!).map(w => w.word)
    expect(words).not.toContain('Home')
    expect(words).toContain('article')
  })

  it('records word offset within its text node', () => {
    const two = collectWords(dom('<p>one two three</p>').body!).find(w => w.word === 'two')
    expect(two?.offset).toBeGreaterThan(0)
  })
})
