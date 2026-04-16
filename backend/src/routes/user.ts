import { Hono } from 'hono'
import type { Env, Variables } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { getUsage } from '../db/usage'
import { getTopTranslations } from '../db/translations'
import { freeTierCharLimit } from '../utils/limits'
import { currentYearMonth } from '../utils/date'
import { VALID_LANGUAGE_CODES } from '../data/validLanguages'
import Stripe from 'stripe'

export const userRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

userRouter.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const plan = c.get('plan')
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId).first<{ email: string }>()
  if (!user) {
    console.warn(`[user/me] user not found for id ${userId}`)
    return c.json({ error: 'User not found' }, 404)
  }

  const charCount = await getUsage(c.env.DB, userId, currentYearMonth())
  const resetsAt = new Date()
  resetsAt.setUTCMonth(resetsAt.getUTCMonth() + 1, 1)
  resetsAt.setUTCHours(0, 0, 0, 0)
  console.log(`[user/me] user=${userId} plan=${plan} usage=${charCount}`)

  const freeLimit = freeTierCharLimit(c.env)
  return c.json({
    email: user.email,
    plan,
    usage: {
      used: charCount,
      limit: plan === 'pro' ? null : freeLimit,
      resetsAt: resetsAt.toISOString(),
    },
  })
})

userRouter.get('/cache-stats', requireAuth, async (c) => {
  const lang = c.req.query('lang')
  if (!lang || !VALID_LANGUAGE_CODES.has(lang)) return c.json({ error: 'Valid lang query param required' }, 400)
  const top = await getTopTranslations(c.env.DB, lang)
  return c.json({ lang, topTranslations: top })
})

userRouter.post('/checkout', requireAuth, async (c) => {
  const priceId = c.env.STRIPE_PRO_PRICE_ID?.trim()
  if (!priceId) {
    console.warn('[user/checkout] STRIPE_PRO_PRICE_ID is not set')
    return c.json({ error: 'Stripe price not configured. Set STRIPE_PRO_PRICE_ID in wrangler.toml or dashboard vars.' }, 503)
  }

  const userId = c.get('userId')
  const user = await c.env.DB.prepare('SELECT email, stripe_customer_id FROM users WHERE id = ?')
    .bind(userId).first<{ email: string; stripe_customer_id: string | null }>()

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'https://osmosis.app/success',
    cancel_url: 'https://osmosis.app/cancel',
    client_reference_id: userId,
    ...(user?.stripe_customer_id
      ? { customer: user.stripe_customer_id }
      : { customer_email: user?.email }),
  })
  console.log(`[user/checkout] created checkout session for user ${userId}`)
  return c.json({ url: session.url })
})

userRouter.post('/portal', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(userId).first<{ stripe_customer_id: string | null }>()

  if (!user?.stripe_customer_id) {
    console.warn(`[user/portal] no stripe_customer_id for user ${userId}`)
    return c.json({ error: 'No active subscription found' }, 404)
  }

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: 'https://osmosis.app',
  })
  console.log(`[user/portal] created portal session for user ${userId}`)
  return c.json({ url: session.url })
})
