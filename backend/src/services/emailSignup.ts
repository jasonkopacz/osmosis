import type { Env } from '../types'

const KV_PREFIX = 'email_verify:'
const TOKEN_BYTES = 32
const VERIFY_TTL_SEC = 60 * 60 // 1 hour

export type PendingSignupPayload = {
  userId: string
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

export async function peekPendingSignup(kv: KVNamespace, token: string): Promise<boolean> {
  const key = verificationKvKey(token.trim())
  const raw = await kv.get(key)
  return raw !== null
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
  const safeUrl = verifyUrl.replace(/"/g, '&quot;')
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Banner -->
        <tr><td style="border-radius:16px 16px 0 0;overflow:hidden;line-height:0;">
          <img src="https://osmosis-api.jtkopacz.workers.dev/banner.png"
               alt="Osmosis — Learn a new language naturally"
               width="600" style="width:100%;max-width:600px;display:block;">
        </td></tr>

        <!-- Body card -->
        <tr><td style="background:rgba(15,23,42,0.95);border:1px solid rgba(56,189,248,0.2);border-top:none;border-radius:0 0 16px 16px;padding:32px 36px;">

          <!-- Logo + name -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <img src="https://osmosis-api.jtkopacz.workers.dev/logo.png"
                     alt="Osmosis logo" width="48" height="48"
                     style="display:block;border-radius:10px;">
              </td>
              <td style="vertical-align:middle;">
                <span style="font-size:20px;font-weight:800;color:#ecfeff;letter-spacing:-0.02em;">osmosis</span><br>
                <span style="font-size:11px;font-weight:600;color:#67e8f9;letter-spacing:0.12em;text-transform:uppercase;">Language Learning</span>
              </td>
            </tr>
          </table>

          <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f0fdfa;letter-spacing:-0.02em;">Confirm your email</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">
            Tap the button below to activate your account and start learning languages in context — right in your browser.
          </p>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="border-radius:12px;background:linear-gradient(92deg,#06b6d4,#22d3ee);">
              <a href="${safeUrl}"
                 style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:800;color:#042f2e;text-decoration:none;letter-spacing:0.01em;">
                Confirm email &amp; open Osmosis
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#475569;">
            Or copy this link into your browser:
          </p>
          <p style="margin:0 0 28px;font-size:12px;color:#334155;word-break:break-all;">
            <a href="${safeUrl}" style="color:#22d3ee;text-decoration:none;">${verifyUrl}</a>
          </p>

          <hr style="border:none;border-top:1px solid rgba(148,163,184,0.15);margin:0 0 20px;">
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">
            If you didn't create an Osmosis account, you can safely ignore this email.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()

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
    let detail = ''
    try { detail = (JSON.parse(t) as { message?: string }).message ?? '' } catch { /* ignore */ }
    throw new Error(detail || `Could not send verification email (Resend ${res.status})`)
  }
  console.log('[emailSignup] verification email sent', { to: toEmail })
}

export function buildVerifyEmailUrl(origin: string, token: string): string {
  const u = new URL('/auth/verify-email', origin)
  u.searchParams.set('t', token)
  return u.toString()
}
