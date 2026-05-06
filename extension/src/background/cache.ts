import { STORAGE_KEYS } from '../constants'
import type { TranslationEntry } from '../types'

const TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

interface StoredEntry { v: TranslationEntry | string; t: number }

function coerce(v: TranslationEntry | string): TranslationEntry {
  return typeof v === 'string' ? { t: v } : v
}

function storageLocal(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null
}

export class SessionCache {
  private store = new Map<string, TranslationEntry>()
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private pendingWrites = new Map<string, StoredEntry>()
  private flushScheduled = false

  constructor() {
    this.readyPromise = new Promise(resolve => { this.resolveReady = resolve })
  }

  private makeKey(word: string, lang: string): string {
    return `${word.toLowerCase()}::${lang}`
  }

  async init(): Promise<void> {
    const local = storageLocal()
    if (!local) {
      console.log('[osmosis:cache] chrome.storage.local unavailable, using in-memory cache only')
      this.resolveReady()
      return
    }
    try {
      const r = await local.get(STORAGE_KEYS.TRANSLATION_CACHE)
      const stored = (r[STORAGE_KEYS.TRANSLATION_CACHE] ?? {}) as Record<string, StoredEntry>
      const now = Date.now()
      const expired: string[] = []
      for (const [key, entry] of Object.entries(stored)) {
        if (now - entry.t < TTL_MS) {
          this.store.set(key, coerce(entry.v))
        } else {
          expired.push(key)
        }
      }
      if (expired.length > 0) {
        const cleaned = { ...stored }
        for (const k of expired) delete cleaned[k]
        void local.set({ [STORAGE_KEYS.TRANSLATION_CACHE]: cleaned })
          .catch(err => console.warn('[osmosis:cache] evict expired failed', err))
      }
      console.log(`[osmosis:cache] loaded ${this.store.size} entries (${expired.length} expired evicted)`)
    } catch (err) {
      console.warn('[osmosis:cache] init failed, using empty cache', err)
    }
    this.resolveReady()
  }

  ensureReady(): Promise<void> {
    return this.readyPromise
  }

  get(word: string, lang: string): TranslationEntry | null {
    return this.store.get(this.makeKey(word, lang)) ?? null
  }

  set(word: string, lang: string, entry: TranslationEntry): void {
    const k = this.makeKey(word, lang)
    this.store.set(k, entry)
    this.pendingWrites.set(k, { v: entry, t: Date.now() })
    if (!this.flushScheduled) {
      this.flushScheduled = true
      void Promise.resolve().then(() => this.flush())
    }
  }

  private async flush(): Promise<void> {
    const local = storageLocal()
    if (!local) return
    this.flushScheduled = false
    const writes = new Map(this.pendingWrites)
    this.pendingWrites.clear()
    try {
      const r = await local.get(STORAGE_KEYS.TRANSLATION_CACHE)
      const stored = (r[STORAGE_KEYS.TRANSLATION_CACHE] ?? {}) as Record<string, StoredEntry>
      writes.forEach((entry, key) => { stored[key] = entry })
      await local.set({ [STORAGE_KEYS.TRANSLATION_CACHE]: stored })
    } catch (err) {
      console.warn('[osmosis:cache] flush failed', err)
    }
  }

  clear(): void {
    this.store.clear()
    this.pendingWrites.clear()
    this.flushScheduled = false
    const local = storageLocal()
    if (!local) return
    void local.remove(STORAGE_KEYS.TRANSLATION_CACHE)
      .catch(err => console.warn('[osmosis:cache] clear failed', err))
  }
}
