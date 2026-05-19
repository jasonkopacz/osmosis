export function localeFromTargetLang(targetLang: string): string {
  const lower = targetLang.toLowerCase()
  if (lower.startsWith('es')) return 'es-ES'
  if (lower.startsWith('fr')) return 'fr-FR'
  if (lower.startsWith('de')) return 'de-DE'
  if (lower.startsWith('it')) return 'it-IT'
  if (lower.startsWith('pt')) return 'pt-BR'
  if (lower.startsWith('ja')) return 'ja-JP'
  if (lower.startsWith('ko')) return 'ko-KR'
  if (lower.startsWith('zh')) return 'zh-CN'
  return targetLang
}

export function playBrowserPronunciation(text: string, targetLang: string): boolean {
  if (!('speechSynthesis' in window)) return false
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = localeFromTargetLang(targetLang)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}
