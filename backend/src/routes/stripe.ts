import { Hono } from 'hono'
import type { Env } from '../types'
import Stripe from 'stripe'
import { updatePlan } from '../db/users'

export const stripeRouter = new Hono<{ Bindings: Env }>()

stripeRouter.post('/webhook', async (c) => {
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (
      session.client_reference_id &&
      typeof session.customer === 'string' &&
      session.payment_status === 'paid'
    ) {
      await updatePlan(c.env.DB, session.client_reference_id, 'pro', session.customer as string)
      console.log(`[stripe/webhook] upgraded user ${session.client_reference_id} to pro`)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer).id
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
      .bind(customerId).first<{ id: string }>()
    if (user) {
      await updatePlan(c.env.DB, user.id, 'free', customerId)
      console.log(`[stripe/webhook] downgraded user ${user.id} to free`)
    }
  }

  return c.json({ received: true })
})
