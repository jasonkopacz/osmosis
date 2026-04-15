import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/passwords'

describe('passwords', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong', await hashPassword('right'))).toBe(false)
  })

  it('produces different hashes each time (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('returns false for a malformed stored hash', async () => {
    expect(await verifyPassword('password', 'not-a-valid-hash')).toBe(false)
  })
})
