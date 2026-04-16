export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.replaceChildren()

  const body = document.createElement('div')
  body.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:12px;'

  const title = document.createElement('h3')
  title.style.cssText = 'font-size:15px;font-weight:600;color:#e2e8f0;text-align:center;'
  title.textContent = 'Sign in to Osmosis'

  const errorEl = document.createElement('p')
  errorEl.style.cssText = 'color:#ef4444;font-size:12px;text-align:center;min-height:16px;'

  const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && 'osmosis_token' in changes && changes['osmosis_token'].newValue) {
      chrome.storage.onChanged.removeListener(onStorageChange)
      onSuccess()
    }
  }
  chrome.storage.onChanged.addListener(onStorageChange)

  const googleBtn = document.createElement('button')
  googleBtn.type = 'button'
  googleBtn.textContent = 'Continue with Google'
  googleBtn.style.cssText =
    'background:#fff;color:#1f2937;border:1px solid #e2e8f0;border-radius:8px;padding:9px;width:100%;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;'

  const hint = document.createElement('p')
  hint.style.cssText = 'font-size:11px;color:#718096;text-align:center;margin:0;'
  hint.textContent = 'New accounts are created automatically when you sign in with Google.'

  googleBtn.addEventListener('click', async () => {
    errorEl.textContent = ''
    googleBtn.disabled = true
    googleBtn.textContent = 'Waiting for Google sign-in…'
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GOOGLE_LOGIN' }) as { token?: string; error?: string } | undefined
      if (!result) return
      if (result.error) throw new Error(result.error)
      if (result.token) {
        chrome.storage.onChanged.removeListener(onStorageChange)
        onSuccess()
      }
    } catch (e) {
      const msg = String(e).replace('Error: ', '')
      if (!msg.includes('message port closed') && !msg.includes('receiving end does not exist')) {
        errorEl.textContent = msg
      }
    } finally {
      googleBtn.disabled = false
      googleBtn.textContent = 'Continue with Google'
    }
  })

  body.append(title, errorEl, googleBtn, hint)
  root.appendChild(body)
}
