import type { Message } from '../../types'

type Mode = 'signin' | 'signup'

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.replaceChildren()

  let mode: Mode = 'signin'

  const wrap = document.createElement('div')
  wrap.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:12px;'

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div')
  tabBar.style.cssText = 'display:flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid #2d3748;'

  const signinTab = makeTab('Sign in', true)
  const signupTab = makeTab('Create account', false)
  tabBar.append(signinTab, signupTab)

  // ── Inputs ────────────────────────────────────────────────────────────────
  const emailInput = makeInput('email', 'Email address', 'text')
  const passwordInput = makeInput('password', 'Password', 'password')

  const hintEl = document.createElement('p')
  hintEl.style.cssText = 'font-size:11px;color:#718096;margin:0;'
  hintEl.textContent = 'Minimum 8 characters'

  const errorEl = document.createElement('p')
  errorEl.style.cssText = 'color:#ef4444;font-size:12px;min-height:16px;margin:0;'

  // ── Submit button ─────────────────────────────────────────────────────────
  const submitBtn = document.createElement('button')
  submitBtn.type = 'button'
  submitBtn.style.cssText =
    'background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:9px;width:100%;' +
    'font-size:13px;font-weight:600;cursor:pointer;'
  submitBtn.textContent = 'Sign in'

  // ── Divider ───────────────────────────────────────────────────────────────
  const divider = document.createElement('div')
  divider.style.cssText = 'display:flex;align-items:center;gap:8px;'
  const line = () => {
    const l = document.createElement('div')
    l.style.cssText = 'flex:1;height:1px;background:#2d3748;'
    return l
  }
  const orSpan = document.createElement('span')
  orSpan.style.cssText = 'font-size:11px;color:#718096;'
  orSpan.textContent = 'or'
  divider.append(line(), orSpan, line())

  // ── Google button ─────────────────────────────────────────────────────────
  const googleBtn = document.createElement('button')
  googleBtn.type = 'button'
  googleBtn.textContent = 'Continue with Google'
  googleBtn.style.cssText =
    'background:#fff;color:#1f2937;border:1px solid #e2e8f0;border-radius:8px;padding:9px;width:100%;' +
    'font-size:13px;font-weight:600;cursor:pointer;'

  // ── Tab switching ─────────────────────────────────────────────────────────
  function setMode(m: Mode): void {
    mode = m
    const isSignin = m === 'signin'
    setActiveTab(signinTab, isSignin)
    setActiveTab(signupTab, !isSignin)
    submitBtn.textContent = isSignin ? 'Sign in' : 'Create account'
    hintEl.style.display = isSignin ? 'none' : ''
    errorEl.textContent = ''
  }

  signinTab.addEventListener('click', () => setMode('signin'))
  signupTab.addEventListener('click', () => setMode('signup'))
  setMode('signin')

  // ── Form submit ───────────────────────────────────────────────────────────
  async function submit(): Promise<void> {
    const email = emailInput.value.trim()
    const password = passwordInput.value
    errorEl.textContent = ''

    if (!email) { errorEl.textContent = 'Email is required'; return }
    if (!password) { errorEl.textContent = 'Password is required'; return }
    if (mode === 'signup' && password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters'; return
    }

    submitBtn.disabled = true
    submitBtn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…'

    try {
      const msgType = mode === 'signin' ? 'EMAIL_LOGIN' : 'EMAIL_SIGNUP'
      const result = await chrome.runtime.sendMessage(
        { type: msgType, email, password } as Message
      ) as { token?: string; error?: string } | undefined

      if (!result) throw new Error('Service worker not responding — try reloading')
      if (result.error) throw new Error(result.error)
      onSuccess()
    } catch (e) {
      errorEl.textContent = String(e).replace('Error: ', '')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = mode === 'signin' ? 'Sign in' : 'Create account'
    }
  }

  submitBtn.addEventListener('click', () => void submit())
  emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })
  passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })

  // ── Google flow ───────────────────────────────────────────────────────────
  googleBtn.addEventListener('click', async () => {
    errorEl.textContent = ''
    googleBtn.disabled = true
    googleBtn.textContent = 'Waiting for Google sign-in…'
    try {
      const result = await chrome.runtime.sendMessage(
        { type: 'GOOGLE_LOGIN' } as Message
      ) as { token?: string; error?: string } | undefined
      if (!result) return
      if (result.error) throw new Error(result.error)
      onSuccess()
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

  wrap.append(tabBar, emailInput, passwordInput, hintEl, errorEl, submitBtn, divider, googleBtn)
  root.appendChild(wrap)
}

function makeTab(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.style.cssText =
    'flex:1;padding:8px 4px;font-size:12px;font-weight:600;border:none;cursor:pointer;transition:background 0.1s;'
  setActiveTab(btn, active)
  return btn
}

function setActiveTab(btn: HTMLButtonElement, active: boolean): void {
  btn.style.background = active ? '#3b82f6' : '#1a202c'
  btn.style.color = active ? '#fff' : '#718096'
}

function makeInput(name: string, placeholder: string, type: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  input.name = name
  input.placeholder = placeholder
  input.autocomplete = name === 'email' ? 'email' : type === 'password' ? 'current-password' : 'off'
  input.style.cssText =
    'background:#2d3748;color:#e2e8f0;border:1px solid #4a5568;border-radius:8px;' +
    'padding:9px 10px;width:100%;font-size:13px;outline:none;'
  input.addEventListener('focus', () => { input.style.borderColor = '#3b82f6' })
  input.addEventListener('blur', () => { input.style.borderColor = '#4a5568' })
  return input
}
