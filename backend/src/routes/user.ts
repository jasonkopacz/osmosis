import { Hono } from 'hono'
import type { Env, Variables } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { getUsage } from '../lib/db'
import { freeTierCharLimit } from '../lib/limits'
import Stripe from 'stripe'

function currentYearMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const userRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

userRouter.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB.prepare('SELECT id, email, plan FROM users WHERE id = ?')
    .bind(userId).first<{ id: string; email: string; plan: string }>()
  if (!user) {
    console.warn(`[user/me] user not found for id ${userId}`)
    return c.json({ error: 'User not found' }, 404)
  }

  const charCount = await getUsage(c.env.DB, userId, currentYearMonth())
  const resetsAt = new Date()
  resetsAt.setUTCMonth(resetsAt.getUTCMonth() + 1, 1)
  resetsAt.setUTCHours(0, 0, 0, 0)
  console.log(`[user/me] user=${userId} plan=${user.plan} usage=${charCount}`)

  const freeLimit = freeTierCharLimit(c.env)
  return c.json({
    email: user.email,
    plan: user.plan,
    usage: {
      used: charCount,
      limit: user.plan === 'pro' ? null : freeLimit,
      resetsAt: resetsAt.toISOString(),
    },
  })
})

userRouter.post('/checkout', requireAuth, async (c) => {
  const priceId = c.env.STRIPE_PRO_PRICE_ID?.trim()
  if (!priceId) {
    console.warn('[user/checkout] STRIPE_PRO_PRICE_ID is not set')
    return c.json({ error: 'Stripe price not configured. Set STRIPE_PRO_PRICE_ID in wrangler.toml or dashboard vars.' }, 503)
  }

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'https://osmosis.app/success',
    cancel_url: 'https://osmosis.app/cancel',
    client_reference_id: c.get('userId'),
  })
  console.log(`[user/checkout] created checkout session for user ${c.get('userId')}`)
  return c.json({ url: session.url })
})
