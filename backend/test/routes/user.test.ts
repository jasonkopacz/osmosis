import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, wrapDb } from '../helpers/db'
import { signJWT } from '../../src/lib/jwt'
import { createUser, findUserByEmail, updatePlan } from '../../src/lib/db'
import type { Env, Variables } from '../../src/types'

const { mockCheckoutCreate, mockPortalCreate } = vi.hoisted(() => ({
  mockCheckoutCreate: vi.fn(),
  mockPortalCreate: vi.fn(),
}))

vi.mock('stripe', () => {
  class MockStripe {
    checkout = { sessions: { create: mockCheckoutCreate } }
    billingPortal = { sessions: { create: mockPortalCreate } }
  }
  return { default: MockStripe }
})

import { userRouter } from '../../src/routes/user'

const JWT_SECRET = 'test-secret-that-is-long-enough-32chars'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  app.route('/user', userRouter)
  return {
    app,
    env: {
      DB: db,
      JWT_SECRET,
      STRIPE_SECRET_KEY: 'sk_test_xxx',
      STRIPE_PRO_PRICE_ID: 'price_test_123',
      FREE_TIER_CHAR_LIMIT: '100000',
    } as unknown as Env,
  }
}

async function makeToken(userId: string, email = 'test@test.com') {
  return signJWT({ sub: userId, email }, JWT_SECRET)
}

describe('GET /user/me', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string

  beforeEach(async () => {
    db = wrapDb(createTestDb())
    await createUser(db, 'test@test.com', 'hashed')
    const user = await findUserByEmail(db, 'test@test.com')
    userId = user!.id
  })

  it('requires authentication', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/user/me', {}, env)
    expect(res.status).toBe(401)
  })

  it('returns user info with usage', async () => {
    const { app, env } = makeApp(db)
    const token = await makeToken(userId)
    const res = await app.request('/user/me', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { email: string; plan: string; usage: { used: number; limit: number } }
    expect(body.email).toBe('test@test.com')
    expect(body.plan).toBe('free')
    expect(body.usage.used).toBe(0)
    expect(body.usage.limit).toBe(100000)
  })

  it('returns null limit for pro users', async () => {
    const { app, env } = makeApp(db)
    await updatePlan(db, userId, 'pro', 'cus_123')
    const token = await makeToken(userId)
    const res = await app.request('/user/me', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { usage: { limit: null } }
    expect(body.usage.limit).toBeNull()
  })
})

describe('POST /user/checkout', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    db = wrapDb(createTestDb())
    await createUser(db, 'test@test.com', 'hashed')
    const user = await findUserByEmail(db, 'test@test.com')
    userId = user!.id
  })

  it('requires authentication', async () => {
    const { app, env } = makeApp(db)
    const res = await app.request('/user/checkout', { method: 'POST' }, env)
    expect(res.status).toBe(401)
  })

  it('returns 503 when STRIPE_PRO_PRICE_ID is not set', async () => {
    const { app } = makeApp(db)
    const env = { DB: db, JWT_SECRET, STRIPE_SECRET_KEY: 'sk_test' } as unknown as Env
    const token = await makeToken(userId)
    const res = await app.request('/user/checkout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(503)
  })

  it('creates a checkout session and returns url', async () => {
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/abc' })
    const { app, env } = makeApp(db)
    const token = await makeToken(userId)
    const res = await app.request('/user/checkout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ url: 'https://checkout.stripe.com/abc' })
  })
})

describe('POST /user/portal', () => {
  let db: ReturnType<typeof wrapDb>
  let userId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    db = wrapDb(createTestDb())
    await createUser(db, 'test@test.com', 'hashed')
    const user = await findUserByEmail(db, 'test@test.com')
    userId = user!.id
  })

  it('returns 404 when user has no stripe customer id', async () => {
    const { app, env } = makeApp(db)
    const token = await makeToken(userId)
    const res = await app.request('/user/portal', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'No active subscription found' })
  })

  it('creates a portal session and returns url', async () => {
    await updatePlan(db, userId, 'pro', 'cus_existing')
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/portal' })
    const { app, env } = makeApp(db)
    const token = await makeToken(userId)
    const res = await app.request('/user/portal', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ url: 'https://billing.stripe.com/portal' })
  })
})
