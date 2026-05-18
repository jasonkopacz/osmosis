// OWASP 2023 minimum for PBKDF2-SHA-256 is 210,000 iterations.
// Legacy hashes stored as "salt:hash" used 100,000; new hashes store the count
// as "salt:iterations:hash" so verifyPassword can handle both formats.
const PBKDF2_ITERATIONS = 210_000

// A syntactically valid but unmatchable stored-hash used for constant-time dummy comparisons.
// Prevents timing-based email enumeration: login always runs PBKDF2, whether the user exists or not.
export const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(64)}`

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256)
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return `${toHex(salt)}:${PBKDF2_ITERATIONS}:${toHex(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')

  let saltHex: string, hashHex: string, iterations: number
  if (parts.length === 3) {
    // New format: salt:iterations:hash
    saltHex = parts[0]!
    iterations = parseInt(parts[1]!, 10)
    hashHex = parts[2]!
    if (isNaN(iterations) || iterations < 100_000) return false
  } else if (parts.length === 2) {
    // Legacy format: salt:hash — 100,000 iterations
    saltHex = parts[0]!
    hashHex = parts[1]!
    iterations = 100_000
  } else {
    return false
  }

  if (saltHex.length !== 32 || hashHex.length !== 64) return false

  const toBytes = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)))
  const salt = toBytes(saltHex)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  const candidate = new Uint8Array(bits)
  const storedBytes = toBytes(hashHex)

  // Constant-time comparison via HMAC under ephemeral key
  const hmacKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) as CryptoKey
  const macA = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, candidate))
  const macB = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, storedBytes))
  let diff = 0
  for (let i = 0; i < macA.length; i++) diff |= (macA[i] ?? 0) ^ (macB[i] ?? 0)
  return diff === 0
}
