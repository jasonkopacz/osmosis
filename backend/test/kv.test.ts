import { describe, it, expect } from 'vitest'
import { getCached, setCached } from '../src/lib/kv'

const EXPECTED_TTL = 60 * 60 * 24 * 30

function mockKV() {
  const store = new Map<string, string>()
  const lastPutOptions: { expirationTtl?: number }[] = []
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value)
      if (opts) lastPutOptions.push(opts)
    },
    getLastPutOptions: () => lastPutOptions[lastPutOptions.length - 1],
  } as unknown as KVNamespace & { getLastPutOptions: () => { expirationTtl?: number } | undefined }
}

describe('KV cache', () => {
  it('returns null on miss', async () => {
    expect(await getCached(mockKV(), 'hello', 'de')).toBeNull()
  })

  it('returns cached value on hit', async () => {
    const kv = mockKV()
    await setCached(kv, 'hello', 'de', 'hallo')
    expect(await getCached(kv, 'hello', 'de')).toBe('hallo')
  })

  it('different languages are different keys', async () => {
    const kv = mockKV()
    await setCached(kv, 'hello', 'de', 'hallo')
    expect(await getCached(kv, 'hello', 'fr')).toBeNull()
  })

  it('normalizes word and lang to lowercase', async () => {
    const kv = mockKV()
    await setCached(kv, 'Hello', 'DE', 'hallo')
    expect(await getCached(kv, 'hello', 'de')).toBe('hallo')
  })

  it('sets TTL to 30 days', async () => {
    const kv = mockKV() as ReturnType<typeof mockKV>
    await setCached(kv, 'hello', 'de', 'hallo')
    expect((kv as unknown as { getLastPutOptions: () => { expirationTtl?: number } }).getLastPutOptions()?.expirationTtl).toBe(EXPECTED_TTL)
  })
})
