import type { UserProfile } from '../../shared/types'
import { clearToken, getToken } from '../../background/auth'
import { createUsageMeter } from '../components/usageMeter'
import { API_BASE_URL, FREE_TIER_LIMIT } from '../../shared/constants'

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
    upgradeBtn.addEventListener('click', async () => {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`${API_BASE_URL}/user/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        console.warn('[osmosis:popup] checkout failed', res.status)
        return
      }
      const { url } = (await res.json()) as { url: string }
      await chrome.tabs.create({ url })
    })
    body.append(upgradeBtn, divider())
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
