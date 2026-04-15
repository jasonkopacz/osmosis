import { login, signup } from '../../background/api'
import { setToken } from '../../background/auth'

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.replaceChildren()
  let mode: 'login' | 'signup' = 'login'

  const body = document.createElement('div')
  body.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:12px;'

  const title = document.createElement('h3')
  title.style.cssText = 'font-size:15px;font-weight:600;color:#e2e8f0;text-align:center;'
  title.textContent = 'Sign in to Osmosis'

  const inputStyle = 'background:#2d3748;border:1px solid #4a5568;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;width:100%;outline:none;'

  const emailInput = document.createElement('input')
  emailInput.type = 'email'
  emailInput.placeholder = 'Email'
  emailInput.style.cssText = inputStyle

  const passwordInput = document.createElement('input')
  passwordInput.type = 'password'
  passwordInput.placeholder = 'Password (min 8 chars)'
  passwordInput.style.cssText = inputStyle

  const errorEl = document.createElement('p')
  errorEl.style.cssText = 'color:#ef4444;font-size:12px;text-align:center;min-height:16px;'

  // Show any error that occurred while popup was closed (e.g. during Google auth)
  void chrome.storage.local.get('osmosis_auth_error').then(r => {
    const err = r['osmosis_auth_error'] as string | undefined
    if (err) {
      errorEl.textContent = err
      void chrome.storage.local.remove('osmosis_auth_error')
    }
  })

  // If token is saved while popup is open (background completed auth), auto-advance
  const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && 'osmosis_token' in changes && changes['osmosis_token'].newValue) {
      chrome.storage.onChanged.removeListener(onStorageChange)
      onSuccess()
    }
  }
  chrome.storage.onChanged.addListener(onStorageChange)

  const submitBtn = document.createElement('button')
  submitBtn.style.cssText = 'background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;border:none;border-radius:8px;padding:9px;width:100%;font-size:13px;font-weight:600;cursor:pointer;'
  submitBtn.textContent = 'Sign In'

  const googleBtn = document.createElement('button')
  googleBtn.type = 'button'
  googleBtn.textContent = 'Continue with Google'
  googleBtn.style.cssText =
    'background:#fff;color:#1f2937;border:1px solid #e2e8f0;border-radius:8px;padding:9px;width:100%;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;'

  googleBtn.addEventListener('click', async () => {
    errorEl.textContent = ''
    googleBtn.disabled = true
    googleBtn.textContent = 'Waiting for Google sign-in…'
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GOOGLE_LOGIN' }) as { token?: string; error?: string } | undefined
      // If result is undefined the popup closed mid-flow; storage listener handles success.
      if (!result) return
      if (result.error) throw new Error(result.error)
      if (result.token) {
        chrome.storage.onChanged.removeListener(onStorageChange)
        onSuccess()
      }
    } catch (e) {
      const msg = String(e).replace('Error: ', '')
      // Swallow "port closed" — storage listener will handle success if it completed
      if (!msg.includes('message port closed') && !msg.includes('receiving end does not exist')) {
        errorEl.textContent = msg
      }
    } finally {
      googleBtn.disabled = false
      googleBtn.textContent = 'Continue with Google'
    }
  })

  const switchLink = document.createElement('p')
  switchLink.style.cssText = 'font-size:12px;color:#718096;text-align:center;cursor:pointer;'
  switchLink.textContent = "Don't have an account? Sign up"

  switchLink.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login'
    title.textContent = mode === 'login' ? 'Sign in to Osmosis' : 'Create your account'
    submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account'
    switchLink.textContent =
      mode === 'login'
        ? "Don't have an account? Sign up"
        : 'Already have an account? Sign in'
  })

  submitBtn.addEventListener('click', async () => {
    errorEl.textContent = ''
    submitBtn.disabled = true
    submitBtn.textContent = '...'
    try {
      const token =
        mode === 'login'
          ? await login(emailInput.value, passwordInput.value)
          : await signup(emailInput.value, passwordInput.value)
      await setToken(token)
      console.log('[osmosis:popup] session saved')
      onSuccess()
    } catch (e) {
      errorEl.textContent = String(e).replace('Error: ', '')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account'
    }
  })

  body.append(title, emailInput, passwordInput, errorEl, submitBtn, googleBtn, switchLink)
  root.appendChild(body)
}
