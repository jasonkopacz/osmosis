const ALG = { name: 'HMAC', hash: 'SHA-256' }

const b64url = (buf: ArrayBuffer) => {
  let bin = ''
  for (const byte of new Uint8Array(buf)) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

const b64urlEncode = (obj: object) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

const b64urlDecode = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

export async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64urlEncode({ alg: 'HS256', typ: 'JWT' })
  const body = b64urlEncode(payload)
  const data = `${header}.${body}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALG, false, ['sign'])
  const sig = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(data))
  return `${data}.${b64url(sig)}`
}

export async function verifyJWT(
  token: string, secret: string
): Promise<{ userId: string; email: string; plan: 'free' | 'pro' } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header64, payload64, sig64] = parts as [string, string, string]

  try {
    const header = JSON.parse(b64urlDecode(header64)) as Record<string, unknown>
    if (header['alg'] !== 'HS256') return null
  } catch {
    return null
  }

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALG, false, ['verify'])

  let sigBytes: Uint8Array
  try {
    sigBytes = Uint8Array.from(atob(sig64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  } catch {
    return null
  }

  const valid = await crypto.subtle.verify(ALG, key, sigBytes, new TextEncoder().encode(`${header64}.${payload64}`))
  if (!valid) return null

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(b64urlDecode(payload64)) as Record<string, unknown>
  } catch {
    return null
  }

  if (typeof payload['exp'] === 'number' && Date.now() / 1000 >= payload['exp']) return null

  const sub = payload['sub']
  const email = payload['email']
  if (typeof sub !== 'string' || typeof email !== 'string') return null
  const planRaw = typeof payload['plan'] === 'string' ? payload['plan'] : 'free'
  const plan: 'free' | 'pro' = planRaw === 'pro' ? 'pro' : 'free'
  return { userId: sub, email, plan }
}
