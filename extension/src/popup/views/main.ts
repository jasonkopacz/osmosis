import type { UserSettings, UserProfile, Message } from '../../types'
import { STORAGE_KEYS } from '../../constants'
import { createToggle } from '../components/toggle'
import { createLanguagePicker } from '../components/languagePicker'
import { createSlider } from '../components/slider'

async function saveAndBroadcast(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings })
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings } as Message).catch(() => {})
}

export function renderMain(
  root: HTMLElement,
  settings: UserSettings,
  user: UserProfile,
  onSettings: () => void
): void {
  root.replaceChildren()

  let s: UserSettings = { ...settings }

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
    s = { ...s, enabled }
    void saveAndBroadcast(s)
  })
  header.append(logo, toggle)

  const body = document.createElement('div')
  body.className = 'body'

  const langLabel = document.createElement('div')
  langLabel.className = 'field-label'
  langLabel.textContent = 'Translate to'

  const langWrapper = document.createElement('div')
  langWrapper.append(
    langLabel,
    createLanguagePicker(s.targetLang, targetLang => {
      s = { ...s, targetLang }
      void saveAndBroadcast(s)
    })
  )

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

  body.append(
    langWrapper,
    createSlider(s.percentage, percentage => {
      s = { ...s, percentage }
      void saveAndBroadcast(s)
    })
  )

  const footer = document.createElement('div')
  footer.className = 'footer'
  const emailSpan = document.createElement('span')
  emailSpan.className = 'footer-email'
  emailSpan.textContent = user.email
  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'icon-btn'
  settingsBtn.textContent = '⚙️'
  settingsBtn.title = 'Settings'
  settingsBtn.addEventListener('click', onSettings)
  footer.append(emailSpan, settingsBtn)

  root.append(header, body, footer)
}
