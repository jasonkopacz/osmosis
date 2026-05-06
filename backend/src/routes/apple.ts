import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT } from '../utils/jwt'
import { hashPassword } from '../utils/passwords'
import {
  buildAppleAuthorizeUrl,
  exchangeAppleAuthCode,
  getAppleCredentials,
  isChromeExtensionRedirectUri,
  parseAppleIdToken,
} from '../services/apple'
import {
  createAppleUser,
  findUserByAppleSub,
  findUserByEmail,
  linkAppleToEmailUser,
  DuplicateEmailError,
} from '../db/users'

export const appleOAuthRouter = new Hono<{ Bindings: Env }>()

appleOAuthRouter.get('/url', async c => {
  const creds = getAppleCredentials(c.env)
  if (!creds) {
    return c.json({ error: 'Apple OAuth not configured (APPLE_CLIENT_ID + APPLE_CLIENT_SECRET)' }, 503)
  }
  const redirectUri = c.req.query('redirect_uri')?.trim()
  if (!redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'redirect_uri must be https://<extension-id>.chromiumapp.org/' }, 400)
  }
  const state = c.req.query('state')?.trim()
  if (!state) return c.json({ error: 'state parameter required' }, 400)
  const url = buildAppleAuthorizeUrl(creds.clientId, redirectUri, state)
  console.log('[auth/apple] authorize URL issued')
  return c.json({ url })
})

appleOAuthRouter.post('/exchange', async c => {
  if (!getAppleCredentials(c.env)) {
    return c.json({ error: 'Apple OAuth not configured (APPLE_CLIENT_ID + APPLE_CLIENT_SECRET)' }, 503)
  }

  const body = await c.req.json<{ code?: string; redirect_uri?: string }>()
  const code = body.code?.trim()
  const redirectUri = body.redirect_uri?.trim()
  if (!code || !redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'code and valid redirect_uri required' }, 400)
  }

  let tokens
  try {
    tokens = await exchangeAppleAuthCode(c.env, code, redirectUri)
  } catch {
    return c.json({ error: 'Apple token exchange failed' }, 401)
  }

  let payload
  try {
    payload = parseAppleIdToken(tokens.id_token)
  } catch {
    return c.json({ error: 'Apple identity token parse failed' }, 401)
  }

  if (!payload.sub || !payload.email) {
    return c.json({ error: 'Apple account email is required; ensure email scope is granted' }, 400)
  }

  const email = payload.email.toLowerCase()
  const appleSub = payload.sub

  let user = await findUserByAppleSub(c.env.DB, appleSub)
  if (user) {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
    console.log(`[auth/apple] existing apple user ${user.id}`)
    return c.json({ token })
  }

  const byEmail = await findUserByEmail(c.env.DB, email)
  if (byEmail) {
    if (byEmail.apple_sub && byEmail.apple_sub !== appleSub) {
      return c.json({ error: 'This email is already linked to a different Apple account' }, 409)
    }
    if (!byEmail.apple_sub) {
      await linkAppleToEmailUser(c.env.DB, byEmail.id, appleSub)
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
      const token = await signJWT({ sub: byEmail.id, email: byEmail.email, plan: byEmail.plan, exp }, c.env.JWT_SECRET)
      console.log(`[auth/apple] linked Apple to ${byEmail.id}`)
      return c.json({ token })
    }
  }

  const randomPw = crypto.randomUUID() + crypto.randomUUID()
  const passwordHash = await hashPassword(randomPw)
  try {
    await createAppleUser(c.env.DB, email, appleSub, passwordHash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    throw err
  }

  const created = await findUserByEmail(c.env.DB, email)
  if (!created) {
    console.error(`[auth/apple] failed to retrieve newly created user for ${email}`)
    return c.json({ error: 'Account creation failed' }, 500)
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  const token = await signJWT({ sub: created.id, email: created.email, plan: created.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/apple] new user ${created.id}`)
  return c.json({ token })
})
