import type { UserProfile, UserSettings } from '../types'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants'
import { normalizeTargetLang } from '../languages'
import { renderLogin } from './views/login'
import { renderMain } from './views/main'
import { renderSettings } from './views/settings'

function getPopupRoot(): HTMLElement {
  const el = document.getElementById('app')
  if (!el) throw new Error('popup #app missing')
  return el
}

const app = getPopupRoot()

async function loadSettings(): Promise<UserSettings> {
  const r = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS)
  const raw = r[STORAGE_KEYS.SETTINGS] as Partial<UserSettings> | undefined
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...raw }
  return { ...merged, targetLang: normalizeTargetLang(merged.targetLang) }
}

function isUserProfile(v: unknown): v is UserProfile {
  return typeof v === 'object' && v !== null && 'email' in v && typeof (v as UserProfile).email === 'string'
}

async function boot(): Promise<void> {
  const raw = await chrome.runtime.sendMessage({ type: 'GET_USER' })
  const user = isUserProfile(raw) ? raw : null
  if (raw !== null && !isUserProfile(raw)) {
    console.warn('[osmosis:popup] GET_USER unexpected response', raw)
  }
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
