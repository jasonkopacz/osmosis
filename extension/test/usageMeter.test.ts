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

  it('uses no modifier class below 60% usage', () => {
    const el = createUsageMeter(100, 10000, new Date().toISOString())
    expect(fillEl(el).className).not.toContain('osmo-usage__fill--warn')
    expect(fillEl(el).className).not.toContain('osmo-usage__fill--error')
  })

  it('uses amber class between 60-85% usage', () => {
    const el = createUsageMeter(7000, 10000, new Date().toISOString())
    expect(fillEl(el).className).toContain('osmo-usage__fill--warn')
    expect(fillEl(el).className).not.toContain('osmo-usage__fill--error')
  })

  it('uses red class above 85% usage', () => {
    const el = createUsageMeter(9000, 10000, new Date().toISOString())
    expect(fillEl(el).className).toContain('osmo-usage__fill--error')
    expect(fillEl(el).className).not.toContain('osmo-usage__fill--warn')
  })
})
