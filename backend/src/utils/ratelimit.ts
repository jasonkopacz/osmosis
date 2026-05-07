const PREFIX = 'rl:'

// Returns false when the caller is over the limit, true when the request is allowed.
// Uses KV as an atomic-enough counter; occasional races at window boundaries are acceptable.
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const raw = await kv.get(`${PREFIX}${key}`)
  const count = raw ? parseInt(raw, 10) : 0
  if (count >= limit) return false
  await kv.put(`${PREFIX}${key}`, String(count + 1), { expirationTtl: windowSec })
  return true
}
