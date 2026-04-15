export class SessionCache {
  private store = new Map<string, string>()
  private key = (word: string, lang: string) => `${word.toLowerCase()}::${lang}`
  get(word: string, lang: string): string | null {
    return this.store.get(this.key(word, lang)) ?? null
  }
  set(word: string, lang: string, val: string): void {
    this.store.set(this.key(word, lang), val)
  }
}
