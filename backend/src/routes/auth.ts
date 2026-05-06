import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT } from '../utils/jwt'
import { hashPassword, verifyPassword, DUMMY_HASH } from '../utils/passwords'
import { createUser, findUserByEmail, DuplicateEmailError } from '../db/users'

export const authRouter = new Hono<{ Bindings: Env }>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const JWT_EXPIRY_SECS = 60 * 60 * 24 * 30 // 30 days

authRouter.post('/signup', async (c) => {
  const body = await c.req.json<{ email?: unknown; password?: unknown }>()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'Valid email required' }, 400)
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)

  const hash = await hashPassword(password)
  try {
    await createUser(c.env.DB, email, hash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) return c.json({ error: 'An account with this email already exists' }, 409)
    throw err
  }

  const user = await findUserByEmail(c.env.DB, email)
  if (!user) return c.json({ error: 'Account creation failed' }, 500)

  const exp = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECS
  const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/signup] new user ${user.id}`)
  return c.json({ token }, 201)
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
  if (user.auth_provider === 'meta') {
    return c.json({ error: 'This account uses Meta sign-in. Please continue with Meta.' }, 401)
  }
  if (user.auth_provider === 'apple') {
    return c.json({ error: 'This account uses Apple sign-in. Please continue with Apple.' }, 401)
  }
  if (user.auth_provider === 'microsoft') {
    return c.json({ error: 'This account uses Microsoft sign-in. Please continue with Microsoft.' }, 401)
  }

  const exp = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECS
  const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/login] user ${user.id}`)
  return c.json({ token })
})
