import type { UserSettings, UserProfile, SrsStats, Message } from '../../types'
import { STORAGE_KEYS } from '../../constants'
import { createToggle } from '../components/toggle'
import { createLanguagePicker } from '../components/languagePicker'
import { createSlider } from '../components/slider'
import { createCefrPicker } from '../components/cefrPicker'
import { showToast } from '../components/toast'
import { renderProgress } from './progress'
import { renderQuiz } from './quiz'

type TabId = 'home' | 'progress' | 'quiz'
type PageStats = { sampled: number; eligible: number; lang: string; cefr?: string }

// ── SVG icons ────────────────────────────────────────────────────────────────

const ICON_HOME = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 8h14M5 8l4-4M5 8l4 4M19 16H5M19 16l-4-4M19 16l-4 4"/>
</svg>`

const ICON_PROGRESS = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
  <line x1="6" y1="20" x2="6" y2="14"/>
</svg>`

const ICON_QUIZ = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
</svg>`

// ── Helpers ──────────────────────────────────────────────────────────────────

async function saveAndBroadcast(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings })
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings } as Message).catch(() => {})
}

function formatHint(stats: PageStats | undefined, lang: string): string {
  if (!stats || stats.lang !== lang) return ''
  const cefrSuffix = stats.cefr && stats.cefr !== 'all' ? ` · ${stats.cefr}+ only` : ''
  return `${stats.sampled} of ${stats.eligible} words on this page${cefrSuffix}`
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderMain(
  root: HTMLElement,
  settings: UserSettings,
  user: UserProfile,
  onSettings: () => void,
): void {
  root.replaceChildren()

  let s: UserSettings = { ...settings }
  let activeTab: TabId = 'home'

  // ── Header
  const header = document.createElement('div')
  header.className = 'header'

  const logo = document.createElement('div')
  logo.className = 'logo'
  const logoIcon = document.createElement('img')
  logoIcon.className = 'logo-icon'
  logoIcon.src = chrome.runtime.getURL('icons/icon48.png')
  logoIcon.alt = 'Osmosis'
  logo.append(logoIcon, document.createTextNode(' Osmosis'))

  const toggle = createToggle(s.enabled, enabled => { broadcast({ ...s, enabled }) })
  header.append(logo, toggle)

  // ── Tab bar
  const tabBar = document.createElement('div')
  tabBar.className = 'tab-bar'

  const tabs: Array<{ id: TabId; label: string; icon: string }> = [
    { id: 'home',     label: 'Translate', icon: ICON_HOME     },
    { id: 'progress', label: 'Progress',  icon: ICON_PROGRESS },
    { id: 'quiz',     label: 'Review',    icon: ICON_QUIZ     },
  ]

  const tabButtons = new Map<TabId, HTMLButtonElement>()
  let dueBadgeEl: HTMLSpanElement | null = null

  for (const { id, label, icon } of tabs) {
    const btn = document.createElement('button')
    btn.className = 'tab-btn'
    btn.setAttribute('aria-label', label)

    const iconWrap = document.createElement('span')
    iconWrap.innerHTML = icon
    btn.appendChild(iconWrap)

    const lbl = document.createElement('span')
    lbl.textContent = label
    btn.appendChild(lbl)

    // Due badge on the Review tab (populated async after load)
    if (id === 'quiz') {
      const badge = document.createElement('span')
      badge.className = 'tab-due-badge'
      badge.style.display = 'none'
      btn.appendChild(badge)
      dueBadgeEl = badge
    }

    btn.addEventListener('click', () => switchTab(id))
    tabButtons.set(id, btn)
    tabBar.appendChild(btn)
  }

  // ── Content area (changes on tab switch)
  const content = document.createElement('div')

  // ── Footer
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

  root.append(header, tabBar, content, footer)

  // ── Tab switching
  function switchTab(id: TabId): void {
    activeTab = id
    tabButtons.forEach((btn, tabId) => {
      btn.classList.toggle('tab-btn--active', tabId === id)
    })
    if (id === 'quiz' && dueBadgeEl) dueBadgeEl.style.display = 'none'
    switch (id) {
      case 'home':     renderHomeTab(content, s, user); break
      case 'progress': renderProgress(content, s, () => switchTab('quiz')); break
      case 'quiz':     renderQuiz(content, s); break
    }
  }

  // ── Broadcast helper (home tab)
  const hintEl = document.createElement('div')
  hintEl.className = 'osmo-hint'
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null

  function broadcast(newSettings: UserSettings): void {
    s = newSettings
    if (broadcastTimer) clearTimeout(broadcastTimer)
    void saveAndBroadcast(newSettings)
    if (!newSettings.enabled) { hintEl.textContent = ''; return }
    hintEl.textContent = 'Translating…'
    hintEl.classList.add('osmo-hint--active')
    broadcastTimer = setTimeout(() => {
      void chrome.storage.local.get(STORAGE_KEYS.PAGE_STATS).then(r => {
        const stats = r[STORAGE_KEYS.PAGE_STATS] as PageStats | undefined
        hintEl.textContent = formatHint(stats, newSettings.targetLang)
        hintEl.classList.remove('osmo-hint--active')
      })
    }, 2000)
  }

  function renderHomeTab(
    container: HTMLElement,
    currentSettings: UserSettings,
    currentUser: UserProfile,
  ): void {
    container.replaceChildren()

    const body = document.createElement('div')
    body.className = 'body'

    // Limit banner
    const limitReached = currentUser.plan === 'free'
      && currentUser.usage.limit !== null
      && currentUser.usage.used >= currentUser.usage.limit
    if (limitReached) {
      const banner = document.createElement('div')
      banner.className = 'osmo-banner osmo-banner--limit'
      const bannerText = document.createElement('span')
      bannerText.textContent = 'Monthly limit reached — translations are paused until your usage resets.'
      const upgradeLink = document.createElement('button')
      upgradeLink.className = 'osmo-banner__action'
      upgradeLink.textContent = 'Upgrade to Pro for unlimited translations →'
      upgradeLink.addEventListener('click', onSettings)
      banner.append(bannerText, upgradeLink)
      body.appendChild(banner)
    }

    // Language picker
    const langLabel = document.createElement('div')
    langLabel.className = 'field-label'
    langLabel.textContent = 'Translate to'
    const langWrapper = document.createElement('div')
    langWrapper.append(langLabel, createLanguagePicker(s.targetLang, targetLang => {
      broadcast({ ...s, targetLang })
      showToast(`Translating to ${targetLang.toUpperCase()}`, 'info')
    }))

    // CEFR level picker
    const cefrLabel = document.createElement('div')
    cefrLabel.className = 'field-label'
    cefrLabel.textContent = 'Word level'
    const cefrWrapper = document.createElement('div')
    cefrWrapper.append(cefrLabel, createCefrPicker(s.cefrMinLevel ?? 'all', cefrMinLevel => {
      broadcast({ ...s, cefrMinLevel })
    }))

    // Slider
    const sliderEl = createSlider(s.percentage, percentage => { broadcast({ ...s, percentage }) })

    if (s.enabled) {
      void chrome.storage.local.get(STORAGE_KEYS.PAGE_STATS).then(r => {
        const stats = r[STORAGE_KEYS.PAGE_STATS] as PageStats | undefined
        hintEl.textContent = formatHint(stats, s.targetLang)
      })
    }

    body.append(langWrapper, cefrWrapper, sliderEl, hintEl)
    container.appendChild(body)

    // Onboarding callout
    void chrome.storage.local.get(STORAGE_KEYS.ONBOARDED).then(r => {
      if (r[STORAGE_KEYS.ONBOARDED]) return
      void chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDED]: true })
      const callout = document.createElement('div')
      callout.className = 'osmo-banner osmo-banner--onboard'
      const calloutText = document.createElement('span')
      calloutText.textContent = 'Open any webpage and Osmosis will start translating words. Hover highlighted words to see translations and rate them to start learning.'
      const dismissBtn = document.createElement('button')
      dismissBtn.className = 'osmo-banner__action'
      dismissBtn.textContent = 'Got it ✓'
      dismissBtn.addEventListener('click', () => { callout.remove(); showToast("You're all set!") })
      callout.append(calloutText, dismissBtn)
      body.insertBefore(callout, limitReached ? body.children[1] ?? null : body.firstChild)
    })
  }

  // ── Initial render
  switchTab('home')

  // ── Load review badge (non-blocking)
  void chrome.runtime.sendMessage({
    type: 'SRS_GET_STATS',
    targetLang: s.targetLang,
  } as Message)
    .then(res => {
      const stats = res as (SrsStats & { error?: string }) | undefined
      if (!stats || stats.error || !dueBadgeEl) return
      if (stats.reviewReady) {
        dueBadgeEl.textContent = stats.dueCount > 0
          ? (stats.dueCount > 99 ? '99+' : stats.dueCount.toString())
          : '!'
        dueBadgeEl.style.display = 'flex'
      }
    })
    .catch(() => { /* badge is optional */ })
}
