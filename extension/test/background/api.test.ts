import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  loginWithEmail,
  refreshAuthToken,
  requestEmailSignup,
  requestPasswordReset,
  deleteAccount,
  translateBatch,
  fetchUser,
  fetchBillingUrl,
  srsRateWord,
  srsGetDue,
  srsGetStats,
  srsReportEncounters,
} from '../../src/background/api'

function mockResponse(status: number, body: unknown, contentType = 'application/json') {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(bodyText, {
    status,
    headers: { 'Content-Type': contentType },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loginWithEmail', () => {
  it('returns token on success', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { token: 'tok123', refreshToken: 'ref456' }))
    const result = await loginWithEmail('a@b.com', 'pass!')
    expect(result.token).toBe('tok123')
    expect(result.refreshToken).toBe('ref456')
  })

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(401, { error: 'Invalid credentials' }))
    await expect(loginWithEmail('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials')
  })

  it('throws when response body is an HTML page', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, '<!DOCTYPE html><html></html>', 'text/html'))
    await expect(loginWithEmail('a@b.com', 'p')).rejects.toThrow(/web page instead of JSON/)
  })

  it('throws when no token is in response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { ok: true }))
    await expect(loginWithEmail('a@b.com', 'p')).rejects.toThrow('No token received')
  })
})

describe('refreshAuthToken', () => {
  it('returns new tokens on success', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { token: 'newTok', refreshToken: 'newRef' }))
    const result = await refreshAuthToken('oldref')
    expect(result.token).toBe('newTok')
    expect(result.refreshToken).toBe('newRef')
  })

  it('throws on invalid refresh token', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(401, { error: 'Invalid or expired refresh token' }))
    await expect(refreshAuthToken('bad')).rejects.toThrow('Invalid or expired refresh token')
  })

  it('throws when response is missing tokens', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { ok: true }))
    await expect(refreshAuthToken('ref')).rejects.toThrow('Invalid refresh response')
  })
})

describe('requestEmailSignup', () => {
  it('resolves on success', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { ok: true }))
    await expect(requestEmailSignup('a@b.com', 'pass!', 'pass!')).resolves.toBeUndefined()
  })

  it('throws on error response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(400, { error: 'Valid email required' }))
    await expect(requestEmailSignup('bad', 'pass!', 'pass!')).rejects.toThrow('Valid email required')
  })
})

describe('requestPasswordReset', () => {
  it('resolves on success', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { ok: true }))
    await expect(requestPasswordReset('a@b.com')).resolves.toBeUndefined()
  })
})

describe('deleteAccount', () => {
  it('resolves on 200', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }))
    await expect(deleteAccount('tok')).resolves.toBeUndefined()
  })

  it('throws on error', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(401, { error: 'Unauthorized' }))
    await expect(deleteAccount('bad')).rejects.toThrow('Unauthorized')
  })
})

describe('translateBatch', () => {
  it('returns a Map of translations', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, { translations: { hello: { t: 'hallo', p: 'NOUN' } } })
    )
    const result = await translateBatch(['hello'], 'de', 'tok')
    expect(result.get('hello')).toEqual({ t: 'hallo', p: 'NOUN' })
  })

  it('normalises string translation values to TranslationEntry shape', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, { translations: { hello: 'hallo' } })
    )
    const result = await translateBatch(['hello'], 'de', 'tok')
    expect(result.get('hello')).toEqual({ t: 'hallo' })
  })

  it('throws LIMIT_REACHED on 402', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 402 }))
    await expect(translateBatch(['w'], 'de', 'tok')).rejects.toThrow('LIMIT_REACHED')
  })

  it('throws AUTH_EXPIRED on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(translateBatch(['w'], 'de', 'tok')).rejects.toThrow('AUTH_EXPIRED')
  })

  it('sends contextsByWord when provided', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { translations: {} }))
    await translateBatch(['hello'], 'de', 'tok', { hello: 'I said hello' })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)
    expect(body.contextsByWord).toEqual({ hello: 'I said hello' })
  })

  it('omits contextsByWord when empty', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { translations: {} }))
    await translateBatch(['hello'], 'de', 'tok', {})
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)
    expect(body.contextsByWord).toBeUndefined()
  })
})

describe('fetchUser', () => {
  it('returns UserProfile on success', async () => {
    const profile = { email: 'a@b.com', plan: 'free', usage: { used: 0, limit: 50000, resetsAt: '2026-06-01T00:00:00.000Z' } }
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, profile))
    const result = await fetchUser('tok')
    expect(result?.email).toBe('a@b.com')
  })

  it('returns null on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    const result = await fetchUser('tok')
    expect(result).toBeNull()
  })
})

describe('fetchBillingUrl', () => {
  it('returns url on success', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { url: 'https://checkout.stripe.com/abc' }))
    const url = await fetchBillingUrl('/user/checkout', 'tok')
    expect(url).toBe('https://checkout.stripe.com/abc')
  })

  it('throws AUTH_EXPIRED on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(fetchBillingUrl('/user/checkout', 'tok')).rejects.toThrow('AUTH_EXPIRED')
  })

  it('throws when url is missing from response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { ok: true }))
    await expect(fetchBillingUrl('/user/checkout', 'tok')).rejects.toThrow('No URL returned')
  })
})

describe('srsRateWord', () => {
  it('returns scheduling result on success', async () => {
    const result = { nextReview: 1000, stability: 7 }
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, result))
    const res = await srsRateWord('hello', 'de', 3, 'tok')
    expect(res).toMatchObject(result)
  })

  it('throws AUTH_EXPIRED on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(srsRateWord('w', 'de', 1, 'tok')).rejects.toThrow('AUTH_EXPIRED')
  })
})

describe('srsGetDue', () => {
  it('returns cards array', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { cards: [] }))
    const result = await srsGetDue('de', 'tok')
    expect(Array.isArray(result.cards)).toBe(true)
  })
})

describe('srsGetStats', () => {
  it('returns stats object', async () => {
    const stats = { totalCards: 5, dueToday: 2 }
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, stats))
    const result = await srsGetStats('de', 'tok')
    expect(result).toMatchObject(stats)
  })
})

describe('srsReportEncounters', () => {
  it('resolves silently on success', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }))
    await expect(srsReportEncounters(['hello'], 'de', 'tok')).resolves.toBeUndefined()
  })

  it('resolves silently even on failure (fire-and-forget)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }))
    await expect(srsReportEncounters(['hello'], 'de', 'tok')).resolves.toBeUndefined()
  })
})
