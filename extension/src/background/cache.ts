export class SessionCache {
  private store = new Map<string, string>()
  private readonly maxEntries = 5000
  private key = (word: string, lang: string) => `${word.toLowerCase()}::${lang}`
  get(word: string, lang: string): string | null {
    const k = this.key(word, lang)
    const hit = this.store.get(k)
    if (hit === undefined) return null
    // LRU: move to the end on access
    this.store.delete(k)
    this.store.set(k, hit)
    return hit
  }
  set(word: string, lang: string, val: string): void {
    const k = this.key(word, lang)
    if (this.store.has(k)) {
      this.store.delete(k)
      this.store.set(k, val)
      return
    }
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined
      if (oldestKey !== undefined) {
        console.log('[osmosis:bg] SessionCache evicting oldest entry')
        this.store.delete(oldestKey)
      }
    }
    this.store.set(k, val)
  }
  clear(): void {
    this.store.clear()
  }
}
