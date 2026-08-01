import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { KVNamespace } from '@cloudflare/workers-types'
import { createTestDb, wrapDb, mockKV } from '../helpers/db'
import { createUser, findUserByEmail, updatePlan } from '../../src/db/users'
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

function createMemoryKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v) },
    delete: async (k: string) => { store.delete(k) },
  } as unknown as KVNamespace
}

function makeApp(db: ReturnType<typeof wrapDb>, kv: KVNamespace = mockKV) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/stripe', stripeRouter)
  return {
    app,
    env: {
      DB: db,
      TRANSLATION_CACHE: kv,
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

  it('downgrades on customer.subscription.paused', async () => {
    const kv = createMemoryKV()
    const { app, env } = makeApp(db, kv)
    // Pre-upgrade the user directly so we don't rely on a prior checkout event
    await updatePlan(db, userId, 'pro', 'cus_paused')

    mockConstructEventAsync.mockResolvedValueOnce({
      id: 'evt_paused_1',
      type: 'customer.subscription.paused',
      data: {
        object: { customer: 'cus_paused', status: 'paused' },
      },
    })
    const res = await postWebhook(app, env, '{}', 'sig-paused')
    expect(res.status).toBe(200)
    const user = (await findUserByEmail(db, 'sub@test.com'))!
    expect(user.plan).toBe('free')
    expect(user.stripe_customer_id).toBe('cus_paused')
  })

  it('deduplicates re-delivered events with the same event.id (KV idempotency)', async () => {
    const kv = createMemoryKV()
    const { app, env } = makeApp(db, kv)

    // First delivery: paid → upgrade
    mockConstructEventAsync.mockResolvedValueOnce({
      id: 'evt_dup_upgrade',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          customer: 'cus_dup',
          payment_status: 'paid',
        },
      },
    })
    const first = await postWebhook(app, env, '{}', 'sig-first')
    expect(first.status).toBe(200)
    expect((await findUserByEmail(db, 'sub@test.com'))!.plan).toBe('pro')

    // Simulate a state change between deliveries — a manual downgrade in DB.
    // If the second delivery is NOT deduplicated, it will re-apply the upgrade
    // and stomp the manual downgrade back to 'pro'. Idempotency must prevent that.
    await updatePlan(db, userId, 'free', 'cus_dup')
    expect((await findUserByEmail(db, 'sub@test.com'))!.plan).toBe('free')

    // Second delivery of the SAME event id: should be a no-op
    mockConstructEventAsync.mockResolvedValueOnce({
      id: 'evt_dup_upgrade',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          customer: 'cus_dup',
          payment_status: 'paid',
        },
      },
    })
    const second = await postWebhook(app, env, '{}', 'sig-second')
    expect(second.status).toBe(200)
    expect((await findUserByEmail(db, 'sub@test.com'))!.plan).toBe('free')
  })
})
