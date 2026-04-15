import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export function createTestDb() {
  const db = new Database(':memory:')
  const runFile = (name: string) => {
    const schema = readFileSync(join(__dirname, '../../migrations', name), 'utf8')
    schema.split(';').map(s => s.trim()).filter(Boolean).forEach(sql => db.prepare(sql).run())
  }
  runFile('0001_initial.sql')
  runFile('0002_google_oauth.sql')
  return db
}
