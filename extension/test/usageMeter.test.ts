import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { createUsageMeter } from '../src/popup/components/usageMeter'

beforeEach(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.document = dom.window.document as unknown as Document
})

describe('createUsageMeter', () => {
  it('renders without throwing', () => {
    expect(() => createUsageMeter(1000, 50000, new Date().toISOString())).not.toThrow()
  })

  it('returns a DOM element', () => {
    const el = createUsageMeter(0, 50000, new Date().toISOString())
    expect(el).toBeInstanceOf(Object)
    expect(el.tagName).toBeDefined()
  })

  it('shows used / limit text', () => {
    const el = createUsageMeter(1500, 50000, new Date().toISOString())
    expect(el.textContent).toContain('1,500')
    expect(el.textContent).toContain('50,000')
  })

  it('shows reset date', () => {
    const el = createUsageMeter(0, 50000, '2026-05-01T00:00:00.000Z')
    expect(el.textContent).toMatch(/May 1/)
  })

  it('caps fill at 100% when usage exceeds limit', () => {
    const el = createUsageMeter(99999, 1000, new Date().toISOString())
    const fill = el.querySelector('div > div') as HTMLElement | null
    // The fill div is nested; check that its width style is capped
    const html = el.innerHTML
    expect(html).toContain('width:100%')
  })

  it('uses green color below 60% usage', () => {
    const el = createUsageMeter(100, 10000, new Date().toISOString())
    expect(el.innerHTML).toContain('#10b981')
  })

  it('uses amber color between 60-85% usage', () => {
    const el = createUsageMeter(7000, 10000, new Date().toISOString())
    expect(el.innerHTML).toContain('#f59e0b')
  })

  it('uses red color above 85% usage', () => {
    const el = createUsageMeter(9000, 10000, new Date().toISOString())
    expect(el.innerHTML).toContain('#ef4444')
  })
})
