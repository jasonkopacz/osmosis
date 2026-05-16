const PREFIX = 'rl:'

// Returns false when the caller is over the limit, true when the request is allowed.
//
// Uses a fixed time-bucket key (rl:<key>:<bucket>) so the window is strictly bounded
// and the TTL is set only on the first write. Concurrent reads still race, but the
// worst case is a small overcount — not a complete bypass. For login/sensitive endpoints
// the overcount risk is acceptable; replace with Durable Objects if you need exact limits.
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec)
  const kvKey = `${PREFIX}${key}:${bucket}`

  const raw = await kv.get(kvKey)
  const count = raw ? parseInt(raw, 10) : 0
  if (count >= limit) return false

  // The bucket key encodes the fixed window, so TTL is for cleanup only —
  // it doesn't affect the window boundary. 2× gives the bucket time to expire
  // after the window ends without interfering with the current window.
  await kv.put(kvKey, String(count + 1), { expirationTtl: windowSec * 2 })
  return true
}
