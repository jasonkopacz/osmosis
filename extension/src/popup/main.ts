import './styles/tokens.css'
import './styles/base.css'
import './styles/chrome.css'
import './styles/components.css'
import './styles/login.css'
import './styles/settings.css'
import './styles/progress.css'
import './styles/quiz.css'
import type { UserProfile, UserSettings, Message } from '../types'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants'
import { normalizeTargetLang } from '../languages'
import { renderLogin } from './views/login'
import { renderMain } from './views/main'
import { renderSettings } from './views/settings'
import { log, warn } from '../logger'

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

async function consumeVerifySessionFromHash(): Promise<void> {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.includes('osmosis_session=')) return
  const params = new URLSearchParams(hash)
  const token = params.get('osmosis_session')
  if (!token) return
  const refreshToken = params.get('osmosis_refresh') ?? undefined
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  log('[osmosis:popup] applying session from email verification link')
  const res = await chrome.runtime.sendMessage(
    { type: 'SESSION_FROM_VERIFY', token, refreshToken } as Message,
  ) as { token?: string; error?: string } | undefined
  if (res?.error) warn('[osmosis:popup] SESSION_FROM_VERIFY', res.error)
}

async function boot(): Promise<void> {
  await consumeVerifySessionFromHash()
  const raw = await chrome.runtime.sendMessage({ type: 'GET_USER' })
  const user = isUserProfile(raw) ? raw : null
  if (raw !== null && !isUserProfile(raw)) {
    warn('[osmosis:popup] GET_USER unexpected response', raw)
  }
  if (!user) {
    renderLogin(app, boot)
    return
  }
  const settings = await loadSettings()
  log('[osmosis:popup] main view', { email: user.email, plan: user.plan })
  renderMain(app, settings, user, () => renderSettings(app, user, boot))
}

void boot()
