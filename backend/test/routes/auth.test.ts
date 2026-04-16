import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authRouter } from '../../src/routes/auth'
import { createTestDb, wrapDb } from '../helpers/db'
import type { Env } from '../../src/types'

function makeApp(db: ReturnType<typeof wrapDb>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/auth', authRouter)
  return { app, env: { DB: db, JWT_SECRET: 'x' } as unknown as Env }
}

function post(app: Hono<{ Bindings: Env }>, path: string, body: object, env: Env) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env)
}

describe('POST /auth/signup', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('is disabled (Google OAuth only)', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/signup', { email: 'new@test.com', password: 'password123' }, env)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Google') })
  })
})

describe('POST /auth/login', () => {
  let db: ReturnType<typeof wrapDb>

  beforeEach(() => {
    db = wrapDb(createTestDb())
  })

  it('is disabled (Google OAuth only)', async () => {
    const { app, env } = makeApp(db)
    const res = await post(app, '/auth/login', { email: 'user@test.com', password: 'password123' }, env)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Google') })
  })
})
