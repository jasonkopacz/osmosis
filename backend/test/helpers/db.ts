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
    schema.split(';').map(s => s.trim()).filter(Boolean).forEach(sql => db.prepare(sql).run())
  }
  runFile('0001_initial.sql')
  runFile('0002_google_oauth.sql')
  runFile('0003_translation_cache.sql')
  return db
}

export function wrapDb(db: ReturnType<typeof createTestDb>): D1Database {
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        bind: (...args: unknown[]) => ({
          first: async <T>() => (stmt.get(...args) ?? null) as T | null,
          run: async () => { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes } } },
          all: async <T>() => ({ results: stmt.all(...args) as T[] }),
        }),
        first: async <T>() => (stmt.get() ?? null) as T | null,
        run: async () => { stmt.run(); return { success: true, meta: {} } },
      }
    },
  } as unknown as D1Database
}
