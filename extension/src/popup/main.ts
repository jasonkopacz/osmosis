import type { UserProfile, UserSettings } from '../types'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants'
import { normalizeTargetLang } from '../languages'
import { renderLogin } from './views/login'
import { renderMain } from './views/main'
import { renderSettings } from './views/settings'

const app = document.getElementById('app')
if (!app) throw new Error('popup #app missing')

async function loadSettings(): Promise<UserSettings> {
  const r = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS)
  const raw = r[STORAGE_KEYS.SETTINGS] as Partial<UserSettings> | undefined
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...raw }
  return { ...merged, targetLang: normalizeTargetLang(merged.targetLang) }
}

async function boot(): Promise<void> {
  const user = (await chrome.runtime.sendMessage({ type: 'GET_USER' })) as UserProfile | null
  if (!user) {
    renderLogin(app, boot)
    return
  }
  const settings = await loadSettings()
  console.log('[osmosis:popup] main view', { email: user.email, plan: user.plan })
  renderMain(app, settings, user, () => renderSettings(app, user, boot))

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings }).catch(() => {})
}

void boot()
