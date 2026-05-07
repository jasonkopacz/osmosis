import type { UserSettings, UserProfile, Message } from '../../types'
import { STORAGE_KEYS } from '../../constants'
import { createToggle } from '../components/toggle'
import { createLanguagePicker } from '../components/languagePicker'
import { createSlider } from '../components/slider'
import { showToast } from '../components/toast'

type PageStats = { sampled: number; eligible: number; lang: string }

async function saveAndBroadcast(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings })
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings } as Message).catch(() => {})
}

function formatHint(stats: PageStats | undefined, lang: string): string {
  if (!stats || stats.lang !== lang) return ''
  return `${stats.sampled} of ${stats.eligible} words on this page`
}

export function renderMain(
  root: HTMLElement,
  settings: UserSettings,
  user: UserProfile,
  onSettings: () => void
): void {
  root.replaceChildren()

  let s: UserSettings = { ...settings }

  // --- hint element (declared early so broadcast can reference it) ---
  const hintEl = document.createElement('div')
  hintEl.style.cssText = 'font-size:10px;color:#718096;text-align:center;min-height:14px;margin-top:-6px;'

  let broadcastTimer: ReturnType<typeof setTimeout> | null = null

  function broadcast(newSettings: UserSettings): void {
    s = newSettings
    hintEl.textContent = 'Translating…'
    hintEl.style.color = '#67e8f9'
    if (broadcastTimer) clearTimeout(broadcastTimer)
    void saveAndBroadcast(newSettings)
    broadcastTimer = setTimeout(() => {
      void chrome.storage.local.get(STORAGE_KEYS.PAGE_STATS).then(r => {
        const stats = r[STORAGE_KEYS.PAGE_STATS] as PageStats | undefined
        hintEl.textContent = formatHint(stats, newSettings.targetLang)
        hintEl.style.color = '#718096'
      })
    }, 2000)
  }

  // --- header ---
  const header = document.createElement('div')
  header.className = 'header'

  const logo = document.createElement('div')
  logo.className = 'logo'
  const logoIcon = document.createElement('img')
  logoIcon.className = 'logo-icon'
  logoIcon.src = chrome.runtime.getURL('icons/icon48.png')
  logoIcon.alt = 'Osmosis'
  logo.append(logoIcon, document.createTextNode(' Osmosis'))

  const toggle = createToggle(s.enabled, enabled => {
    broadcast({ ...s, enabled })
  })
  header.append(logo, toggle)

  // --- body ---
  const body = document.createElement('div')
  body.className = 'body'

  // Limit-reached banner
  const limitReached = user.plan === 'free' && user.usage.limit !== null && user.usage.used >= user.usage.limit
  if (limitReached) {
    const banner = document.createElement('div')
    banner.style.cssText =
      'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:10px;' +
      'padding:9px 12px;font-size:12px;color:#fca5a5;line-height:1.5;display:flex;flex-direction:column;gap:5px;'
    const bannerText = document.createElement('span')
    bannerText.textContent = 'Monthly limit reached — translations are paused until your usage resets.'
    const upgradeLink = document.createElement('button')
    upgradeLink.textContent = 'Upgrade to Pro for unlimited translations →'
    upgradeLink.style.cssText =
      'background:none;border:none;color:#22d3ee;font-size:11px;font-weight:700;cursor:pointer;' +
      'padding:0;text-align:left;text-decoration:underline;'
    upgradeLink.addEventListener('click', onSettings)
    banner.append(bannerText, upgradeLink)
    body.appendChild(banner)
  }

  // Language picker
  const langLabel = document.createElement('div')
  langLabel.className = 'field-label'
  langLabel.textContent = 'Translate to'
  const langWrapper = document.createElement('div')
  langWrapper.append(
    langLabel,
    createLanguagePicker(s.targetLang, targetLang => {
      broadcast({ ...s, targetLang })
      showToast(`Translating to ${targetLang.toUpperCase()}`, 'info')
    })
  )

  // Slider + hint
  const sliderEl = createSlider(s.percentage, percentage => {
    broadcast({ ...s, percentage })
  })

  // Load initial hint from storage
  void chrome.storage.local.get(STORAGE_KEYS.PAGE_STATS).then(r => {
    const stats = r[STORAGE_KEYS.PAGE_STATS] as PageStats | undefined
    hintEl.textContent = formatHint(stats, s.targetLang)
  })

  body.append(langWrapper, sliderEl, hintEl)

  // --- footer ---
  const footer = document.createElement('div')
  footer.className = 'footer'
  const emailSpan = document.createElement('span')
  emailSpan.className = 'footer-email'
  emailSpan.textContent = user.email
  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'icon-btn'
  settingsBtn.title = 'Settings'
  settingsBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
    '</svg>'
  settingsBtn.addEventListener('click', onSettings)
  footer.append(emailSpan, settingsBtn)

  root.append(header, body, footer)

  // --- first-time onboarding callout ---
  void chrome.storage.local.get(STORAGE_KEYS.ONBOARDED).then(r => {
    if (r[STORAGE_KEYS.ONBOARDED]) return
    void chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDED]: true })

    const callout = document.createElement('div')
    callout.style.cssText =
      'background:rgba(6,182,212,0.08);border:1px solid rgba(34,211,238,0.3);border-radius:10px;' +
      'padding:10px 12px;font-size:12px;color:#a5f3fc;line-height:1.5;' +
      'display:flex;flex-direction:column;gap:6px;'
    const calloutText = document.createElement('span')
    calloutText.textContent = 'Open any webpage and Osmosis will start translating words for you. Hover over highlighted words to see the original.'
    const dismissBtn = document.createElement('button')
    dismissBtn.textContent = 'Got it ✓'
    dismissBtn.style.cssText =
      'background:none;border:none;color:#22d3ee;font-size:11px;font-weight:700;' +
      'cursor:pointer;padding:0;text-align:left;'
    dismissBtn.addEventListener('click', () => {
      callout.remove()
      showToast('You\'re all set!')
    })
    callout.append(calloutText, dismissBtn)
    // Insert at the top of body, after any limit banner
    body.insertBefore(callout, limitReached ? body.children[1] ?? null : body.firstChild)
  })
}
