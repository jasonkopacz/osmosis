import { Hono } from 'hono'
import type { Env } from '../types'
import { hashPassword, verifyPassword } from '../lib/passwords'
import { signJWT } from '../lib/jwt'
import { createUser, findUserByEmail, DuplicateEmailError } from '../lib/db'

export const authRouter = new Hono<{ Bindings: Env }>()

authRouter.post('/signup', async (c) => {
  const { email: rawEmail, password } = await c.req.json<{ email: string; password: string }>()
  const email = rawEmail?.toLowerCase().trim()
  if (!email || !password || password.length < 8) {
    console.warn('[auth/signup] invalid payload')
    return c.json({ error: 'Invalid email or password (min 8 chars)' }, 400)
  }
  try {
    await createUser(c.env.DB, email, await hashPassword(password))
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      console.warn(`[auth/signup] duplicate email attempted: ${email}`)
      return c.json({ error: 'Email already registered' }, 409)
    }
    throw err
  }
  const user = (await findUserByEmail(c.env.DB, email))!
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  const token = await signJWT({ sub: user.id, email, exp }, c.env.JWT_SECRET)
  console.log(`[auth/signup] created user ${user.id}`)
  return c.json({ token })
})

authRouter.post('/login', async (c) => {
  const { email: rawEmail, password } = await c.req.json<{ email: string; password: string }>()
  const email = rawEmail?.toLowerCase().trim()
  const user = await findUserByEmail(c.env.DB, email)
  if (!user) {
    console.warn(`[auth/login] failed login for ${email}`)
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  if (user.auth_provider === 'google') {
    console.warn(`[auth/login] password login blocked for Google-only user ${email}`)
    return c.json({ error: 'Use Google sign-in for this account' }, 401)
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    console.warn(`[auth/login] failed login for ${email}`)
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  const token = await signJWT({ sub: user.id, email, exp }, c.env.JWT_SECRET)
  console.log(`[auth/login] successful login for user ${user.id}`)
  return c.json({ token })
})
