export function isEligible(word: string, textBefore: string): boolean {
  if (word.length < 3) return false
  if (/\d/.test(word)) return false
  if (/[.@]/.test(word)) return false
  if (word === word.toUpperCase() && word.length > 1) return false
  // Scan backwards past whitespace to find the actual preceding character
  let i = textBefore.length - 1
  while (i >= 0 && /\s/.test(textBefore[i]!)) i--
  const prevChar = i >= 0 ? textBefore[i]! : ''
  const sentenceStart = prevChar === '' || /[.!?]/.test(prevChar)
  if (/^[A-Z]/.test(word) && !sentenceStart) return false
  return true
}
