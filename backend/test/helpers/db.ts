import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import type { D1Database } from '@cloudflare/workers-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export function createTestDb() {
  const db = new Database(':memory:')
  const runFile = (name: string) => {
    const schema = readFileSync(join(__dirname, '../../migrations', name), 'utf8')
    db.exec(schema)
  }
  // 0001–0005: core schema
  runFile('0001_initial.sql')
  runFile('0002_google_oauth.sql')
  runFile('0003_translation_cache.sql')
  runFile('0004_translation_cache_index.sql')
  runFile('0005_translation_pos.sql')
  // 0006–0008 added then removed meta/apple/microsoft OAuth; files deleted after 0009 landed
  runFile('0009_remove_meta_apple_microsoft.sql')
  runFile('0010_word_cards.sql')
  runFile('0011_user_verified.sql')
  runFile('0012_translation_cache_ttl.sql')
  runFile('0013_bad_translation.sql')
  runFile('0014_proper_nouns.sql')
  return db
}

export const mockKV: KVNamespace = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true, cursor: '', cacheStatus: null }),
  getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
} as unknown as KVNamespace

type BoundStmt = {
  first: <T>() => Promise<T | null>
  run: () => Promise<{ success: boolean; meta: { changes?: number } }>
  all: <T>() => Promise<{ results: T[] }>
  _rawRun: () => unknown
}

export function wrapDb(db: ReturnType<typeof createTestDb>): D1Database {
  const prepare = (sql: string) => {
    const stmt = db.prepare(sql)
    return {
      bind: (...args: unknown[]): BoundStmt => ({
        first: async <T>() => (stmt.get(...args) ?? null) as T | null,
        run: async () => { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes } } },
        all: async <T>() => ({ results: stmt.all(...args) as T[] }),
        _rawRun: () => stmt.run(...args),
      }),
      first: async <T>() => (stmt.get() ?? null) as T | null,
      run: async () => { stmt.run(); return { success: true, meta: {} } },
    }
  }

  return {
    prepare,
    batch: async (stmts: BoundStmt[]) => {
      const tx = db.transaction(() => stmts.map(s => { s._rawRun(); return { success: true, results: [], meta: {} } }))
      return tx()
    },
  } as unknown as D1Database
}
