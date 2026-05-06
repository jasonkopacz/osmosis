import { describe, it, expect, vi, beforeEach } from 'vitest'
import { translateWords } from '../src/services/azure'

beforeEach(() => vi.restoreAllMocks())

describe('translateWords', () => {
  it('maps each input word to its translation entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { translations: [{ text: 'hallo', to: 'de' }] },
        { translations: [{ text: 'Welt', to: 'de' }] },
      ],
    }))
    const result = await translateWords(['hello', 'world'], 'de', 'key', 'eastus')
    expect(result.get('hello')).toEqual({ t: 'hallo' })
    expect(result.get('world')).toEqual({ t: 'Welt' })
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401,
      text: async () => '',
    }))
    await expect(translateWords(['hello'], 'de', 'bad', 'eastus')).rejects.toThrow('Azure API error: 401')
  })

  it('returns empty map for empty words array', async () => {
    const result = await translateWords([], 'de', 'key', 'eastus')
    expect(result.size).toBe(0)
  })
})
