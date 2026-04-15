export function isEligible(word: string, charBefore: string): boolean {
  if (word.length < 3) return false
  if (/\d/.test(word)) return false
  if (/[.@]/.test(word)) return false
  if (word === word.toUpperCase() && word.length > 1) return false
  const sentenceStart = charBefore === '' || /[.!?\n]/.test(charBefore)
  if (/^[A-Z]/.test(word) && !sentenceStart) return false
  return true
}
