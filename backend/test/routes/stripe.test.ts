import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, wrapDb } from '../helpers/db'
import { createUser, findUserByEmail } from '../../src/db/users'
import type { Env } from '../../src/types'

const mockConstructEventAsync = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    webhooks = {
      constructEventAsync: (...args: unknown[]) => mockConstructEventAsync(...args),
    }
  },
}))

import { stripeRouter } from '../../src/routes/stripe'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/stripe', stripeRouter)
  return {
    app,
    env: {
      DB: db,
      STRIPE_SECRET_KEY: 'sk_test_xxx',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
    } as unknown as Env,
  }
}

async function postWebhook(app: Hono<{ Bindings: Env }>, env: Env, body: string, sig?: string) {
  return app.request('/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sig ? { 'stripe-signature': sig } : {}),
    },
    body,
  }, env)
}

describe('POST /stripe/webhook', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    db = wrapDb(createTestDb())
    await createUser(db, 'sub@test.com', 'h')
    const u = await findUserByEmail(db, 'sub@test.com')
    userId = u!.id
  })

  it('returns 400 without stripe-signature', async () => {
    const { app, env } = makeApp(db)
    const res = await postWebhook(app, env, '{}')
    expect(res.status).toBe(400)
  })

  it('returns 400 when signature verification fails', async () => {
    const { app, env } = makeApp(db)
    mockConstructEventAsync.mockRejectedValueOnce(new Error('bad sig'))
    const res = await postWebhook(app, env, '{}', 'sig')
    expect(res.status).toBe(400)
  })

  it('upgrades user on checkout.session.completed when paid', async () => {
    const { app, env } = makeApp(db)
    mockConstructEventAsync.mockResolvedValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          customer: 'cus_upgrade',
          payment_status: 'paid',
        },
      },
    })
    const res = await postWebhook(app, env, '{}', 'sig')
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'sub@test.com'))!
    expect(user.plan).toBe('pro')
    expect(user.stripe_customer_id).toBe('cus_upgrade')
  })

  it('downgrades on customer.subscription.deleted', async () => {
    const { app, env } = makeApp(db)
    mockConstructEventAsync.mockResolvedValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          customer: 'cus_down',
          payment_status: 'paid',
        },
      },
    })
    await postWebhook(app, env, '{}', 'sig')

    mockConstructEventAsync.mockResolvedValueOnce({
      type: 'customer.subscription.deleted',
      data: {
        object: { customer: 'cus_down' },
      },
    })
    const res = await postWebhook(app, env, '{}', 'sig2')
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'sub@test.com'))!
    expect(user.plan).toBe('free')
  })

  it('downgrades on subscription.updated to past_due', async () => {
    const { app, env } = makeApp(db)
    mockConstructEventAsync.mockResolvedValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          customer: 'cus_pd',
          payment_status: 'paid',
        },
      },
    })
    await postWebhook(app, env, '{}', 'sig')

    mockConstructEventAsync.mockResolvedValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: { customer: 'cus_pd', status: 'past_due' },
      },
    })
    const res = await postWebhook(app, env, '{}', 'sig2')
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'sub@test.com'))!
    expect(user.plan).toBe('free')
  })
})
