import { WORD_RANK } from '../data/wordFrequency'

export function isEligible(word: string, textBefore: string): boolean {
  if (word.length < 3) return false
  if (/\d/.test(word)) return false
  if (/[.@]/.test(word)) return false
  // Lowercase word immediately preceded by a dot is a TLD, file extension, or
  // domain fragment (e.g. the "com" in "gmail.com"). Uppercase is allowed —
  // it's a sentence-start capital ("End. The cat…"), handled below.
  if (textBefore[textBefore.length - 1] === '.' && /^[a-z]/.test(word)) return false
  if (word === word.toUpperCase() && word.length > 1) return false
  // Brand names and tech identifiers with internal uppercase (vDash, iPhone, camelCase)
  if (/[a-z][A-Z]/.test(word)) return false

  // Scan backwards past whitespace to find the actual preceding character
  let i = textBefore.length - 1
  while (i >= 0 && /\s/.test(textBefore[i]!)) i--
  const prevChar = i >= 0 ? textBefore[i]! : ''
  const sentenceStart = prevChar === '' || /[.!?]/.test(prevChar)
  if (/^[A-Z]/.test(word) && !sentenceStart) return false

  // Require the word to be a real English word. Rejects proper nouns not shared
  // with common vocabulary (Musk, Kopacz), brand names, typos, foreign tokens
  // in Latin script, and gibberish letter sequences that would otherwise be
  // scored as "unknown learning candidates" and shipped to translation.
  if (!WORD_RANK[word.toLowerCase()]) return false

  return true
}
