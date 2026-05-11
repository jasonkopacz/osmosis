export const POS_LABELS: Record<string, string> = {
  VERB: 'verb', NOUN: 'noun', ADJ: 'adj.', ADV: 'adv.',
  PRON: 'pron.', PREP: 'prep.', DET: 'det.', CONJ: 'conj.', INTJ: 'interj.',
}

export function posLabel(tag: string): string {
  return POS_LABELS[tag] ?? tag.toLowerCase()
}
