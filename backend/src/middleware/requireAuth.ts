import { createMiddleware } from 'hono/factory'
import type { Env, Variables } from '../types'
import { verifyJWT } from '../utils/jwt'

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    console.warn('[requireAuth] missing or malformed authorization header')
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET)
  if (!payload) {
    console.warn('[requireAuth] invalid or expired JWT provided')
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  console.log(`[requireAuth] authenticated user ${payload.userId}`)
  c.set('userId', payload.userId)
  c.set('email', payload.email)
  await next()
})
