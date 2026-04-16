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
    const el = createUsageMeter(0, 50000, '2026-05-01T12:00:00.000Z')
    expect(el.textContent).toMatch(/May\s+1/)
  })

  function fillEl(root: HTMLElement): HTMLElement {
    const track = root.children[1] as HTMLElement
    return track.children[0] as HTMLElement
  }

  it('caps fill at 100% when usage exceeds limit', () => {
    const el = createUsageMeter(99999, 1000, new Date().toISOString())
    expect(fillEl(el).style.width).toBe('100%')
  })

  it('uses green color below 60% usage', () => {
    const el = createUsageMeter(100, 10000, new Date().toISOString())
    const bg = fillEl(el).style.background
    expect(bg === '#10b981' || bg.includes('rgb(16, 185, 129)')).toBe(true)
  })

  it('uses amber color between 60-85% usage', () => {
    const el = createUsageMeter(7000, 10000, new Date().toISOString())
    const bg = fillEl(el).style.background
    expect(bg === '#f59e0b' || bg.includes('rgb(245, 158, 11)')).toBe(true)
  })

  it('uses red color above 85% usage', () => {
    const el = createUsageMeter(9000, 10000, new Date().toISOString())
    const bg = fillEl(el).style.background
    expect(bg === '#ef4444' || bg.includes('rgb(239, 68, 68)')).toBe(true)
  })
})
