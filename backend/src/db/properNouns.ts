import type { D1Database } from '@cloudflare/workers-types'

const CHUNK_SIZE = 99

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function recordProperNoun(db: D1Database, word: string, userId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO proper_nouns (word, reported_by) VALUES (?, ?)')
    .bind(word.toLowerCase(), userId)
    .run()
}

export async function batchGetProperNouns(db: D1Database, words: string[]): Promise<Set<string>> {
  if (words.length === 0) return new Set()
  const lower = words.map(w => w.toLowerCase())
  const results = await Promise.all(
    chunk(lower, CHUNK_SIZE).map(batch => {
      const placeholders = batch.map(() => '?').join(', ')
      return db
        .prepare(`SELECT word FROM proper_nouns WHERE word IN (${placeholders})`)
        .bind(...batch)
        .all<{ word: string }>()
        .then(r => r.results)
    })
  )
  return new Set(results.flat().map(r => r.word))
}
