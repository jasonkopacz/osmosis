import { describe, it, expect } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'
import { checkRateLimit } from '../../src/utils/ratelimit'

function createMockKV() {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v) },
    delete: async (k: string) => { store.delete(k) },
  } as unknown as KVNamespace
}

describe('checkRateLimit', () => {
  it('allows the first request', async () => {
    const kv = createMockKV()
    expect(await checkRateLimit(kv, 'key', 5, 60)).toBe(true)
  })

  it('allows requests up to the limit', async () => {
    const kv = createMockKV()
    expect(await checkRateLimit(kv, 'key', 3, 60)).toBe(true)
    expect(await checkRateLimit(kv, 'key', 3, 60)).toBe(true)
    expect(await checkRateLimit(kv, 'key', 3, 60)).toBe(true)
  })

  it('blocks the request that exceeds the limit', async () => {
    const kv = createMockKV()
    await checkRateLimit(kv, 'key', 2, 60)
    await checkRateLimit(kv, 'key', 2, 60)
    expect(await checkRateLimit(kv, 'key', 2, 60)).toBe(false)
  })

  it('continues blocking after the limit is exceeded', async () => {
    const kv = createMockKV()
    await checkRateLimit(kv, 'key', 1, 60)
    expect(await checkRateLimit(kv, 'key', 1, 60)).toBe(false)
    expect(await checkRateLimit(kv, 'key', 1, 60)).toBe(false)
  })

  it('tracks separate counters per key', async () => {
    const kv = createMockKV()
    await checkRateLimit(kv, 'key-a', 1, 60)
    expect(await checkRateLimit(kv, 'key-b', 1, 60)).toBe(true)
    expect(await checkRateLimit(kv, 'key-a', 1, 60)).toBe(false)
  })

  it('allows a limit of 1', async () => {
    const kv = createMockKV()
    expect(await checkRateLimit(kv, 'strict', 1, 60)).toBe(true)
    expect(await checkRateLimit(kv, 'strict', 1, 60)).toBe(false)
  })
})
