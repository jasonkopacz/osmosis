import { Hono } from 'hono'
import type { Env } from '../types'
import { signJWT } from '../utils/jwt'
import { hashPassword } from '../utils/passwords'
import {
  buildMicrosoftAuthorizeUrl,
  exchangeMicrosoftAuthCode,
  fetchMicrosoftUserInfo,
  getMicrosoftCredentials,
  isChromeExtensionRedirectUri,
} from '../services/microsoft'
import {
  createMicrosoftUser,
  findUserByEmail,
  findUserByMicrosoftSub,
  linkMicrosoftToEmailUser,
  DuplicateEmailError,
} from '../db/users'

export const microsoftOAuthRouter = new Hono<{ Bindings: Env }>()

microsoftOAuthRouter.get('/url', async c => {
  const creds = getMicrosoftCredentials(c.env)
  if (!creds) {
    return c.json({ error: 'Microsoft OAuth not configured (MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET)' }, 503)
  }
  const redirectUri = c.req.query('redirect_uri')?.trim()
  if (!redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'redirect_uri must be https://<extension-id>.chromiumapp.org/' }, 400)
  }
  const state = c.req.query('state')?.trim()
  if (!state) return c.json({ error: 'state parameter required' }, 400)
  const url = buildMicrosoftAuthorizeUrl(creds.clientId, redirectUri, state)
  console.log('[auth/microsoft] authorize URL issued')
  return c.json({ url })
})

microsoftOAuthRouter.post('/exchange', async c => {
  if (!getMicrosoftCredentials(c.env)) {
    return c.json({ error: 'Microsoft OAuth not configured (MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET)' }, 503)
  }

  const body = await c.req.json<{ code?: string; redirect_uri?: string }>()
  const code = body.code?.trim()
  const redirectUri = body.redirect_uri?.trim()
  if (!code || !redirectUri || !isChromeExtensionRedirectUri(redirectUri)) {
    return c.json({ error: 'code and valid redirect_uri required' }, 400)
  }

  let tokens
  try {
    tokens = await exchangeMicrosoftAuthCode(c.env, code, redirectUri)
  } catch {
    return c.json({ error: 'Microsoft token exchange failed' }, 401)
  }

  let profile
  try {
    profile = await fetchMicrosoftUserInfo(tokens.access_token)
  } catch {
    return c.json({ error: 'Microsoft profile fetch failed' }, 401)
  }

  const emailRaw = profile.mail ?? profile.userPrincipalName
  if (!profile.id || !emailRaw) {
    return c.json({ error: 'Microsoft account email is required' }, 400)
  }

  const email = emailRaw.toLowerCase()
  const microsoftSub = profile.id

  let user = await findUserByMicrosoftSub(c.env.DB, microsoftSub)
  if (user) {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    const token = await signJWT({ sub: user.id, email: user.email, plan: user.plan, exp }, c.env.JWT_SECRET)
    console.log(`[auth/microsoft] existing microsoft user ${user.id}`)
    return c.json({ token })
  }

  const byEmail = await findUserByEmail(c.env.DB, email)
  if (byEmail) {
    if (byEmail.microsoft_sub && byEmail.microsoft_sub !== microsoftSub) {
      return c.json({ error: 'This email is already linked to a different Microsoft account' }, 409)
    }
    if (!byEmail.microsoft_sub) {
      await linkMicrosoftToEmailUser(c.env.DB, byEmail.id, microsoftSub)
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
      const token = await signJWT({ sub: byEmail.id, email: byEmail.email, plan: byEmail.plan, exp }, c.env.JWT_SECRET)
      console.log(`[auth/microsoft] linked Microsoft to ${byEmail.id}`)
      return c.json({ token })
    }
  }

  const randomPw = crypto.randomUUID() + crypto.randomUUID()
  const passwordHash = await hashPassword(randomPw)
  try {
    await createMicrosoftUser(c.env.DB, email, microsoftSub, passwordHash)
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    throw err
  }

  const created = await findUserByEmail(c.env.DB, email)
  if (!created) {
    console.error(`[auth/microsoft] failed to retrieve newly created user for ${email}`)
    return c.json({ error: 'Account creation failed' }, 500)
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  const token = await signJWT({ sub: created.id, email: created.email, plan: created.plan, exp }, c.env.JWT_SECRET)
  console.log(`[auth/microsoft] new user ${created.id}`)
  return c.json({ token })
})
