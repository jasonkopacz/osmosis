import { describe, it, expect } from 'vitest'
import { getCached, setCached } from '../src/utils/kv'
import type { TranslationEntry } from '../src/types'

function mockKV() {
  const store = new Map<string, string>()
  const lastPutOptions: ({ expirationTtl?: number } | undefined)[] = []
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value)
      lastPutOptions.push(opts)
    },
    getLastPutOptions: () => lastPutOptions[lastPutOptions.length - 1],
  } as unknown as KVNamespace & { getLastPutOptions: () => { expirationTtl?: number } | undefined }
}

const HALLO: TranslationEntry = { t: 'hallo', p: 'NOUN' }

describe('KV cache', () => {
  it('returns null on miss', async () => {
    expect(await getCached(mockKV(), 'hello', 'de')).toBeNull()
  })

  it('returns cached TranslationEntry on hit', async () => {
    const kv = mockKV()
    await setCached(kv, 'hello', 'de', HALLO)
    expect(await getCached(kv, 'hello', 'de')).toEqual(HALLO)
  })

  it('different languages are different keys', async () => {
    const kv = mockKV()
    await setCached(kv, 'hello', 'de', HALLO)
    expect(await getCached(kv, 'hello', 'fr')).toBeNull()
  })

  it('normalizes word and lang to lowercase', async () => {
    const kv = mockKV()
    await setCached(kv, 'Hello', 'DE', HALLO)
    expect(await getCached(kv, 'hello', 'de')).toEqual(HALLO)
  })

  it('handles legacy plain-string entries with backwards compat', async () => {
    const kv = mockKV()
    // simulate an old entry written as a raw string (pre-POS migration)
    await (kv as unknown as { put(k: string, v: string): Promise<void> }).put('hello:de', 'hallo')
    expect(await getCached(kv, 'hello', 'de')).toEqual({ t: 'hallo' })
  })

  it('puts with a 30-day KV expiration TTL', async () => {
    const kv = mockKV() as ReturnType<typeof mockKV>
    await setCached(kv, 'hello', 'de', HALLO)
    expect(kv.getLastPutOptions()?.expirationTtl).toBe(30 * 24 * 60 * 60)
  })
})
