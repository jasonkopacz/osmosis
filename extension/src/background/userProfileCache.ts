import type { UserProfile } from '../types'
import { STORAGE_KEYS } from '../constants'

type CachedUser = { profile: UserProfile; fetchedAt: number }

export async function getUserProfileCache(): Promise<CachedUser | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE_CACHE)
  const raw = r[STORAGE_KEYS.USER_PROFILE_CACHE] as CachedUser | undefined
  return raw?.profile && typeof raw.fetchedAt === 'number' ? raw : null
}

export async function setUserProfileCache(profile: UserProfile): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_PROFILE_CACHE]: { profile, fetchedAt: Date.now() } satisfies CachedUser,
  })
}

export async function clearUserProfileCache(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.USER_PROFILE_CACHE)
}
