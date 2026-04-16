import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { authRouter } from './routes/auth'
import { googleOAuthRouter } from './routes/google'
import { translateRouter } from './routes/translate'
import { userRouter } from './routes/user'
import { stripeRouter } from './routes/stripe'

const app = new Hono<{ Bindings: Env }>()
app.use('*', cors({
  // Allow Chrome extension pages and non-browser clients (e.g. extension SW, curl).
  // Reject all other web origins to prevent cross-site token abuse.
  origin: (origin) => {
    if (!origin) return '*'
    if (origin.startsWith('chrome-extension://')) return origin
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
app.get('/health', (c) => c.json({ ok: true }))

export default app
