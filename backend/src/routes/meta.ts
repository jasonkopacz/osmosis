import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT } from '../utils/jwt'
import { hashPassword } from '../utils/passwords'
import {
  buildMetaAuthorizeUrl,
  exchangeMetaAuthCode,
  fetchMetaUserInfo,
  getMetaCredentials,
  isChromeExtensionRedirectUri,
} from '../services/meta'
import {
  createMetaUser,
  findUserByEmail,
  findUserByMetaSub,
  linkMetaToEmailUser,
  DuplicateEmailError,
} from '../db/users'

export const metaOAuthRouter = new Hono<{ Bindings: Env }>()

metaOAuthRouter.get('/url', async c => {
  const creds = getMetaCredentials(c.env)
  if (!creds) {
    return c.json({ error: 'Meta OAuth not configured (META_CLIENT_ID + META_CLIENT_SECRET)' }, 503)
  }
  const redirectUri = c.req.query('redirect_uri')?.trim()
  if (!redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'redirect_uri must be https://<extension-id>.chromiumapp.org/' }, 400)
  }
  const state = c.req.query('state')?.trim()
  if (!state) return c.json({ error: 'state parameter required' }, 400)
  const url = buildMetaAuthorizeUrl(creds.clientId, redirectUri, state)
  console.log('[auth/meta] authorize URL issued')
  return c.json({ url })
})

metaOAuthRouter.post('/exchange', async c => {
  if (!getMetaCredentials(c.env)) {
    return c.json({ error: 'Meta OAuth not configured (META_CLIENT_ID + META_CLIENT_SECRET)' }, 503)
  }

  const body = await c.req.json<{ code?: string; redirect_uri?: string }>()
  const code = body.code?.trim()
  const redirectUri = body.redirect_uri?.trim()
  if (!code || !redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'code and valid redirect_uri required' }, 400)
  }

  let tokens
  try {
    tokens = await exchangeMetaAuthCode(c.env, code, redirectUri)
  } catch {
    return c.json({ error: 'Meta token exchange failed' }, 401)
  }

  let profile
  try {
    profile = await fetchMetaUserInfo(tokens.access_token)
  } catch {
    return c.json({ error: 'Meta profile fetch failed' }, 401)
  }

  if (!profile.email || !profile.id) {
    return c.json({ error: 'Meta account email is required; enable email permission and ensure account has an email' }, 400)
  }

  const email = profile.email.toLowerCase()
  const metaSub = profile.id

  let user = await findUserByMetaSub(c.env.DB, metaSub)
  if (user) {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
    console.log(`[auth/meta] existing meta user ${user.id}`)
    return c.json({ token })
  }

  const byEmail = await findUserByEmail(c.env.DB, email)
  if (byEmail) {
    if (byEmail.meta_sub && byEmail.meta_sub !== metaSub) {
      return c.json({ error: 'This email is already linked to a different Meta account' }, 409)
    }
    if (!byEmail.meta_sub) {
      await linkMetaToEmailUser(c.env.DB, byEmail.id, metaSub)
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
      const token = await signJWT({ sub: byEmail.id, email: byEmail.email, plan: byEmail.plan, exp }, c.env.JWT_SECRET)
      console.log(`[auth/meta] linked Meta to ${byEmail.id}`)
      return c.json({ token })
    }
  }

  const randomPw = crypto.randomUUID() + crypto.randomUUID()
  const passwordHash = await hashPassword(randomPw)
  try {
    await createMetaUser(c.env.DB, email, metaSub, passwordHash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    throw err
  }

  const created = await findUserByEmail(c.env.DB, email)
  if (!created) {
    console.error(`[auth/meta] failed to retrieve newly created user for ${email}`)
    return c.json({ error: 'Account creation failed' }, 500)
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  const token = await signJWT({ sub: created.id, email: created.email, plan: created.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/meta] new user ${created.id}`)
  return c.json({ token })
})
