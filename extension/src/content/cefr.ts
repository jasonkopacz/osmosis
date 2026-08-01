import { WORD_RANK } from '../data/wordFrequency'

/**
 * 'all' = no CEFR filtering (default behaviour).
 * A1–C2 = only replace words at that level or above (harder than the threshold).
 *
 * Rank thresholds are derived from the Norvig frequency corpus (10 k words):
 *   A1 : rank   1–500   (core survival vocabulary)
 *   A2 : rank 501–1500  (everyday common words)
 *   B1 : rank 1501–3500 (intermediate content words)
 *   B2 : rank 3501–6000 (upper-intermediate / academic)
 *   C1 : rank 6001–10000 (advanced / sophisticated)
 *   C2 : not in list    (rare / specialised)
 */
export type CefrMinLevel = 'all' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

const LEVEL_NUM: Record<Exclude<CefrMinLevel, 'all'>, number> = {
  A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6,
}

function numericLevel(word: string): number {
  const rank = WORD_RANK[word.toLowerCase()]
  if (!rank)        return 6  // not in corpus → rare/specialised = C2
  if (rank <= 500)  return 1  // A1
  if (rank <= 1500) return 2  // A2
  if (rank <= 3500) return 3  // B1
  if (rank <= 6000) return 4  // B2
  return 5                    // C1 (rank 6001–10000)
}

/** Returns true when the word should be shown for the selected minimum level. */
export function passesCefrFilter(word: string, minLevel: CefrMinLevel): boolean {
  if (minLevel === 'all') return true
  return numericLevel(word) >= LEVEL_NUM[minLevel]
}

export const CEFR_LABELS: Record<CefrMinLevel, string> = {
  all: 'All',
  A1:  'A1',
  A2:  'A2',
  B1:  'B1',
  B2:  'B2',
  C1:  'C1',
  C2:  'C2',
}

export const CEFR_DESCRIPTIONS: Record<CefrMinLevel, string> = {
  all: 'Replace All Eligible Words',
  A1:  'Beginner — Core 500 Words',
  A2:  'Elementary — Everyday Vocabulary',
  B1:  'Intermediate — Content Words',
  B2:  'Upper-intermediate — Academic',
  C1:  'Advanced — Sophisticated Vocabulary',
  C2:  'Mastery — Rare & Specialised Terms',
}

export const CEFR_LEVELS: CefrMinLevel[] = ['all', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']
