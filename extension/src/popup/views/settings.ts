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
  title.style.cssText = 'font-weight:600;font-size:14px;color:#e2e8f0;'
  title.textContent = 'Settings'
  header.append(backBtn, title, document.createElement('span'))

  const body = document.createElement('div')
  body.className = 'body'

  const accountLabel = document.createElement('div')
  accountLabel.className = 'field-label'
  accountLabel.textContent = 'Account'

  const accountRow = document.createElement('div')
  accountRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
  const emailEl = document.createElement('span')
  emailEl.style.cssText = 'font-size:13px;color:#a0aec0;overflow:hidden;text-overflow:ellipsis;max-width:150px;'
  emailEl.textContent = user.email
  const planBadge = document.createElement('span')
  planBadge.style.cssText = 'background:#2d3748;padding:2px 8px;border-radius:999px;font-size:11px;color:#a0aec0;'
  planBadge.textContent = user.plan === 'pro' ? 'Pro ✓' : 'Free plan'
  accountRow.append(emailEl, planBadge)

  const divider = () => {
    const hr = document.createElement('hr')
    hr.style.cssText = 'border:none;border-top:1px solid #2d3748;'
    return hr
  }

  body.append(accountLabel, accountRow, divider())

  if (user.plan === 'free') {
    const limit = user.usage.limit ?? FREE_TIER_LIMIT
    body.appendChild(createUsageMeter(user.usage.used, limit, user.usage.resetsAt))

    const upgradeBtn = document.createElement('button')
    upgradeBtn.style.cssText =
      'background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;border:none;border-radius:8px;padding:10px;width:100%;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;'
    upgradeBtn.textContent = '✦ Upgrade to Pro — Unlimited'

    const upgradeError = document.createElement('div')
    upgradeError.style.cssText = 'color:#ef4444;font-size:11px;text-align:center;margin-top:4px;display:none;'

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
        console.warn('[osmosis:popup] checkout failed', err)
        upgradeError.textContent = err instanceof Error ? err.message : 'Something went wrong. Try again.'
        upgradeError.style.display = 'block'
      } finally {
        upgradeBtn.disabled = false
        upgradeBtn.textContent = '✦ Upgrade to Pro — Unlimited'
      }
    })

    body.append(upgradeBtn, upgradeError, divider())
  }

  if (user.plan === 'pro') {
    const manageBtn = document.createElement('button')
    manageBtn.style.cssText =
      'background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;border:none;border-radius:8px;padding:10px;width:100%;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;'
    manageBtn.textContent = 'Manage Subscription'

    const manageError = document.createElement('div')
    manageError.style.cssText = 'color:#ef4444;font-size:11px;text-align:center;margin-top:4px;display:none;'

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
        console.warn('[osmosis:popup] portal failed', err)
        manageError.textContent = err instanceof Error ? err.message : 'Something went wrong. Try again.'
        manageError.style.display = 'block'
      } finally {
        manageBtn.disabled = false
        manageBtn.textContent = 'Manage Subscription'
      }
    })

    body.append(manageBtn, manageError, divider())
  }

  const signOutBtn = document.createElement('button')
  signOutBtn.style.cssText =
    'background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border:none;border-radius:8px;' +
    'padding:10px;width:100%;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;'
  signOutBtn.textContent = 'Sign out'
  signOutBtn.addEventListener('click', async () => {
    await clearToken()
    window.location.reload()
  })
  body.appendChild(signOutBtn)

  // Collapsible danger zone
  body.appendChild(divider())

  const dangerToggle = document.createElement('button')
  dangerToggle.style.cssText =
    'background:none;border:none;display:flex;align-items:center;gap:4px;' +
    'color:#4a5568;font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;cursor:pointer;padding:0;'
  const dangerChevron = document.createElement('span')
  dangerChevron.textContent = '›'
  dangerChevron.style.cssText = 'font-size:14px;transition:transform 0.15s;display:inline-block;'
  dangerToggle.append(dangerChevron, document.createTextNode(' Danger zone'))

  const deleteSection = document.createElement('div')
  deleteSection.style.cssText = 'display:none;flex-direction:column;gap:6px;margin-top:6px;'

  dangerToggle.addEventListener('click', () => {
    const open = deleteSection.style.display === 'flex'
    deleteSection.style.display = open ? 'none' : 'flex'
    dangerChevron.style.transform = open ? '' : 'rotate(90deg)'
  })

  body.appendChild(dangerToggle)

  const deleteBtn = document.createElement('button')
  deleteBtn.style.cssText =
    'background:none;border:1px solid rgba(239,68,68,0.4);color:#ef4444;border-radius:8px;' +
    'padding:8px;width:100%;font-size:12px;font-weight:600;cursor:pointer;'
  deleteBtn.textContent = 'Delete account'

  const confirmRow = document.createElement('div')
  confirmRow.style.cssText = 'display:none;flex-direction:column;gap:6px;'
  const confirmMsg = document.createElement('p')
  confirmMsg.style.cssText = 'margin:0;font-size:11px;color:#fca5a5;line-height:1.4;'
  confirmMsg.textContent = 'This permanently deletes your account and cancels any active subscription. There is no undo.'
  const confirmBtns = document.createElement('div')
  confirmBtns.style.cssText = 'display:flex;gap:6px;'
  const cancelDeleteBtn = document.createElement('button')
  cancelDeleteBtn.style.cssText =
    'flex:1;background:none;border:1px solid rgba(103,232,249,0.25);color:#94a3b8;' +
    'border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;'
  cancelDeleteBtn.textContent = 'Cancel'
  const confirmDeleteBtn = document.createElement('button')
  confirmDeleteBtn.style.cssText =
    'flex:1;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.5);color:#ef4444;' +
    'border-radius:8px;padding:7px;font-size:12px;font-weight:700;cursor:pointer;'
  confirmDeleteBtn.textContent = 'Yes, delete'
  const deleteErrorEl = document.createElement('p')
  deleteErrorEl.style.cssText = 'display:none;color:#fca5a5;font-size:11px;margin:0;'
  confirmBtns.append(cancelDeleteBtn, confirmDeleteBtn)
  confirmRow.append(confirmMsg, confirmBtns, deleteErrorEl)

  deleteBtn.addEventListener('click', () => {
    deleteBtn.style.display = 'none'
    confirmRow.style.display = 'flex'
  })
  cancelDeleteBtn.addEventListener('click', () => {
    confirmRow.style.display = 'none'
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
