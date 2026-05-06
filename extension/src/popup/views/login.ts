import type { Message } from '../../types'
import heroImage from '../assets/osmosis-hero.png'

type Mode = 'signin' | 'signup'

const C = {
  border: 'rgba(45,212,191,0.35)',
  borderFocus: '#22d3ee',
  borderError: 'rgba(248,113,113,0.95)',
  textMuted: 'rgba(165,243,252,0.75)',
  glass: 'linear-gradient(165deg, rgba(6,78,95,0.55) 0%, rgba(2,6,23,0.72) 100%)',
} as const

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.replaceChildren()

  let mode: Mode = 'signin'

  const wrap = document.createElement('div')
  wrap.style.cssText =
    'display:flex;flex-direction:column;flex:0 0 auto;' +
    'background:linear-gradient(180deg, rgba(8,47,73,0.35) 0%, rgba(2,6,23,0.92) 55%, #020617 100%);'

  const hero = document.createElement('div')
  hero.style.cssText =
    'position:relative;flex-shrink:0;overflow:hidden;border-bottom:1px solid rgba(34,211,238,0.2);background:rgba(2,6,23,0.7);'

  const heroImg = document.createElement('img')
  heroImg.src = heroImage
  heroImg.alt = 'Osmosis — language learning'
  heroImg.style.cssText =
    'width:100%;height:76px;display:block;object-fit:cover;object-position:50% 28%;'

  const heroOverlay = document.createElement('div')
  heroOverlay.style.cssText =
    'position:absolute;inset:0;' +
    'background:linear-gradient(180deg, rgba(2,6,23,0.04) 0%, rgba(2,6,23,0.35) 70%, rgba(2,6,23,0.82) 100%);' +
    'pointer-events:none;'

  hero.append(heroImg, heroOverlay)

  const card = document.createElement('section')
  card.style.cssText =
    'display:flex;flex-direction:column;gap:5px;flex-shrink:0;margin:8px 10px 10px;padding:10px 12px 12px;border-radius:16px;' +
    `background:${C.glass};` +
    'border:1px solid rgba(103,232,249,0.22);' +
    'box-shadow:0 18px 48px rgba(2,6,23,0.55), inset 0 1px 0 rgba(224,242,254,0.08);' +
    'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);'

  const titleBlock = document.createElement('div')
  titleBlock.style.cssText = 'display:flex;flex-direction:column;gap:2px;'
  const title = document.createElement('h1')
  title.style.cssText = 'margin:0;font-size:16px;font-weight:700;color:#f0fdfa;letter-spacing:-0.01em;'
  title.textContent = 'Welcome'
  const subtitle = document.createElement('p')
  subtitle.style.cssText = `margin:0;font-size:11px;color:${C.textMuted};line-height:1.3;`
  subtitle.textContent = 'Sign in to translate the web with Osmosis.'
  titleBlock.append(title, subtitle)

  const tabBar = document.createElement('div')
  tabBar.style.cssText =
    'display:flex;gap:3px;padding:3px;border-radius:12px;background:rgba(2,6,23,0.45);border:1px solid rgba(45,212,191,0.2);'

  const signinTab = makeTab('Sign in', true)
  const signupTab = makeTab('Create account', false)
  tabBar.append(signinTab, signupTab)

  const emailInput = makeInput('email', 'you@example.com', 'text')
  const emailField = makeLabeledField('Email', emailInput)

  const passwordInput = makeInput('password', '••••••••', 'password')
  const pwdShell = document.createElement('div')
  pwdShell.style.cssText = 'position:relative;display:flex;align-items:center;'
  passwordInput.style.paddingRight = '52px'
  const pwdToggle = document.createElement('button')
  pwdToggle.type = 'button'
  pwdToggle.textContent = 'Show'
  pwdToggle.setAttribute('aria-label', 'Show password')
  pwdToggle.style.cssText =
    'position:absolute;right:10px;background:transparent;border:none;' +
    `color:${C.borderFocus};font-size:11px;font-weight:700;cursor:pointer;padding:4px 2px;`
  pwdToggle.addEventListener('click', () => {
    const show = passwordInput.type === 'password'
    passwordInput.type = show ? 'text' : 'password'
    pwdToggle.textContent = show ? 'Hide' : 'Show'
    pwdToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
  })
  pwdShell.append(passwordInput, pwdToggle)
  const passwordField = makeLabeledField('Password', pwdShell)

  const hintEl = document.createElement('p')
  hintEl.style.cssText = `font-size:10px;color:${C.textMuted};margin:0 2px;line-height:1.3;`
  hintEl.textContent = 'Password must be at least 8 characters.'

  const errorEl = document.createElement('p')
  errorEl.style.cssText = 'color:#fecaca;font-size:11px;min-height:14px;margin:0 2px;line-height:1.3;'

  const submitBtn = document.createElement('button')
  submitBtn.type = 'button'
  submitBtn.style.cssText =
    'background:linear-gradient(92deg, #06b6d4 0%, #22d3ee 42%, #f59e0b 100%);' +
    'color:#042f2e;border:none;border-radius:12px;padding:9px 10px;width:100%;' +
    'font-size:13px;font-weight:800;cursor:pointer;letter-spacing:0.01em;' +
    'box-shadow:0 10px 28px rgba(6,182,212,0.35);transition:transform .12s ease, filter .12s ease;'
  submitBtn.textContent = 'Sign in'
  submitBtn.addEventListener('mouseenter', () => {
    if (!submitBtn.disabled) {
      submitBtn.style.transform = 'translateY(-1px)'
      submitBtn.style.filter = 'brightness(1.05)'
    }
  })
  submitBtn.addEventListener('mouseleave', () => {
    submitBtn.style.transform = 'translateY(0)'
    submitBtn.style.filter = 'none'
  })

  const divider = document.createElement('div')
  divider.style.cssText = 'display:flex;align-items:center;gap:8px;padding-top:0;'
  const line = (): HTMLDivElement => {
    const l = document.createElement('div')
    l.style.cssText = 'flex:1;height:1px;background:rgba(103,232,249,0.22);'
    return l
  }
  const orSpan = document.createElement('span')
  orSpan.style.cssText = `font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${C.textMuted};`
  orSpan.textContent = 'or'
  divider.append(line(), orSpan, line())

  const googleBtn = makeSocialButton('Continue with Google', '#f8fafc', '#0f172a', '#cbd5e1', 'google')
  const metaBtn = makeSocialButton('Continue with Meta', '#1877f2', '#fff', '#3b82f6', 'meta')
  const appleBtn = makeSocialButton('Continue with Apple', '#0b1220', '#f8fafc', '#334155', 'apple')
  const microsoftBtn = makeSocialButton('Continue with Microsoft', '#2563eb', '#fff', '#60a5fa', 'microsoft')

  function setFieldError(input: HTMLInputElement, on: boolean): void {
    if (on) {
      input.dataset.invalid = '1'
      input.style.borderColor = C.borderError
      input.style.boxShadow = '0 0 0 3px rgba(248,113,113,0.18)'
    } else {
      delete input.dataset.invalid
      input.style.borderColor = C.border
      input.style.boxShadow = 'none'
    }
  }

  function clearFieldErrors(): void {
    setFieldError(emailInput, false)
    setFieldError(passwordInput, false)
  }

  function setMode(m: Mode): void {
    mode = m
    const isSignin = m === 'signin'
    setActiveTab(signinTab, isSignin)
    setActiveTab(signupTab, !isSignin)
    submitBtn.textContent = isSignin ? 'Sign in' : 'Create account'
    subtitle.textContent = isSignin
      ? 'Sign in to translate the web with Osmosis.'
      : 'Create an account to start learning in context.'
    hintEl.style.display = isSignin ? 'none' : ''
    errorEl.textContent = ''
    clearFieldErrors()
    passwordInput.autocomplete = isSignin ? 'current-password' : 'new-password'
    console.log('[osmosis:popup:login] mode', m)
    requestAnimationFrame(() => {
      console.log('[osmosis:popup:login] mode layout', {
        mode: m,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      })
    })
  }

  signinTab.addEventListener('click', () => setMode('signin'))
  signupTab.addEventListener('click', () => setMode('signup'))

  async function submit(): Promise<void> {
    const email = emailInput.value.trim()
    const password = passwordInput.value
    errorEl.textContent = ''
    clearFieldErrors()

    let ok = true
    if (!email) {
      errorEl.textContent = 'Email is required.'
      setFieldError(emailInput, true)
      ok = false
    }
    if (!password) {
      if (!errorEl.textContent) errorEl.textContent = 'Password is required.'
      setFieldError(passwordInput, true)
      ok = false
    }
    if (mode === 'signup' && password.length > 0 && password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.'
      setFieldError(passwordInput, true)
      ok = false
    }
    if (!ok) {
      console.log('[osmosis:popup:login] validation failed', { mode })
      return
    }

    console.log('[osmosis:popup:login] email submit requested', { mode, email })

    submitBtn.disabled = true
    submitBtn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…'
    submitBtn.style.opacity = '0.78'

    try {
      const msgType = mode === 'signin' ? 'EMAIL_LOGIN' : 'EMAIL_SIGNUP'
      const result = await chrome.runtime.sendMessage(
        { type: msgType, email, password } as Message
      ) as { token?: string; error?: string } | undefined

      if (!result) throw new Error('Service worker not responding — try reloading')
      if (result.error) throw new Error(result.error)
      console.log('[osmosis:popup:login] email auth success', { mode, email })
      onSuccess()
    } catch (e) {
      console.warn('[osmosis:popup:login] email auth failed', e)
      errorEl.textContent = String(e).replace('Error: ', '')
      setFieldError(emailInput, true)
      setFieldError(passwordInput, true)
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = mode === 'signin' ? 'Sign in' : 'Create account'
      submitBtn.style.opacity = '1'
    }
  }

  submitBtn.addEventListener('click', () => void submit())
  emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })
  passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })
  emailInput.addEventListener('input', () => { if (emailInput.dataset.invalid) setFieldError(emailInput, false) })
  passwordInput.addEventListener('input', () => { if (passwordInput.dataset.invalid) setFieldError(passwordInput, false) })

  wireOAuth(googleBtn, 'GOOGLE_LOGIN', 'google', errorEl, onSuccess)
  wireOAuth(metaBtn, 'META_LOGIN', 'meta', errorEl, onSuccess)
  wireOAuth(appleBtn, 'APPLE_LOGIN', 'apple', errorEl, onSuccess)
  wireOAuth(microsoftBtn, 'MICROSOFT_LOGIN', 'microsoft', errorEl, onSuccess)

  card.append(
    titleBlock,
    tabBar,
    emailField,
    passwordField,
    hintEl,
    errorEl,
    submitBtn,
    divider,
    googleBtn,
    metaBtn,
    appleBtn,
    microsoftBtn
  )
  wrap.append(hero, card)
  root.appendChild(wrap)
  setMode('signin')
  console.log('[osmosis:popup:login] layout metrics', {
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  })
}

function makeTab(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.style.cssText =
    'flex:1;padding:7px 6px;font-size:11px;font-weight:700;border:none;border-radius:10px;cursor:pointer;transition:all .15s ease;'
  setActiveTab(btn, active)
  return btn
}

function setActiveTab(btn: HTMLButtonElement, active: boolean): void {
  if (active) {
    btn.style.background = 'linear-gradient(135deg, rgba(34,211,238,0.35), rgba(6,182,212,0.2))'
    btn.style.color = '#ecfeff'
    btn.style.boxShadow = 'inset 0 0 0 1px rgba(103,232,249,0.45), 0 8px 22px rgba(8,145,178,0.25)'
  } else {
    btn.style.background = 'transparent'
    btn.style.color = 'rgba(165,243,252,0.55)'
    btn.style.boxShadow = 'none'
  }
}

function makeLabeledField(labelText: string, control: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;'
  const label = document.createElement('label')
  label.textContent = labelText
  label.style.cssText =
    `font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.textMuted};`
  const id = `login-field-${labelText.toLowerCase().replace(/\s+/g, '-')}`
  label.htmlFor = id
  if (control instanceof HTMLInputElement) {
    control.id = id
  } else {
    const inner = control.querySelector('input')
    if (inner instanceof HTMLInputElement) inner.id = id
  }
  wrap.append(label, control)
  return wrap
}

function makeInput(name: string, placeholder: string, type: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  input.name = name
  input.placeholder = placeholder
  input.autocomplete = name === 'email' ? 'email' : type === 'password' ? 'current-password' : 'off'
  input.style.cssText =
    `width:100%;background:rgba(2,6,23,0.35);color:#ecfeff;border:1px solid ${C.border};border-radius:10px;` +
    'padding:9px 10px;font-size:13px;outline:none;transition:border-color .15s ease, box-shadow .15s ease;'
  input.addEventListener('focus', () => {
    if (input.dataset.invalid) return
    input.style.borderColor = C.borderFocus
    input.style.boxShadow = '0 0 0 3px rgba(34,211,238,0.22)'
  })
  input.addEventListener('blur', () => {
    if (input.dataset.invalid) return
    input.style.borderColor = C.border
    input.style.boxShadow = 'none'
  })
  return input
}

type OAuthBrand = 'google' | 'meta' | 'apple' | 'microsoft'

function oauthIconSvg(brand: OAuthBrand): string {
  switch (brand) {
    case 'google':
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">' +
        '<path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>' +
        '<path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>' +
        '<path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>' +
        '<path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>' +
        '</svg>'
      )
    case 'meta':
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        '<path fill="#ffffff" d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"/>' +
        '</svg>'
      )
    case 'apple':
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        '<path fill="#f8fafc" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>' +
        '</svg>'
      )
    case 'microsoft':
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 23" width="20" height="20" aria-hidden="true">' +
        '<path fill="#f25022" d="M1 1h10v10H1z"/>' +
        '<path fill="#7fba00" d="M12 1h10v10H12z"/>' +
        '<path fill="#00a4ef" d="M1 12h10v10H1z"/>' +
        '<path fill="#ffb900" d="M12 12h10v10H12z"/>' +
        '</svg>'
      )
  }
}

function makeSocialButton(
  label: string,
  bg: string,
  fg: string,
  border: string,
  brand: OAuthBrand
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.dataset.oauthLabel = label

  const iconWrap = document.createElement('span')
  iconWrap.style.cssText = 'display:flex;width:20px;height:20px;flex-shrink:0;align-items:center;justify-content:center;'
  iconWrap.innerHTML = oauthIconSvg(brand)

  const text = document.createElement('span')
  text.dataset.oauthText = '1'
  text.textContent = label
  text.style.cssText = `flex:1;text-align:center;color:${fg};`

  const balance = document.createElement('span')
  balance.style.cssText = 'width:20px;flex-shrink:0;pointer-events:none;'

  btn.append(iconWrap, text, balance)
  btn.style.cssText =
    'display:flex;align-items:center;gap:0;' +
    `background:${bg};color:${fg};border:1px solid ${border};border-radius:10px;padding:7px 10px;width:100%;` +
    'font-size:12px;font-weight:700;cursor:pointer;transition:transform .12s ease, filter .12s ease;'
  btn.addEventListener('mouseenter', () => {
    if (!btn.disabled) btn.style.transform = 'translateY(-1px)'
  })
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'translateY(0)' })
  return btn
}

function wireOAuth(
  btn: HTMLButtonElement,
  msgType: Message['type'],
  provider: string,
  errorEl: HTMLElement,
  onSuccess: () => void
): void {
  const label = btn.dataset.oauthLabel ?? 'Continue'
  const textSpan = btn.querySelector<HTMLSpanElement>('[data-oauth-text]')
  btn.addEventListener('click', async () => {
    errorEl.textContent = ''
    console.log('[osmosis:popup:login] oauth start', { provider })
    btn.disabled = true
    if (textSpan) textSpan.textContent = 'Opening…'
    btn.style.opacity = '0.85'
    try {
      const result = await chrome.runtime.sendMessage({ type: msgType } as Message) as
        | { token?: string; error?: string }
        | undefined
      if (!result) return
      if (result.error) throw new Error(result.error)
      console.log('[osmosis:popup:login] oauth success', { provider })
      onSuccess()
    } catch (e) {
      console.warn('[osmosis:popup:login] oauth failed', { provider, error: e })
      const msg = String(e).replace('Error: ', '')
      if (!msg.includes('message port closed') && !msg.includes('receiving end does not exist')) {
        errorEl.textContent = msg
      }
    } finally {
      btn.disabled = false
      if (textSpan) textSpan.textContent = label
      btn.style.opacity = '1'
    }
  })
}
