import { Hono } from 'hono'
import type { Env } from '../types'
import type Stripe from 'stripe'
import { updatePlan, findUserByStripeCustomerId } from '../db/users'
import { getStripe } from '../utils/stripe'

export const stripeRouter = new Hono<{ Bindings: Env }>()

async function downgradeByCustomerId(db: Env['DB'], kv: KVNamespace, customerId: string, reason: string): Promise<void> {
  const user = await findUserByStripeCustomerId(db, customerId)
  if (user) {
    await updatePlan(db, user.id, 'free', customerId)
    await kv.delete(`user_auth:${user.id}`)
    console.log(`[stripe/webhook] downgraded user ${user.id} to free (${reason})`)
  }
}

stripeRouter.post('/webhook', async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY)
  const sig = c.req.header('stripe-signature')
  if (!sig) {
    console.warn('[stripe/webhook] missing stripe-signature header')
    return c.json({ error: 'Missing signature' }, 400)
  }
  const body = await c.req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.warn(`[stripe/webhook] signature verification failed: ${String(err)}`)
    return c.json({ error: 'Invalid signature' }, 400)
  }
  console.log(`[stripe/webhook] received event type=${event.type}`)

  // Deduplicate re-delivered events
  const idempotencyKey = `stripe_event:${event.id}`
  const alreadyProcessed = await c.env.TRANSLATION_CACHE.get(idempotencyKey)
  if (alreadyProcessed) {
    console.log(`[stripe/webhook] duplicate event ${event.id}, skipping`)
    return c.json({ received: true })
  }
  await c.env.TRANSLATION_CACHE.put(idempotencyKey, '1', { expirationTtl: 60 * 60 * 24 })

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (
      session.client_reference_id &&
      typeof session.customer === 'string' &&
      session.payment_status === 'paid'
    ) {
      await updatePlan(c.env.DB, session.client_reference_id, 'pro', session.customer)
      await c.env.TRANSLATION_CACHE.delete(`user_auth:${session.client_reference_id}`)
      console.log(`[stripe/webhook] upgraded user ${session.client_reference_id} to pro`)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer).id
    await downgradeByCustomerId(c.env.DB, c.env.TRANSLATION_CACHE, customerId, 'subscription deleted')
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.paused') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer).id
    if (['past_due', 'unpaid', 'canceled', 'incomplete_expired', 'paused'].includes(sub.status)) {
      await downgradeByCustomerId(c.env.DB, c.env.TRANSLATION_CACHE, customerId, `subscription ${sub.status}`)
    }
  }

  // invoice.payment_failed is intentionally not handled here — Stripe retries failed invoices
  // multiple times before canceling. customer.subscription.updated with status 'past_due'/'unpaid'
  // and customer.subscription.deleted above already cover the eventual downgrade path.

  return c.json({ received: true })
})
