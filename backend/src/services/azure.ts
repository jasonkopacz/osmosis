import type { TranslationEntry } from '../types'

const TRANSLATE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=plain'
const DICT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/dictionary/lookup?api-version=3.0&from=en'

type AzureTranslateResponse = { translations: { text: string; to: string }[] }[]
type AzureDictResponse = Array<{
  normalizedSource: string
  translations: Array<{
    normalizedTarget: string
    displayTarget: string
    posTag: string
    confidence: number
  }>
}>

function headers(apiKey: string, region: string): HeadersInit {
  return {
    'Ocp-Apim-Subscription-Key': apiKey,
    'Ocp-Apim-Subscription-Region': region,
    'Content-Type': 'application/json',
  }
}

/**
 * Calls Azure Dictionary Lookup. Returns entries only for words that have a
 * dictionary record; words with no entry are absent from the result map
 * (caller should fall back to translateWords for those).
 */
export async function lookupWords(
  words: string[], targetLang: string, apiKey: string, region: string
): Promise<Map<string, TranslationEntry>> {
  if (words.length === 0) return new Map()
  const res = await fetch(`${DICT_ENDPOINT}&to=${encodeURIComponent(targetLang)}`, {
    method: 'POST',
    headers: headers(apiKey, region),
    body: JSON.stringify(words.map(w => ({ Text: w }))),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Azure dict lookup error: ${res.status} ${body}`)
  }
  const data = (await res.json()) as AzureDictResponse
  const map = new Map<string, TranslationEntry>()
  data.forEach((row, i) => {
    if (!row.translations.length) return
    const sorted = [...row.translations].sort((a, b) => b.confidence - a.confidence)
    const primary = sorted[0]!
    const entry: TranslationEntry = { t: primary.displayTarget, p: primary.posTag }
    const alts = sorted
      .slice(1)
      .filter(alt => alt.posTag !== primary.posTag)
      .slice(0, 2)
      .map(alt => ({ t: alt.displayTarget, p: alt.posTag }))
    if (alts.length > 0) entry.a = alts
    map.set(words[i]!, entry)
  })
  return map
}

/** Calls Azure /translate. Used as fallback for words with no dictionary entry. */
export async function translateWords(
  words: string[], targetLang: string, apiKey: string, region: string
): Promise<Map<string, TranslationEntry>> {
  if (words.length === 0) return new Map()
  const res = await fetch(`${TRANSLATE_ENDPOINT}&to=${encodeURIComponent(targetLang)}`, {
    method: 'POST',
    headers: headers(apiKey, region),
    body: JSON.stringify(words.map(w => ({ Text: w }))),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Azure API error: ${res.status} ${body}`)
  }
  const data = (await res.json()) as AzureTranslateResponse
  if (!Array.isArray(data) || data.length !== words.length) {
    throw new Error(`Azure API returned unexpected response: expected ${words.length} items, got ${Array.isArray(data) ? data.length : typeof data}`)
  }
  const map = new Map<string, TranslationEntry>()
  data.forEach((item, i) => {
    const t = item.translations[0]?.text
    if (t) {
      map.set(words[i]!, { t })
    } else {
      console.warn(`[azure] missing translation for word[${i}]="${words[i]}"`)
    }
  })
  return map
}
