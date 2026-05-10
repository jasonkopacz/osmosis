import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { authRouter } from './routes/auth'
import { googleOAuthRouter } from './routes/google'
import { translateRouter } from './routes/translate'
import { userRouter } from './routes/user'
import { stripeRouter } from './routes/stripe'
import { srsRouter } from './routes/srs'

const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error('[osmosis:api] unhandled error', err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return '*'
    const allowedId = c.env.CHROME_EXTENSION_ID
    if (allowedId && origin === `chrome-extension://${allowedId}`) return origin
    // Permit any extension origin when CHROME_EXTENSION_ID is not configured (local dev)
    if (!allowedId && origin.startsWith('chrome-extension://')) return origin
    return null
  },
  allowHeaders: ['Authorization', 'Content-Type'],
}))
app.use('*', async (c, next) => {
  console.log(`[request] ${c.req.method} ${c.req.path}`)
  await next()
})
app.route('/auth', authRouter)
app.route('/auth/google', googleOAuthRouter)
app.route('/translate', translateRouter)
app.route('/user', userRouter)
app.route('/stripe', stripeRouter)
app.route('/srs', srsRouter)
app.get('/health', (c) => c.json({ ok: true }))

export default app
