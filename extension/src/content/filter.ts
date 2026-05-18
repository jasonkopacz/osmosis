import { WORD_RANK } from '../data/wordFrequency'

export function isEligible(word: string, textBefore: string, fullText?: string): boolean {
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

  // A text node containing only one word (heading, label, link text, name element)
  // is almost always a proper noun or UI label — only pass it if it's a known
  // common English word (i.e. it appears in the frequency index).
  if (prevChar === '' && fullText !== undefined) {
    const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length
    if (wordCount === 1 && !WORD_RANK[word.toLowerCase()]) return false
  }

  return true
}
