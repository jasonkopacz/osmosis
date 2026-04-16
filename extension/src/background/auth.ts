import { STORAGE_KEYS } from '../constants'

export async function getToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.TOKEN)
  return (r[STORAGE_KEYS.TOKEN] as string | undefined) ?? null
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN]: token })
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.TOKEN)
}
