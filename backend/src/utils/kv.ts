export async function getCached(kv: KVNamespace, word: string, lang: string): Promise<string | null> {
  return kv.get(`${word.toLowerCase()}:${lang.toLowerCase()}`)
}

export async function setCached(kv: KVNamespace, word: string, lang: string, value: string): Promise<void> {
  const key = `${word.toLowerCase()}:${lang.toLowerCase()}`
  const ttlSeconds = 60 * 60 * 24 * 30
  console.log(`[kv] caching translation key=${key} ttl=${ttlSeconds}s`)
  await kv.put(key, value, { expirationTtl: ttlSeconds })
}
