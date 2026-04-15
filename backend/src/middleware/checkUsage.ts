import { createMiddleware } from 'hono/factory'
import type { Env, Variables } from '../types'
import { getUsage } from '../lib/db'
import { freeTierCharLimit } from '../lib/limits'

function currentYearMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const checkUsage = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const userId = c.get('userId')
  const row = await c.env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first<{ plan: string }>()
  if (row?.plan === 'pro') {
    console.log(`[checkUsage] user ${userId} is pro, skipping usage gate`)
    await next()
    return
  }
  const count = await getUsage(c.env.DB, userId, currentYearMonth())
  const limit = freeTierCharLimit(c.env)
  console.log(`[checkUsage] user ${userId} usage=${count} limit=${limit}`)
  if (count >= limit) {
    console.warn(`[checkUsage] user ${userId} hit monthly free limit`)
    return c.json({ error: 'Monthly limit reached', code: 'LIMIT_REACHED' }, 402)
  }
  await next()
})
