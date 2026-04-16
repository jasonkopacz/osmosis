import { describe, it, expect } from 'vitest'
import { signJWT, verifyJWT } from '../src/utils/jwt'

const SECRET = 'test-secret-that-is-long-enough-32chars'

describe('JWT', () => {
  it('round-trips a valid token', async () => {
    const token = await signJWT({ sub: 'user-1', email: 'a@b.com' }, SECRET)
    expect(await verifyJWT(token, SECRET)).toEqual({ userId: 'user-1', email: 'a@b.com' })
  })

  it('returns null for a tampered token', async () => {
    const token = await signJWT({ sub: 'user-1', email: 'a@b.com' }, SECRET)
    expect(await verifyJWT(token.slice(0, -3) + 'xxx', SECRET)).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const token = await signJWT(
      { sub: 'user-1', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET
    )
    expect(await verifyJWT(token, SECRET)).toBeNull()
  })

  it('returns null for a token signed with a different secret', async () => {
    const token = await signJWT({ sub: 'user-1', email: 'a@b.com' }, SECRET)
    expect(await verifyJWT(token, 'different-secret-also-32-chars!!!')).toBeNull()
  })

  it('returns null for a payload missing required claims', async () => {
    const token = await signJWT({ foo: 'bar' }, SECRET)
    expect(await verifyJWT(token, SECRET)).toBeNull()
  })
})
