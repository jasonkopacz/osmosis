import { STORAGE_KEYS } from '../constants'
import type { TranslationEntry } from '../types'
import { log, warn } from '../logger'

const TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days
const MAX_ENTRIES = 2_000

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
  private pendingDeletes = new Set<string>()
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
      log('[osmosis:cache] chrome.storage.local unavailable, using in-memory cache only')
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
          .catch(err => warn('[osmosis:cache] evict expired failed', err))
      }
      log(`[osmosis:cache] loaded ${this.store.size} entries (${expired.length} expired evicted)`)
    } catch (err) {
      warn('[osmosis:cache] init failed, using empty cache', err)
    }
    this.resolveReady()
  }

  ensureReady(): Promise<void> {
    return this.readyPromise
  }

  get(word: string, lang: string): TranslationEntry | null {
    const k = this.makeKey(word, lang)
    const entry = this.store.get(k)
    if (!entry) return null
    // Promote to most-recently-used position
    this.store.delete(k)
    this.store.set(k, entry)
    return entry
  }

  set(word: string, lang: string, entry: TranslationEntry): void {
    const k = this.makeKey(word, lang)
    if (!this.store.has(k) && this.store.size >= MAX_ENTRIES) {
      const lru = this.store.keys().next().value
      if (lru !== undefined) {
        this.store.delete(lru)
        this.pendingDeletes.add(lru)
        this.pendingWrites.delete(lru)
      }
    }
    this.store.set(k, entry)
    this.pendingDeletes.delete(k)
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
    const deletes = new Set(this.pendingDeletes)
    this.pendingWrites.clear()
    this.pendingDeletes.clear()
    try {
      const r = await local.get(STORAGE_KEYS.TRANSLATION_CACHE)
      const stored = (r[STORAGE_KEYS.TRANSLATION_CACHE] ?? {}) as Record<string, StoredEntry>
      deletes.forEach(key => { delete stored[key] })
      writes.forEach((entry, key) => { stored[key] = entry })
      await local.set({ [STORAGE_KEYS.TRANSLATION_CACHE]: stored })
    } catch (err) {
      warn('[osmosis:cache] flush failed', err)
    }
  }

  clear(): void {
    this.store.clear()
    this.pendingWrites.clear()
    this.pendingDeletes.clear()
    this.flushScheduled = false
    const local = storageLocal()
    if (!local) return
    void local.remove(STORAGE_KEYS.TRANSLATION_CACHE)
      .catch(err => warn('[osmosis:cache] clear failed', err))
  }
}
