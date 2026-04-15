import { WORD_RANK } from '../data/wordFrequency'

const MAX_WORDS = 200

export function scoreWord(word: string): number {
  const rank = WORD_RANK[word.toLowerCase()]
  if (!rank) return 0
  if (rank < 100) return 1
  if (rank <= 3000) return 3
  return 2
}

function hashSeed(url: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sampleWords(candidates: string[], percentage: number, pageUrl: string): string[] {
  const count = Math.min(Math.round(candidates.length * (percentage / 100)), MAX_WORDS)
  const rng = seededRng(hashSeed(pageUrl))
  const scored = candidates
    .map(w => ({ word: w, score: scoreWord(w), r: rng() }))
    .sort((a, b) => b.score - a.score || a.r - b.r)
  return scored.slice(0, count).map(e => e.word)
}
