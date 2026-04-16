import { describe, it, expect } from 'vitest'
import { getCached, setCached } from '../src/utils/kv'

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

  it('puts without KV expiration (TTL not used)', async () => {
    const kv = mockKV() as ReturnType<typeof mockKV>
    await setCached(kv, 'hello', 'de', 'hallo')
    expect(kv.getLastPutOptions()?.expirationTtl).toBeUndefined()
  })
})
