import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT, generateRefreshToken, ACCESS_TOKEN_EXPIRY_SECS, REFRESH_TOKEN_TTL_SECS } from '../utils/jwt'
import { hashPassword, verifyPassword, DUMMY_HASH } from '../utils/passwords'
import { createUser, findUserByEmail, findUserById, verifyUserEmail, DuplicateEmailError } from '../db/users'
import {
  buildVerifyEmailUrl,
  generateVerifyToken,
  sendSignupConfirmationEmail,
  storePendingSignup,
  takePendingSignup,
  peekPendingSignup,
  verificationKvKey,
} from '../services/emailSignup'
import { checkRateLimit } from '../utils/ratelimit'
import {
  buildResetEmailUrl,
  generateResetToken,
  resetPageHtml,
  sendPasswordResetEmail,
  storePendingReset,
  takePendingReset,
} from '../services/emailReset'
import { updatePassword } from '../db/users'

export const authRouter = new Hono<{ Bindings: Env }>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
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


function verifyLandingPageHtml(jwt: string, refreshToken: string, extensionId: string): string {
  // jwt is base64url (A-Za-z0-9-_.) and refreshToken is hex — both safe as JS string literals
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
  </style>
</head>
<body>
  <div class="card">
    <h1>&#10003; Email confirmed!</h1>
    <p id="status">Signing you in&hellip;</p>
    <p style="font-size:0.85rem">If you don&apos;t see the extension, click the puzzle icon next to the address bar and pin Osmosis.</p>
  </div>
  <script>
    (function () {
      var extId = '${extensionId}';
      var status = document.getElementById('status');
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        status.textContent = 'Make sure Osmosis is installed, then sign in from the extension.';
        return;
      }
      chrome.runtime.sendMessage(extId, { type: 'SESSION_FROM_VERIFY', token: '${jwt}', refreshToken: '${refreshToken}' }, function (res) {
        if (chrome.runtime.lastError || !res || res.error) {
          status.textContent = 'Could not connect to Osmosis. Please sign in manually from the extension.';
          return;
        }
        status.textContent = 'You\\'re all set! Click the Osmosis icon in your toolbar to start learning.';
      });
    })();
  </script>
</body>
</html>`
}

function verifyConfirmPageHtml(token: string): string {
  // token is random hex — safe in HTML attribute values
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Osmosis — confirm your account</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #ecfeff; margin: 0; padding: 32px 20px; line-height: 1.5; }
    .card { max-width: 420px; margin: 0 auto; background: rgba(30,41,59,0.9); border: 1px solid rgba(56,189,248,0.25); border-radius: 16px; padding: 24px; }
    h1 { font-size: 1.25rem; margin: 0 0 12px; }
    p { margin: 0 0 14px; color: #94a3b8; font-size: 0.95rem; }
    .btn { display:inline-block; padding: 12px 24px; background: #22d3ee; color: #042f2e; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirm your Osmosis account</h1>
    <p>Click the button below to activate your account and open Osmosis.</p>
    <form method="POST" action="/auth/verify-email">
      <input type="hidden" name="t" value="${token}" />
      <button class="btn" type="submit">Confirm &amp; open Osmosis</button>
    </form>
  </div>
</body>
</html>`
}

authRouter.post('/signup/request', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const allowed = await checkRateLimit(c.env.TRANSLATION_CACHE, `signup:${ip}`, 5, 60 * 60)
  if (!allowed) return c.json({ error: 'Too many requests. Please try again later.' }, 429)

  let body: { email?: unknown; password?: unknown; passwordConfirm?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const passwordConfirm = typeof body.passwordConfirm === 'string' ? body.passwordConfirm : null

  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'Valid email required' }, 400)
  if (!password) return c.json({ error: 'Password is required' }, 400)
  if (passwordConfirm === null) return c.json({ error: 'Please confirm your password' }, 400)
  if (passwordConfirm !== password) return c.json({ error: 'Passwords do not match' }, 400)

  const pwError = validateNewPassword(password)
  if (pwError) return c.json({ error: pwError }, 400)

  const existing = await findUserByEmail(c.env.DB, email)
  if (existing) {
    if (existing.email_verified) {
      // Return 200 to avoid leaking whether this email is registered
      return c.json({ ok: true })
    }
    // Unverified account — resend the confirmation email
    const token = generateVerifyToken()
    await storePendingSignup(c.env.TRANSLATION_CACHE, token, { userId: existing.id })
    const origin = new URL(c.req.url).origin
    const verifyUrl = buildVerifyEmailUrl(origin, token)
    try {
      await sendSignupConfirmationEmail(c.env, email, verifyUrl)
    } catch (e) {
      console.warn('[auth/signup/request] resend failed', e)
      await c.env.TRANSLATION_CACHE.delete(verificationKvKey(token))
      const msg = e instanceof Error ? e.message : 'Email send failed'
      return c.json({ error: msg }, 503)
    }
    return c.json({ ok: true })
  }

  const hash = await hashPassword(password)
  let userId: string
  try {
    userId = await createUser(c.env.DB, email, hash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) return c.json({ ok: true })
    throw err
  }

  const token = generateVerifyToken()
  await storePendingSignup(c.env.TRANSLATION_CACHE, token, { userId })

  const origin = new URL(c.req.url).origin
  const verifyUrl = buildVerifyEmailUrl(origin, token)

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

// Step 1: GET link from email — validate token exists, show confirm button (prevents CSRF via img/redirect)
authRouter.get('/verify-email', async (c) => {
  const raw = c.req.query('t')?.trim()
  if (!raw) return c.html('<p>Invalid or missing link.</p>', 400)

  const exists = await peekPendingSignup(c.env.TRANSLATION_CACHE, raw)
  if (!exists) {
    return c.html(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px"><p>This confirmation link is invalid or already used.</p></body></html>',
      400,
    )
  }

  return c.html(verifyConfirmPageHtml(raw))
})

// Step 2: POST confirmation — consume token, create account, redirect to extension
authRouter.post('/verify-email', async (c) => {
  let raw: string
  try {
    const body = await c.req.parseBody()
    raw = typeof body['t'] === 'string' ? body['t'].trim() : ''
  } catch {
    return c.html('<p>Invalid submission.</p>', 400)
  }
  if (!raw) return c.html('<p>Invalid or missing token.</p>', 400)

  const extensionId = c.env.CHROME_EXTENSION_ID?.trim()
  if (!extensionId) {
    console.error('[auth/verify-email] CHROME_EXTENSION_ID is not configured')
    return c.html('<p>Server configuration error. Please contact support.</p>', 503)
  }

  const pending = await takePendingSignup(c.env.TRANSLATION_CACHE, raw)
  if (!pending) {
    return c.html(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px"><p>This confirmation link is invalid or already used.</p></body></html>',
      400,
    )
  }

  await verifyUserEmail(c.env.DB, pending.userId)

  const user = await findUserById(c.env.DB, pending.userId)
  if (!user) return c.html('<p>Account not found.</p>', 500)

  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_SECS
  const jwt = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
  const refreshToken = await generateRefreshToken(c.env.TRANSLATION_CACHE, user.id)
  console.log(`[auth/verify-email] new user ${user.id}`)

  const html = verifyLandingPageHtml(jwt, refreshToken, extensionId)
  return c.html(html)
})

authRouter.post('/forgot-password', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const allowed = await checkRateLimit(c.env.TRANSLATION_CACHE, `forgot:${ip}`, 5, 60 * 60)
  if (!allowed) return c.json({ error: 'Too many requests. Please try again later.' }, 429)

  let body: { email?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Always respond 200 to prevent email enumeration
  if (!email || !EMAIL_RE.test(email)) return c.json({ ok: true })

  const user = await findUserByEmail(c.env.DB, email)
  if (user && user.auth_provider !== 'google') {
    const token = generateResetToken()
    await storePendingReset(c.env.TRANSLATION_CACHE, token, { userId: user.id, email: user.email })
    const origin = new URL(c.req.url).origin
    const resetUrl = buildResetEmailUrl(origin, token)
    try {
      await sendPasswordResetEmail(c.env, email, resetUrl)
      console.log(`[auth/forgot-password] reset email sent for user ${user.id}`)
    } catch (e) {
      console.warn('[auth/forgot-password] send failed', e)
    }
  }

  return c.json({ ok: true })
})

authRouter.get('/reset-password', (c) => {
  return c.html(resetPageHtml())
})

authRouter.post('/reset-password', async (c) => {
  let body: { token?: unknown; password?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!token) return c.json({ error: 'Reset token required' }, 400)
  if (!password) return c.json({ error: 'Password required' }, 400)

  const pwError = validateNewPassword(password)
  if (pwError) return c.json({ error: pwError }, 400)

  const pending = await takePendingReset(c.env.TRANSLATION_CACHE, token)
  if (!pending) return c.json({ error: 'This reset link is invalid or has expired.' }, 400)

  const hash = await hashPassword(password)
  await updatePassword(c.env.DB, pending.userId, hash)
  void c.env.TRANSLATION_CACHE.delete(`user_auth:${pending.userId}`)

  console.log(`[auth/reset-password] password updated for user ${pending.userId}`)
  return c.json({ ok: true })
})

authRouter.post('/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const allowed = await checkRateLimit(c.env.TRANSLATION_CACHE, `login:${ip}`, 10, 15 * 60)
  if (!allowed) return c.json({ error: 'Too many requests. Please try again later.' }, 429)

  let body: { email?: unknown; password?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

  const user = await findUserByEmail(c.env.DB, email)

  // Always run PBKDF2 to prevent timing-based email enumeration
  const storedHash = user?.password_hash ?? DUMMY_HASH
  const valid = await verifyPassword(password, storedHash)

  if (!user || !valid) return c.json({ error: 'Invalid email or password' }, 401)

  if (!user.email_verified) {
    return c.json({ error: 'Please confirm your email before signing in. Check your inbox for the confirmation link.' }, 403)
  }

  if (user.auth_provider === 'google') {
    return c.json({ error: 'This account uses Google sign-in. Please continue with Google.' }, 401)
  }

  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_SECS
  const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
  const refreshToken = await generateRefreshToken(c.env.TRANSLATION_CACHE, user.id)
  console.log(`[auth/login] user ${user.id}`)
  return c.json({ token, refreshToken })
})

authRouter.post('/refresh', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const allowed = await checkRateLimit(c.env.TRANSLATION_CACHE, `refresh:${ip}`, 20, 15 * 60)
  if (!allowed) return c.json({ error: 'Too many requests. Please try again later.' }, 429)

  let body: { refreshToken?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request body' }, 400) }
  const incoming = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : ''
  if (!incoming) return c.json({ error: 'refreshToken required' }, 400)

  const userId = await c.env.TRANSLATION_CACHE.get(`refresh:${incoming}`)
  if (!userId) return c.json({ error: 'Invalid or expired refresh token' }, 401)

  // Rotate: consume old token before issuing new one
  await c.env.TRANSLATION_CACHE.delete(`refresh:${incoming}`)

  const user = await c.env.DB.prepare('SELECT email, plan FROM users WHERE id = ?')
    .bind(userId).first<{ email: string; plan: string }>()
  if (!user) {
    console.warn(`[auth/refresh] refresh token references missing user ${userId}`)
    return c.json({ error: 'Invalid refresh token' }, 401)
  }

  const plan: 'free' | 'pro' = user.plan === 'pro' ? 'pro' : 'free'
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_SECS
  const token = await signJWT({ sub: userId, email: user.email, plan, exp }, c.env.JWT_SECRET)
  const newRefreshToken = await generateRefreshToken(c.env.TRANSLATION_CACHE, userId)

  console.log(`[auth/refresh] rotated token for user ${userId}`)
  return c.json({ token, refreshToken: newRefreshToken })
})
