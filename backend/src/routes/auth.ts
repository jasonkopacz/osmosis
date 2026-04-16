import { Hono } from 'hono'
import type { Env } from '../types'

export const authRouter = new Hono<{ Bindings: Env }>()

authRouter.post('/signup', c => {
  console.warn('[auth/signup] rejected — Google OAuth only')
  return c.json({ error: 'Email/password sign-up is disabled. Use Google sign-in.' }, 403)
})

authRouter.post('/login', c => {
  console.warn('[auth/login] rejected — Google OAuth only')
  return c.json({ error: 'Email/password sign-in is disabled. Use Google sign-in.' }, 403)
})
