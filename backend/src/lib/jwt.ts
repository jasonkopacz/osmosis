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
): Promise<{ userId: string; email: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALG, false, ['verify'])
  const sigBytes = Uint8Array.from(atob(parts[2]!.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const valid = await crypto.subtle.verify(ALG, key, sigBytes, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!valid) return null
  const payload = JSON.parse(b64urlDecode(parts[1]!)) as Record<string, unknown>
  if (typeof payload['exp'] === 'number' && Date.now() / 1000 > payload['exp']) return null
  const sub = payload['sub']
  const email = payload['email']
  if (typeof sub !== 'string' || typeof email !== 'string') return null
  return { userId: sub, email }
}
