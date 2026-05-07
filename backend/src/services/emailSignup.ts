import type { Env } from '../types'

const KV_PREFIX = 'email_verify:'
const TOKEN_BYTES = 32
const VERIFY_TTL_SEC = 60 * 60 * 24 * 7

export type PendingSignupPayload = {
  email: string
  password_hash: string
}

export function verificationKvKey(token: string): string {
  return `${KV_PREFIX}${token}`
}

export async function storePendingSignup(
  kv: KVNamespace,
  token: string,
  payload: PendingSignupPayload
): Promise<void> {
  await kv.put(verificationKvKey(token), JSON.stringify(payload), { expirationTtl: VERIFY_TTL_SEC })
}

export async function takePendingSignup(kv: KVNamespace, token: string): Promise<PendingSignupPayload | null> {
  const key = verificationKvKey(token.trim())
  const raw = await kv.get(key)
  if (!raw) return null
  await kv.delete(key)
  try {
    return JSON.parse(raw) as PendingSignupPayload
  } catch {
    return null
  }
}

export function generateVerifyToken(): string {
  const buf = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function sendSignupConfirmationEmail(
  env: Env,
  toEmail: string,
  verifyUrl: string
): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.error('[emailSignup] RESEND_API_KEY not set; cannot send verification email')
    throw new Error('Email delivery is not configured')
  }
  const from = env.EMAIL_FROM?.trim() || 'Osmosis <onboarding@resend.dev>'
  const subject = 'Confirm your Osmosis account'
  const html = `
<p>Hi,</p>
<p>Tap the button below to confirm your email and open Osmosis. Your account is created when you confirm.</p>
<p style="margin:24px 0">
  <a href="${verifyUrl.replace(/"/g, '&quot;')}" style="display:inline-block;background:#0891b2;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">
    Confirm email &amp; return to Osmosis
  </a>
</p>
<p style="font-size:13px;color:#64748b">If you did not request this, you can ignore this message.</p>
<p style="font-size:12px;color:#94a3b8">${verifyUrl}</p>
`.trim()

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [toEmail], subject, html }),
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn('[emailSignup] Resend failed', res.status, t)
    throw new Error('Could not send verification email')
  }
  console.log('[emailSignup] verification email sent', { to: toEmail })
}

export function buildVerifyEmailUrl(origin: string, token: string): string {
  const u = new URL('/auth/verify-email', origin)
  u.searchParams.set('t', token)
  return u.toString()
}
