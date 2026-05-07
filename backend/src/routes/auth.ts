import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT } from '../utils/jwt'
import { hashPassword, verifyPassword, DUMMY_HASH } from '../utils/passwords'
import { createUser, findUserByEmail, DuplicateEmailError } from '../db/users'
import {
  buildVerifyEmailUrl,
  generateVerifyToken,
  sendSignupConfirmationEmail,
  storePendingSignup,
  takePendingSignup,
  verificationKvKey,
} from '../services/emailSignup'

export const authRouter = new Hono<{ Bindings: Env }>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const JWT_EXPIRY_SECS = 60 * 60 * 24 * 30 // 30 days
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/

function validateNewPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (!PASSWORD_SPECIAL_RE.test(password)) {
    return 'Password must include at least one special character (for example !@#$%^&*)'
  }
  return null
}

function verifyLandingPageHtml(jwt: string, extensionId: string, popupPath: string): string {
  const extUrl =
    `chrome-extension://${extensionId}/${popupPath.replace(/^\//, '')}` +
    `#osmosis_session=${encodeURIComponent(jwt)}`
  const safeExt = extUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Osmosis — email confirmed</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #ecfeff; margin: 0; padding: 32px 20px; line-height: 1.5; }
    .card { max-width: 420px; margin: 0 auto; background: rgba(30,41,59,0.9); border: 1px solid rgba(56,189,248,0.25); border-radius: 16px; padding: 24px; }
    h1 { font-size: 1.25rem; margin: 0 0 12px; }
    p { margin: 0 0 14px; color: #94a3b8; font-size: 0.95rem; }
    .btn { display: inline-block; background: linear-gradient(92deg, #06b6d4, #22d3ee); color: #042f2e; font-weight: 800; padding: 12px 18px; border-radius: 12px; text-decoration: none; margin-top: 8px; }
    .hint { font-size: 0.85rem; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(148,163,184,0.25); }
  </style>
</head>
<body>
  <div class="card">
    <h1>You’re verified</h1>
    <p>Your Osmosis account is ready. Open the extension to start translating.</p>
    <p><a class="btn" id="openExt" href="${safeExt}">Return to Osmosis</a></p>
    <p class="hint">After opening, use <strong>Continue with Google</strong> on the sign-in screen if you want Google sign-in next time.</p>
  </div>
</body>
</html>`
}

authRouter.post('/signup/request', async (c) => {
  const body = await c.req.json<{ email?: unknown; password?: unknown; passwordConfirm?: unknown }>()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const passwordConfirm = typeof body.passwordConfirm === 'string' ? body.passwordConfirm : ''

  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'Valid email required' }, 400)
  if (!passwordConfirm) {
    console.warn('[auth/signup/request] missing password confirmation')
    return c.json({ error: 'Please confirm your password' }, 400)
  }
  if (passwordConfirm !== password) {
    console.warn('[auth/signup/request] password confirmation mismatch')
    return c.json({ error: 'Passwords do not match' }, 400)
  }
  const pwdErr = validateNewPassword(password)
  if (pwdErr) {
    console.warn('[auth/signup/request] password policy rejected:', pwdErr)
    return c.json({ error: pwdErr }, 400)
  }

  const existing = await findUserByEmail(c.env.DB, email)
  if (existing) return c.json({ error: 'An account with this email already exists' }, 409)

  const hash = await hashPassword(password)
  const token = generateVerifyToken()
  await storePendingSignup(c.env.TRANSLATION_CACHE, token, { email, password_hash: hash })

  const origin = new URL(c.req.url).origin
  const verifyUrl = buildVerifyEmailUrl(origin, token)
  console.log('[auth/signup/request] pending verification', { email, verifyUrl })

  try {
    await sendSignupConfirmationEmail(c.env, email, verifyUrl)
  } catch (e) {
    console.warn('[auth/signup/request] send failed', e)
    await c.env.TRANSLATION_CACHE.delete(verificationKvKey(token))
    const msg = e instanceof Error ? e.message : 'Email send failed'
    return c.json({ error: msg }, 503)
  }

  return c.json({ ok: true })
})

authRouter.get('/verify-email', async (c) => {
  const raw = c.req.query('t')?.trim()
  if (!raw) return c.html('<p>Invalid or missing link.</p>', 400)

  const pending = await takePendingSignup(c.env.TRANSLATION_CACHE, raw)
  if (!pending) {
    return c.html(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px"><p>This confirmation link is invalid or already used.</p></body></html>',
      400,
    )
  }

  try {
    await createUser(c.env.DB, pending.email, pending.password_hash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return c.html(
        '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px"><p>An account with this email already exists. Sign in from the extension.</p></body></html>',
        409,
      )
    }
    throw err
  }

  const user = await findUserByEmail(c.env.DB, pending.email)
  if (!user) return c.html('<p>Account creation failed.</p>', 500)

  const exp = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECS
  const jwt = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/verify-email] new user ${user.id}`)

  const extensionId = c.env.CHROME_EXTENSION_ID?.trim()
  const popupPath = (c.env.EXTENSION_POPUP_PATH?.trim() || 'src/popup/index.html').replace(/^\//, '')

  if (!extensionId) {
    console.warn('[auth/verify-email] CHROME_EXTENSION_ID not set; returning token in page only')
    return c.html(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px">
      <p>Account created. Set CHROME_EXTENSION_ID on the API to enable one-tap return to the extension.</p>
      <p style="word-break:break-all;font-size:12px">${jwt}</p></body></html>`,
      200,
    )
  }

  const html = verifyLandingPageHtml(jwt, extensionId, popupPath)
  return c.html(html)
})

authRouter.post('/login', async (c) => {
  const body = await c.req.json<{ email?: unknown; password?: unknown }>()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

  const user = await findUserByEmail(c.env.DB, email)

  // Always run PBKDF2 to prevent timing-based email enumeration
  const storedHash = user?.password_hash ?? DUMMY_HASH
  const valid = await verifyPassword(password, storedHash)

  if (!user || !valid) return c.json({ error: 'Invalid email or password' }, 401)

  if (user.auth_provider === 'google') {
    return c.json({ error: 'This account uses Google sign-in. Please continue with Google.' }, 401)
  }
  if (user.auth_provider === 'meta' || user.auth_provider === 'apple' || user.auth_provider === 'microsoft') {
    return c.json(
      {
        error:
          'This account used a sign-in method that is no longer available. Try Google if this email is linked there, or contact support.',
      },
      401,
    )
  }

  const exp = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECS
  const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/login] user ${user.id}`)
  return c.json({ token })
})
