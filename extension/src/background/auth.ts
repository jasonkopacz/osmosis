import { STORAGE_KEYS } from '../constants'
import { clearUserProfileCache } from './userProfileCache'
import { clearAllWordContexts } from '../utils/contextStore'

export async function getToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.TOKEN)
  return (r[STORAGE_KEYS.TOKEN] as string | undefined) ?? null
}

export async function setToken(token: string): Promise<void> {
  await clearUserProfileCache()
  await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN]: token })
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.TOKEN)
  await clearUserProfileCache()
  await clearAllWordContexts()
  await clearRefreshToken()
}

export async function getRefreshToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.REFRESH_TOKEN)
  return (r[STORAGE_KEYS.REFRESH_TOKEN] as string | undefined) ?? null
}

export async function setRefreshToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.REFRESH_TOKEN]: token })
}

export async function clearRefreshToken(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.REFRESH_TOKEN)
}
