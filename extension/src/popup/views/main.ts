import type { UserSettings, UserProfile, Message } from '../../shared/types'
import { STORAGE_KEYS } from '../../shared/constants'
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
