import type { Message } from '../../types'
import heroImage from '../assets/osmosis-hero.png'
import { log, warn } from '../../logger'

type Mode = 'signin' | 'signup'

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.replaceChildren()

  let mode: Mode = 'signin'

  const wrap = document.createElement('div')
  wrap.className = 'login-wrap'

  const hero = document.createElement('div')
  hero.className = 'login-hero'

  const heroImg = document.createElement('img')
  heroImg.src = heroImage
  heroImg.alt = 'Osmosis — language learning'
  heroImg.className = 'login-hero__img'

  const heroOverlay = document.createElement('div')
  heroOverlay.className = 'login-hero__overlay'

  hero.append(heroImg, heroOverlay)

  const card = document.createElement('section')
  card.className = 'login-card'

  const titleBlock = document.createElement('div')
  titleBlock.className = 'login-title-block'
  const title = document.createElement('h1')
  title.className = 'login-title'
  title.textContent = 'Welcome'
  const subtitle = document.createElement('p')
  subtitle.className = 'login-subtitle'
  subtitle.textContent = 'Sign in to translate the web with Osmosis.'
  titleBlock.append(title, subtitle)

  const tabBar = document.createElement('div')
  tabBar.className = 'login-tabs'

  const signinTab = makeTab('Sign in', true)
  const signupTab = makeTab('Create account', false)
  tabBar.append(signinTab, signupTab)

  const emailInput = makeInput('email', 'you@example.com', 'text')
  const emailField = makeLabeledField('Email', emailInput)

  const passwordInput = makeInput('password', '••••••••', 'password')
  const pwdShell = document.createElement('div')
  pwdShell.className = 'login-pwd-shell'
  passwordInput.classList.add('osmo-input--pad-right')
  const pwdToggle = document.createElement('button')
  pwdToggle.type = 'button'
  pwdToggle.textContent = 'Show'
  pwdToggle.setAttribute('aria-label', 'Show password')
  pwdToggle.className = 'login-pwd-toggle'
  pwdToggle.addEventListener('click', () => {
    const show = passwordInput.type === 'password'
    passwordInput.type = show ? 'text' : 'password'
    pwdToggle.textContent = show ? 'Hide' : 'Show'
    pwdToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
  })
  pwdShell.append(passwordInput, pwdToggle)
  const passwordField = makeLabeledField('Password', pwdShell)

  const passwordConfirmInput = makeInput('passwordConfirm', 'Confirm password', 'password')
  passwordConfirmInput.autocomplete = 'new-password'
  const pwdConfirmShell = document.createElement('div')
  pwdConfirmShell.className = 'login-pwd-shell'
  passwordConfirmInput.classList.add('osmo-input--pad-right')
  const pwdConfirmToggle = document.createElement('button')
  pwdConfirmToggle.type = 'button'
  pwdConfirmToggle.textContent = 'Show'
  pwdConfirmToggle.setAttribute('aria-label', 'Show confirm password')
  pwdConfirmToggle.className = 'login-pwd-toggle'
  pwdConfirmToggle.addEventListener('click', () => {
    const show = passwordConfirmInput.type === 'password'
    passwordConfirmInput.type = show ? 'text' : 'password'
    pwdConfirmToggle.textContent = show ? 'Hide' : 'Show'
    pwdConfirmToggle.setAttribute('aria-label', show ? 'Hide confirm password' : 'Show confirm password')
  })
  pwdConfirmShell.append(passwordConfirmInput, pwdConfirmToggle)
  const passwordConfirmField = makeLabeledField('Confirm password', pwdConfirmShell)
  passwordConfirmField.style.display = 'none'

  const hintEl = document.createElement('p')
  hintEl.className = 'login-hint'
  hintEl.textContent =
    `Password: at least ${PASSWORD_MIN_LENGTH} characters and one special character (!@#$%^&* …).`

  const errorEl = document.createElement('p')
  errorEl.className = 'osmo-error'

  const submitBtn = document.createElement('button')
  submitBtn.type = 'button'
  submitBtn.className = 'osmo-btn osmo-btn--primary'
  submitBtn.textContent = 'Sign in'

  const loginDivider = document.createElement('div')
  loginDivider.className = 'login-divider'
  const divLine1 = document.createElement('div')
  divLine1.className = 'login-divider__line'
  const divLine2 = document.createElement('div')
  divLine2.className = 'login-divider__line'
  const orSpan = document.createElement('span')
  orSpan.className = 'login-divider__label'
  orSpan.textContent = 'or'
  loginDivider.append(divLine1, orSpan, divLine2)

  const googleBtn = makeSocialButton('Continue with Google')
  const googleBtnAfterEmail = makeSocialButton('Continue with Google')

  // Forgot-password panel
  const forgotPanel = document.createElement('div')
  forgotPanel.className = 'login-panel login-panel--hidden'
  const forgotTitle = document.createElement('p')
  forgotTitle.className = 'login-email-sent__title'
  forgotTitle.textContent = 'Reset your password'
  const forgotDesc = document.createElement('p')
  forgotDesc.className = 'login-email-sent__body'
  forgotDesc.textContent = "Enter your email and we'll send a reset link. Check your spam folder if it doesn't arrive within a minute."
  const forgotEmailInput = makeInput('forgot-email', 'you@example.com', 'text')
  const forgotEmailField = makeLabeledField('Email', forgotEmailInput)
  const forgotErrorEl = document.createElement('p')
  forgotErrorEl.className = 'osmo-error'
  const forgotSubmitBtn = document.createElement('button')
  forgotSubmitBtn.type = 'button'
  forgotSubmitBtn.className = 'osmo-btn osmo-btn--primary'
  forgotSubmitBtn.textContent = 'Send reset link'
  const forgotSentMsg = document.createElement('p')
  forgotSentMsg.className = 'login-sent-msg'
  forgotSentMsg.textContent = 'If an account exists for that email, a reset link is on its way. Check your inbox (and spam).'
  const backFromForgotBtn = document.createElement('button')
  backFromForgotBtn.type = 'button'
  backFromForgotBtn.textContent = '← Back to sign in'
  backFromForgotBtn.className = 'login-back-btn'
  forgotPanel.append(forgotTitle, forgotDesc, forgotEmailField, forgotErrorEl, forgotSubmitBtn, forgotSentMsg, backFromForgotBtn)

  forgotSubmitBtn.addEventListener('click', async () => {
    const email = forgotEmailInput.value.trim().toLowerCase()
    forgotErrorEl.textContent = ''
    if (!email) { forgotErrorEl.textContent = 'Email is required.'; return }
    forgotSubmitBtn.disabled = true
    forgotSubmitBtn.textContent = 'Sending…'
    try {
      await chrome.runtime.sendMessage({ type: 'FORGOT_PASSWORD', email } as Message)
      forgotSubmitBtn.style.display = 'none'
      forgotEmailField.style.display = 'none'
      forgotSentMsg.style.display = 'block'
    } catch (e) {
      forgotErrorEl.textContent = e instanceof Error ? e.message : 'Something went wrong.'
    } finally {
      forgotSubmitBtn.disabled = false
      forgotSubmitBtn.textContent = 'Send reset link'
    }
  })
  forgotEmailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') forgotSubmitBtn.click() })

  function showForgotPanel(): void {
    formPanel.classList.add('login-panel--hidden')
    emailSentPanel.classList.add('login-panel--hidden')
    forgotPanel.classList.remove('login-panel--hidden')
    forgotSentMsg.style.display = 'none'
    forgotSubmitBtn.style.display = ''
    forgotEmailField.style.display = ''
    forgotEmailInput.value = emailInput.value
    forgotErrorEl.textContent = ''
    title.textContent = 'Forgot password?'
    subtitle.textContent = ''
  }

  backFromForgotBtn.addEventListener('click', () => {
    forgotPanel.classList.add('login-panel--hidden')
    formPanel.classList.remove('login-panel--hidden')
    title.textContent = 'Welcome'
    subtitle.textContent = 'Sign in to translate the web with Osmosis.'
  })

  const oauthSentErrorEl = document.createElement('p')
  oauthSentErrorEl.className = 'osmo-error'

  const emailSentPanel = document.createElement('div')
  emailSentPanel.className = 'login-panel login-panel--hidden'
  const emailSentTitle = document.createElement('p')
  emailSentTitle.className = 'login-email-sent__title'
  emailSentTitle.textContent = 'Check your email'
  const emailSentBody = document.createElement('p')
  emailSentBody.className = 'login-email-sent__body'
  emailSentBody.innerHTML =
    'We sent a confirmation link. Open your email and click <strong>Confirm email &amp; return to Osmosis</strong> — that activates your account.<br><br>' +
    'Once confirmed, click the Osmosis icon in your toolbar to sign in. Or skip the email and use Google below if your Google account shares the same address.'

  const sentDivider = document.createElement('div')
  sentDivider.className = 'login-divider'
  const sentLine1 = document.createElement('div')
  sentLine1.className = 'login-divider__line'
  const sentLine2 = document.createElement('div')
  sentLine2.className = 'login-divider__line'
  const sentOr = document.createElement('span')
  sentOr.className = 'login-divider__label'
  sentOr.textContent = 'or'
  sentDivider.append(sentLine1, sentOr, sentLine2)

  const backToFormBtn = document.createElement('button')
  backToFormBtn.type = 'button'
  backToFormBtn.textContent = 'Use a different email'
  backToFormBtn.className = 'login-alt-btn'
  emailSentPanel.append(emailSentTitle, emailSentBody, oauthSentErrorEl, sentDivider, googleBtnAfterEmail, backToFormBtn)

  const formPanel = document.createElement('div')
  formPanel.className = 'login-panel'

  function showFormChrome(): void {
    emailSentPanel.classList.add('login-panel--hidden')
    formPanel.classList.remove('login-panel--hidden')
    titleBlock.style.display = 'flex'
    const isSignin = mode === 'signin'
    title.textContent = 'Welcome'
    subtitle.textContent = isSignin
      ? 'Sign in to translate the web with Osmosis.'
      : 'Create an account to start learning in context.'
  }

  function showEmailSentChrome(): void {
    oauthSentErrorEl.textContent = ''
    formPanel.classList.add('login-panel--hidden')
    emailSentPanel.classList.remove('login-panel--hidden')
    title.textContent = 'Almost there'
    subtitle.textContent = 'Confirm from your inbox to finish.'
    log('[osmosis:popup:login] email verification sent UI')
  }

  function setFieldError(input: HTMLInputElement, on: boolean): void {
    if (on) {
      input.dataset.invalid = '1'
      input.classList.add('osmo-input--invalid')
    } else {
      delete input.dataset.invalid
      input.classList.remove('osmo-input--invalid')
    }
  }

  function clearFieldErrors(): void {
    setFieldError(emailInput, false)
    setFieldError(passwordInput, false)
    setFieldError(passwordConfirmInput, false)
  }

  function setMode(m: Mode): void {
    mode = m
    const isSignin = m === 'signin'
    setActiveTab(signinTab, isSignin)
    setActiveTab(signupTab, !isSignin)
    submitBtn.textContent = isSignin ? 'Sign in' : 'Send confirmation email'
    errorEl.textContent = ''
    clearFieldErrors()
    passwordConfirmInput.value = ''
    passwordInput.autocomplete = isSignin ? 'current-password' : 'new-password'
    hintEl.style.display = isSignin ? 'none' : ''
    passwordConfirmField.style.display = isSignin ? 'none' : 'flex'
    forgotLink.style.display = isSignin ? '' : 'none'
    showFormChrome()
    log('[osmosis:popup:login] mode', m)
    requestAnimationFrame(() => {
      log('[osmosis:popup:login] mode layout', {
        mode: m,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      })
    })
  }

  signinTab.addEventListener('click', () => setMode('signin'))
  signupTab.addEventListener('click', () => setMode('signup'))

  async function submit(): Promise<void> {
    const email = emailInput.value.trim().toLowerCase()
    const password = passwordInput.value
    const passwordConfirm = passwordConfirmInput.value
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
    if (mode === 'signup' && password.length > 0) {
      if (password.length < PASSWORD_MIN_LENGTH || !PASSWORD_SPECIAL_RE.test(password)) {
        if (!errorEl.textContent) errorEl.textContent = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a special character.`
        setFieldError(passwordInput, true)
        ok = false
      }
    }
    if (mode === 'signup') {
      if (!passwordConfirm) {
        if (!errorEl.textContent) errorEl.textContent = 'Please confirm your password.'
        setFieldError(passwordConfirmInput, true)
        ok = false
      } else if (passwordConfirm !== password) {
        if (!errorEl.textContent) errorEl.textContent = 'Passwords do not match.'
        setFieldError(passwordInput, true)
        setFieldError(passwordConfirmInput, true)
        ok = false
      }
    }
    if (!ok) {
      log('[osmosis:popup:login] validation failed', { mode })
      return
    }

    if (mode === 'signup') {
      log('[osmosis:popup:login] signup request email', { email })
      submitBtn.disabled = true
      submitBtn.textContent = 'Sending…'
      submitBtn.style.opacity = '0.78'
      try {
        const result = await chrome.runtime.sendMessage(
          { type: 'EMAIL_SIGNUP', email, password, passwordConfirm } as Message
        ) as { ok?: boolean; error?: string } | undefined
        if (!result) throw new Error('Service worker not responding — try reloading')
        if (result.error) throw new Error(result.error)
        showEmailSentChrome()
      } catch (e) {
        warn('[osmosis:popup:login] signup request failed', e)
        const msg = String(e).replace('Error: ', '')
        errorEl.textContent = msg
        const isEmailError = /email|account|already/i.test(msg)
        setFieldError(emailInput, isEmailError)
      } finally {
        submitBtn.disabled = false
        submitBtn.textContent = 'Send confirmation email'
        submitBtn.style.opacity = '1'
      }
      return
    }

    log('[osmosis:popup:login] email sign-in requested', { email })

    submitBtn.disabled = true
    submitBtn.textContent = 'Signing in…'
    submitBtn.style.opacity = '0.78'

    try {
      const result = await chrome.runtime.sendMessage(
        { type: 'EMAIL_LOGIN', email, password } as Message
      ) as { token?: string; error?: string } | undefined

      if (!result) throw new Error('Service worker not responding — try reloading')
      if (result.error) throw new Error(result.error)
      log('[osmosis:popup:login] email auth success', { mode: 'signin', email })
      onSuccess()
    } catch (e) {
      warn('[osmosis:popup:login] email auth failed', e)
      errorEl.textContent = String(e).replace('Error: ', '')
      setFieldError(emailInput, true)
      setFieldError(passwordInput, true)
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Sign in'
      submitBtn.style.opacity = '1'
    }
  }

  submitBtn.addEventListener('click', () => void submit())
  backToFormBtn.addEventListener('click', () => {
    log('[osmosis:popup:login] back from email sent')
    showFormChrome()
  })
  emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })
  passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })
  passwordConfirmInput.addEventListener('keydown', e => { if (e.key === 'Enter') void submit() })
  emailInput.addEventListener('input', () => { if (emailInput.dataset.invalid) setFieldError(emailInput, false) })
  passwordInput.addEventListener('input', () => { if (passwordInput.dataset.invalid) setFieldError(passwordInput, false) })
  passwordConfirmInput.addEventListener('input', () => {
    if (passwordConfirmInput.dataset.invalid) setFieldError(passwordConfirmInput, false)
  })

  wireOAuth(googleBtn, 'GOOGLE_LOGIN', 'google', errorEl, onSuccess)
  wireOAuth(googleBtnAfterEmail, 'GOOGLE_LOGIN', 'google', oauthSentErrorEl, onSuccess)

  const forgotLink = document.createElement('button')
  forgotLink.type = 'button'
  forgotLink.textContent = 'Forgot password?'
  forgotLink.className = 'login-forgot-link'
  forgotLink.addEventListener('click', showForgotPanel)

  formPanel.append(
    tabBar,
    emailField,
    passwordField,
    forgotLink,
    passwordConfirmField,
    hintEl,
    errorEl,
    submitBtn,
    loginDivider,
    googleBtn
  )
  card.append(titleBlock, formPanel, emailSentPanel, forgotPanel)
  wrap.append(hero, card)
  root.appendChild(wrap)
  setMode('signin')
  log('[osmosis:popup:login] layout metrics', {
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  })
}

function makeTab(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.className = active ? 'login-tab login-tab--active' : 'login-tab'
  return btn
}

function setActiveTab(btn: HTMLButtonElement, active: boolean): void {
  btn.classList.toggle('login-tab--active', active)
}

function makeLabeledField(labelText: string, control: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'login-field'
  const label = document.createElement('label')
  label.textContent = labelText
  label.className = 'login-label'
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
  input.className = 'osmo-input'
  input.addEventListener('focus', () => {
    if (input.dataset.invalid) input.classList.remove('osmo-input--invalid')
  })
  return input
}

function googleIconSvg(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">' +
    '<path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>' +
    '<path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>' +
    '<path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>' +
    '<path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>' +
    '</svg>'
  )
}

function makeSocialButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'login-social-btn'
  btn.dataset.oauthLabel = label

  const iconWrap = document.createElement('span')
  iconWrap.className = 'login-social-btn__icon'
  iconWrap.innerHTML = googleIconSvg()

  const text = document.createElement('span')
  text.dataset.oauthText = '1'
  text.textContent = label
  text.className = 'login-social-btn__text'

  const balance = document.createElement('span')
  balance.className = 'login-social-btn__balance'

  btn.append(iconWrap, text, balance)
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
    log('[osmosis:popup:login] oauth start', { provider })
    btn.disabled = true
    if (textSpan) textSpan.textContent = 'Opening…'
    btn.style.opacity = '0.85'
    try {
      const result = await chrome.runtime.sendMessage({ type: msgType } as Message) as
        | { token?: string; error?: string }
        | undefined
      if (!result) return
      if (result.error) throw new Error(result.error)
      log('[osmosis:popup:login] oauth success', { provider })
      onSuccess()
    } catch (e) {
      warn('[osmosis:popup:login] oauth failed', { provider, error: e })
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
