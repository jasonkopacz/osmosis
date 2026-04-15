export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256)
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const colonIdx = stored.indexOf(':')
  if (colonIdx === -1) return false
  const saltHex = stored.slice(0, colonIdx)
  const hashHex = stored.slice(colonIdx + 1)
  if (saltHex.length !== 32 || hashHex.length !== 64) return false

  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256)
  const candidate = new Uint8Array(bits)
  const storedBytes = new Uint8Array(hashHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))

  // Constant-time comparison: HMAC both values under the same ephemeral key and compare MACs
  const hmacKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) as CryptoKey
  const macA = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, candidate))
  const macB = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, storedBytes))
  if (macA.length !== macB.length) return false
  let diff = 0
  for (let i = 0; i < macA.length; i++) diff |= macA[i]! ^ macB[i]!
  return diff === 0
}
