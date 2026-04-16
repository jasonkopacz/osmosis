export async function getCached(kv: KVNamespace, word: string, lang: string): Promise<string | null> {
  return kv.get(`${word.toLowerCase()}:${lang.toLowerCase()}`)
}

export async function setCached(kv: KVNamespace, word: string, lang: string, value: string): Promise<void> {
  await kv.put(`${word.toLowerCase()}:${lang.toLowerCase()}`, value)
}
