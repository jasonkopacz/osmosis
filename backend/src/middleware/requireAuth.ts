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
  const user = await c.env.DB.prepare('SELECT email, plan FROM users WHERE id = ?')
    .bind(payload.userId)
    .first<{ email: string; plan: string }>()
  if (!user) {
    console.warn(`[requireAuth] token references missing user ${payload.userId}`)
    return c.json({ error: 'Invalid token user' }, 401)
  }
  console.log(`[requireAuth] authenticated user ${payload.userId} plan=${user.plan}`)
  c.set('userId', payload.userId)
  c.set('email', user.email)
  c.set('plan', user.plan)
  await next()
})
