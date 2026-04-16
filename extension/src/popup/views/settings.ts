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
  backBtn.style.fontSize = '13px'
  backBtn.textContent = '← Back'
  backBtn.addEventListener('click', onBack)
  const title = document.createElement('span')
  title.style.cssText = 'font-weight:600;color:#e2e8f0;'
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
  emailEl.style.cssText = 'font-size:13px;color:#a0aec0;overflow:hidden;text-overflow:ellipsis;max-width:180px;'
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

  const signOutRow = document.createElement('div')
  signOutRow.style.cssText = 'display:flex;justify-content:flex-end;'
  const signOutBtn = document.createElement('button')
  signOutBtn.style.cssText = 'background:none;border:none;color:#ef4444;font-size:12px;cursor:pointer;'
  signOutBtn.textContent = 'Sign out'
  signOutBtn.addEventListener('click', async () => {
    await clearToken()
    window.location.reload()
  })
  signOutRow.appendChild(signOutBtn)
  body.appendChild(signOutRow)

  root.append(header, body)
}
