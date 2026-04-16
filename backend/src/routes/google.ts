import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT } from '../utils/jwt'
import { hashPassword } from '../utils/passwords'
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleAuthCode,
  fetchGoogleUserInfo,
  isChromeExtensionRedirectUri,
} from '../services/google'
import { createGoogleUser, findUserByEmail, findUserByGoogleSub, linkGoogleToEmailUser, DuplicateEmailError } from '../db/users'

export const googleOAuthRouter = new Hono<{ Bindings: Env }>()

googleOAuthRouter.get('/url', async c => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return c.json({ error: 'Google OAuth not configured (GOOGLE_CLIENT_ID)' }, 503)
  }
  const redirectUri = c.req.query('redirect_uri')?.trim()
  if (!redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'redirect_uri must be https://<extension-id>.chromiumapp.org/' }, 400)
  }
  const state = c.req.query('state')?.trim()
  if (!state) return c.json({ error: 'state parameter required' }, 400)
  const url = buildGoogleAuthorizeUrl(clientId, redirectUri, state)
  console.log('[auth/google] authorize URL issued')
  return c.json({ url })
})

googleOAuthRouter.post('/exchange', async c => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.json({ error: 'Google OAuth not configured' }, 503)
  }

  const body = await c.req.json<{ code?: string; redirect_uri?: string }>()
  const code = body.code?.trim()
  const redirectUri = body.redirect_uri?.trim()
  if (!code || !redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'code and valid redirect_uri required' }, 400)
  }

  let tokens
  try {
    tokens = await exchangeGoogleAuthCode(c.env, code, redirectUri)
  } catch {
    return c.json({ error: 'Google token exchange failed' }, 401)
  }

  let profile
  try {
    profile = await fetchGoogleUserInfo(tokens.access_token)
  } catch {
    return c.json({ error: 'Google profile fetch failed' }, 401)
  }

  if (!profile.email || !profile.sub || !profile.email_verified) {
    return c.json({ error: 'Google account email not verified' }, 400)
  }

  const email = profile.email.toLowerCase()
  const googleSub = profile.sub

  let user = await findUserByGoogleSub(c.env.DB, googleSub)
  if (user) {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    const token = await signJWT({ sub: user.id, email: user.email, exp }, c.env.JWT_SECRET)
    console.log(`[auth/google] existing google user ${user.id}`)
    return c.json({ token })
  }

  const byEmail = await findUserByEmail(c.env.DB, email)
  if (byEmail) {
    if (byEmail.google_sub && byEmail.google_sub !== googleSub) {
      return c.json({ error: 'This email is already linked to a different Google account' }, 409)
    }
    if (!byEmail.google_sub) {
      await linkGoogleToEmailUser(c.env.DB, byEmail.id, googleSub)
      const linked = (await findUserByEmail(c.env.DB, email))!
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
      const token = await signJWT({ sub: linked.id, email: linked.email, exp }, c.env.JWT_SECRET)
      console.log(`[auth/google] linked Google to ${linked.id}`)
      return c.json({ token })
    }
  }

  const randomPw = crypto.randomUUID() + crypto.randomUUID()
  const passwordHash = await hashPassword(randomPw)
  try {
    await createGoogleUser(c.env.DB, email, googleSub, passwordHash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    throw err
  }

  const created = (await findUserByEmail(c.env.DB, email))!
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  const token = await signJWT({ sub: created.id, email: created.email, exp }, c.env.JWT_SECRET)
  console.log(`[auth/google] new user ${created.id}`)
  return c.json({ token })
})
