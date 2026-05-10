import type { UserProfile } from '../../types'
import { clearToken, getToken } from '../../background/auth'
import { createUsageMeter } from '../components/usageMeter'
import { API_BASE_URL, FREE_TIER_LIMIT } from '../../constants'

async function apiFetch(path: string, token: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    await clearToken()
    window.location.reload()
    throw new Error('Session expired — please sign in again')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Server error (${res.status})`)
  }
  return res.json() as Promise<{ url: string }>
}

export function renderSettings(root: HTMLElement, user: UserProfile, onBack: () => void): void {
  root.replaceChildren()

  const header = document.createElement('div')
  header.className = 'header'
  const backBtn = document.createElement('button')
  backBtn.className = 'icon-btn'
  backBtn.setAttribute('aria-label', 'Back')
  backBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M15 18l-6-6 6-6"/></svg>'
  backBtn.addEventListener('click', onBack)
  const title = document.createElement('span')
  title.className = 'settings-title'
  title.textContent = 'Settings'
  header.append(backBtn, title, document.createElement('span'))

  const body = document.createElement('div')
  body.className = 'body'

  const accountLabel = document.createElement('div')
  accountLabel.className = 'field-label'
  accountLabel.textContent = 'Account'

  const accountRow = document.createElement('div')
  accountRow.className = 'settings-account-row'
  const emailEl = document.createElement('span')
  emailEl.className = 'settings-account-email'
  emailEl.textContent = user.email
  const planBadge = document.createElement('span')
  planBadge.className = user.plan === 'pro' ? 'osmo-badge osmo-badge--pro' : 'osmo-badge'
  planBadge.textContent = user.plan === 'pro' ? 'Pro ✓' : 'Free plan'
  accountRow.append(emailEl, planBadge)

  const makeDivider = () => { const hr = document.createElement('hr'); hr.className = 'osmo-divider'; return hr }

  body.append(accountLabel, accountRow, makeDivider())

  if (user.plan === 'free') {
    const limit = user.usage.limit ?? FREE_TIER_LIMIT
    body.appendChild(createUsageMeter(user.usage.used, limit, user.usage.resetsAt))

    const upgradeBtn = document.createElement('button')
    upgradeBtn.className = 'osmo-btn osmo-btn--ember'
    upgradeBtn.textContent = '✦ Upgrade to Pro — Unlimited'

    const upgradeError = document.createElement('div')
    upgradeError.className = 'settings-error'

    upgradeBtn.addEventListener('click', async () => {
      upgradeBtn.disabled = true
      upgradeBtn.textContent = 'Opening checkout…'
      upgradeError.style.display = 'none'
      try {
        const token = await getToken()
        if (!token) throw new Error('Not signed in')
        const { url } = await apiFetch('/user/checkout', token)
        await chrome.tabs.create({ url })
      } catch (err) {
        upgradeError.textContent = err instanceof Error ? err.message : 'Something went wrong. Try again.'
        upgradeError.style.display = 'block'
      } finally {
        upgradeBtn.disabled = false
        upgradeBtn.textContent = '✦ Upgrade to Pro — Unlimited'
      }
    })

    body.append(upgradeBtn, upgradeError, makeDivider())
  }

  if (user.plan === 'pro') {
    const manageBtn = document.createElement('button')
    manageBtn.className = 'osmo-btn osmo-btn--secondary'
    manageBtn.textContent = 'Manage Subscription'

    const manageError = document.createElement('div')
    manageError.className = 'settings-error'

    manageBtn.addEventListener('click', async () => {
      manageBtn.disabled = true
      manageBtn.textContent = 'Opening portal…'
      manageError.style.display = 'none'
      try {
        const token = await getToken()
        if (!token) throw new Error('Not signed in')
        const { url } = await apiFetch('/user/portal', token)
        await chrome.tabs.create({ url })
      } catch (err) {
        manageError.textContent = err instanceof Error ? err.message : 'Something went wrong. Try again.'
        manageError.style.display = 'block'
      } finally {
        manageBtn.disabled = false
        manageBtn.textContent = 'Manage Subscription'
      }
    })

    body.append(manageBtn, manageError, makeDivider())
  }

  const signOutBtn = document.createElement('button')
  signOutBtn.className = 'osmo-btn osmo-btn--danger'
  signOutBtn.textContent = 'Sign out'
  signOutBtn.addEventListener('click', async () => { await clearToken(); window.location.reload() })
  body.appendChild(signOutBtn)

  body.appendChild(makeDivider())

  const dangerToggle = document.createElement('button')
  dangerToggle.className = 'settings-danger-toggle'
  const dangerChevron = document.createElement('span')
  dangerChevron.className = 'settings-danger-chevron'
  dangerChevron.textContent = '›'
  dangerToggle.append(dangerChevron, document.createTextNode(' Danger zone'))

  const deleteSection = document.createElement('div')
  deleteSection.className = 'settings-danger-section'

  dangerToggle.addEventListener('click', () => {
    const open = deleteSection.classList.toggle('settings-danger-section--open')
    dangerChevron.style.transform = open ? 'rotate(90deg)' : ''
  })

  body.appendChild(dangerToggle)

  const deleteBtn = document.createElement('button')
  deleteBtn.className = 'osmo-btn osmo-btn--danger osmo-btn--sm'
  deleteBtn.textContent = 'Delete account'

  const confirmRow = document.createElement('div')
  confirmRow.className = 'settings-confirm-row'
  const confirmMsg = document.createElement('p')
  confirmMsg.className = 'settings-confirm-msg'
  confirmMsg.textContent = 'This permanently deletes your account and cancels any active subscription. There is no undo.'
  const confirmBtns = document.createElement('div')
  confirmBtns.className = 'settings-confirm-btns'
  const cancelDeleteBtn = document.createElement('button')
  cancelDeleteBtn.className = 'osmo-btn osmo-btn--ghost osmo-btn--sm'
  cancelDeleteBtn.style.flex = '1'
  cancelDeleteBtn.textContent = 'Cancel'
  const confirmDeleteBtn = document.createElement('button')
  confirmDeleteBtn.className = 'osmo-btn osmo-btn--danger osmo-btn--sm'
  confirmDeleteBtn.style.flex = '1'
  confirmDeleteBtn.textContent = 'Yes, delete'
  const deleteErrorEl = document.createElement('p')
  deleteErrorEl.className = 'osmo-error'
  deleteErrorEl.style.display = 'none'
  confirmBtns.append(cancelDeleteBtn, confirmDeleteBtn)
  confirmRow.append(confirmMsg, confirmBtns, deleteErrorEl)

  deleteBtn.addEventListener('click', () => {
    deleteBtn.style.display = 'none'
    confirmRow.classList.add('settings-confirm-row--open')
  })
  cancelDeleteBtn.addEventListener('click', () => {
    confirmRow.classList.remove('settings-confirm-row--open')
    deleteBtn.style.display = ''
    deleteErrorEl.style.display = 'none'
  })
  confirmDeleteBtn.addEventListener('click', async () => {
    confirmDeleteBtn.disabled = true
    cancelDeleteBtn.disabled = true
    confirmDeleteBtn.textContent = 'Deleting…'
    deleteErrorEl.style.display = 'none'
    try {
      const result = await chrome.runtime.sendMessage({ type: 'DELETE_ACCOUNT' }) as
        { ok?: boolean; error?: string } | undefined
      if (result?.error) throw new Error(result.error)
      window.location.reload()
    } catch (err) {
      deleteErrorEl.textContent = err instanceof Error ? err.message : 'Deletion failed. Try again.'
      deleteErrorEl.style.display = 'block'
    } finally {
      confirmDeleteBtn.disabled = false
      cancelDeleteBtn.disabled = false
      confirmDeleteBtn.textContent = 'Yes, delete'
    }
  })

  deleteSection.append(deleteBtn, confirmRow)
  body.appendChild(deleteSection)

  root.append(header, body)
}
