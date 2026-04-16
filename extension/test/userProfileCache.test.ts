import { describe, it, expect, beforeEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../src/constants'
import {
  clearUserProfileCache,
  getUserProfileCache,
  setUserProfileCache,
} from '../src/background/userProfileCache'
import type { UserProfile } from '../src/types'

const store: Record<string, unknown> = {}

beforeEach(() => {
  Object.keys(store).forEach(k => {
    delete store[k]
  })
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn((keys: string | string[]) => {
          const k = typeof keys === 'string' ? keys : keys[0]
          return Promise.resolve({ [k]: store[k] })
        }),
        set: vi.fn((obj: Record<string, unknown>) => {
          Object.assign(store, obj)
          return Promise.resolve()
        }),
        remove: vi.fn((key: string) => {
          delete store[key]
          return Promise.resolve()
        }),
      },
    },
  })
})

const sampleProfile: UserProfile = {
  email: 't@test.com',
  plan: 'free',
  usage: { used: 0, limit: 100, resetsAt: '2026-05-01T00:00:00.000Z' },
}

describe('userProfileCache', () => {
  it('returns null when empty', async () => {
    expect(await getUserProfileCache()).toBeNull()
  })

  it('round-trips profile', async () => {
    await setUserProfileCache(sampleProfile)
    const got = await getUserProfileCache()
    expect(got?.profile).toEqual(sampleProfile)
    expect(typeof got?.fetchedAt).toBe('number')
  })

  it('clears cache', async () => {
    await setUserProfileCache(sampleProfile)
    await clearUserProfileCache()
    expect(store[STORAGE_KEYS.USER_PROFILE_CACHE]).toBeUndefined()
    expect(await getUserProfileCache()).toBeNull()
  })

  it('returns null for malformed stored value', async () => {
    store[STORAGE_KEYS.USER_PROFILE_CACHE] = { profile: null, fetchedAt: 1 }
    expect(await getUserProfileCache()).toBeNull()
  })
})
