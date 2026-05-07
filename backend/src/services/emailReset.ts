import type { Env } from '../types'

const KV_PREFIX = 'pw_reset:'
const RESET_TTL_SEC = 60 * 60 // 1 hour

export type PendingResetPayload = { userId: string; email: string }

export function resetKvKey(token: string): string {
  return `${KV_PREFIX}${token}`
}

export async function storePendingReset(kv: KVNamespace, token: string, payload: PendingResetPayload): Promise<void> {
  await kv.put(resetKvKey(token), JSON.stringify(payload), { expirationTtl: RESET_TTL_SEC })
}

export async function takePendingReset(kv: KVNamespace, token: string): Promise<PendingResetPayload | null> {
  const key = resetKvKey(token.trim())
  const raw = await kv.get(key)
  if (!raw) return null
  await kv.delete(key)
  try { return JSON.parse(raw) as PendingResetPayload } catch { return null }
}

export function generateResetToken(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function buildResetEmailUrl(origin: string, token: string): string {
  const u = new URL('/auth/reset-password', origin)
  u.searchParams.set('t', token)
  return u.toString()
}

export function resetPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reset Password — Osmosis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #ecfeff; margin: 0; padding: 32px 20px; min-height: 100vh; }
    .card { max-width: 420px; margin: 0 auto; background: rgba(15,23,42,0.95); border: 1px solid rgba(56,189,248,0.25); border-radius: 16px; padding: 32px 28px; }
    .logo { font-size: 22px; font-weight: 800; color: #22d3ee; letter-spacing: -0.03em; margin-bottom: 20px; }
    h1 { font-size: 1.2rem; font-weight: 700; margin: 0 0 6px; }
    .hint { font-size: 13px; color: #94a3b8; margin: 0 0 20px; }
    .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
    label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(165,243,252,0.75); }
    input[type=password] { background: rgba(2,6,23,0.5); color: #ecfeff; border: 1px solid rgba(45,212,191,0.35); border-radius: 10px; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color .15s; }
    input[type=password]:focus { border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,0.2); }
    .error { color: #fca5a5; font-size: 12px; min-height: 16px; margin: 2px 0 10px; }
    button[type=submit] { width: 100%; background: linear-gradient(92deg, #06b6d4, #22d3ee); color: #042f2e; border: none; border-radius: 12px; padding: 11px; font-size: 14px; font-weight: 800; cursor: pointer; margin-top: 4px; }
    button[type=submit]:disabled { opacity: 0.6; cursor: default; }
    .success { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.4); border-radius: 10px; padding: 16px; font-size: 14px; color: #6ee7b7; line-height: 1.5; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">osmosis</div>
    <h1>Reset your password</h1>
    <p class="hint">Enter a new password for your Osmosis account.</p>
    <div id="form-wrap">
      <div class="field">
        <label for="pw">New password</label>
        <input id="pw" type="password" autocomplete="new-password" placeholder="At least 8 chars + special character" />
      </div>
      <div class="field">
        <label for="pw2">Confirm password</label>
        <input id="pw2" type="password" autocomplete="new-password" placeholder="Confirm new password" />
      </div>
      <p id="error" class="error"></p>
      <button id="submit" type="submit">Reset Password</button>
    </div>
    <div id="success" style="display:none" class="success">
      Password updated. You can close this tab and sign in to Osmosis.
    </div>
  </div>
  <script>
    const token = new URLSearchParams(window.location.search).get('t') || '';
    const SPECIAL = /[!@#$%^&*()_+\\-=[\\]{};':"\\\\|,.<>/?\`~]/;
    document.getElementById('submit').addEventListener('click', async () => {
      const pw = document.getElementById('pw').value;
      const pw2 = document.getElementById('pw2').value;
      const errEl = document.getElementById('error');
      errEl.textContent = '';
      if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
      if (!SPECIAL.test(pw)) { errEl.textContent = 'Password must include a special character (!@#$%^&*…).'; return; }
      if (pw !== pw2) { errEl.textContent = 'Passwords do not match.'; return; }
      const btn = document.getElementById('submit');
      btn.disabled = true;
      btn.textContent = 'Updating…';
      try {
        const res = await fetch('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password: pw }),
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || 'Reset failed. Try again.'; return; }
        document.getElementById('form-wrap').style.display = 'none';
        document.getElementById('success').style.display = 'block';
      } catch (e) {
        errEl.textContent = 'Network error. Please try again.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Reset Password';
      }
    });
  </script>
</body>
</html>`
}

export async function sendPasswordResetEmail(env: Env, toEmail: string, resetUrl: string): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) throw new Error('Email delivery is not configured')
  const from = env.EMAIL_FROM?.trim() || 'Osmosis <onboarding@resend.dev>'
  const safeUrl = resetUrl.replace(/"/g, '&quot;')
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
          <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#f0fdfa;">Reset your password</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">
            We received a request to reset your password. Click the button below — this link expires in 1 hour.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="border-radius:12px;background:linear-gradient(92deg,#06b6d4,#22d3ee);">
              <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:800;color:#042f2e;text-decoration:none;">
                Reset Password
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#475569;">Or copy this link:</p>
          <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
            <a href="${safeUrl}" style="color:#22d3ee;text-decoration:none;">${resetUrl}</a>
          </p>
          <hr style="border:none;border-top:1px solid rgba(148,163,184,0.15);margin:0 0 16px;">
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">
            If you didn't request a password reset, you can safely ignore this email.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [toEmail], subject: 'Reset your Osmosis password', html }),
  })
  if (!res.ok) {
    const t = await res.text()
    let detail = ''
    try { detail = (JSON.parse(t) as { message?: string }).message ?? '' } catch { /* ignore */ }
    throw new Error(detail || `Could not send reset email (Resend ${res.status})`)
  }
}
