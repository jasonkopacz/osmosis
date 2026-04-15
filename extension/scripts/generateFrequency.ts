import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const res = await fetch('https://norvig.com/ngrams/count_1w.txt')
  const text = await res.text()
  const entries = text
    .trim()
    .split('\n')
    .slice(0, 10_000)
    .map((line, i) => {
      const word = (line.split('\t')[0] ?? '').toLowerCase().replace(/[^a-z]/g, '')
      return word.length >= 2 ? `  ['${word}', ${i + 1}]` : null
    })
    .filter((e): e is string => e !== null)

  const out = join(__dirname, '../src/data/wordFrequency.ts')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(
    out,
    [
      '// Auto-generated — do not edit manually',
      '// Source: https://norvig.com/ngrams/count_1w.txt (public domain)',
      '// rank: 1 = most common, 10000 = least common in list',
      'export const WORD_RANK: Record<string, number> = Object.fromEntries([',
      entries.join(',\n'),
      '])',
    ].join('\n')
  )

  console.log(`Generated ${entries.length} words`)
}

main()
