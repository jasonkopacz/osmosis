import type { TranslationEntry } from '../types'

const TRANSLATE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=plain'
const DICT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/dictionary/lookup?api-version=3.0&from=en'
const SPEECH_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
const AZURE_TIMEOUT_MS = 8_000

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

function pickVoice(targetLang: string): string {
  const lang = targetLang.toLowerCase()
  if (lang.startsWith('es')) return 'es-ES-ElviraNeural'
  if (lang.startsWith('fr')) return 'fr-FR-DeniseNeural'
  if (lang.startsWith('de')) return 'de-DE-KatjaNeural'
  if (lang.startsWith('it')) return 'it-IT-ElsaNeural'
  if (lang.startsWith('pt')) return 'pt-BR-FranciscaNeural'
  if (lang.startsWith('ja')) return 'ja-JP-NanamiNeural'
  if (lang.startsWith('ko')) return 'ko-KR-SunHiNeural'
  if (lang.startsWith('zh')) return 'zh-CN-XiaoxiaoNeural'
  return 'en-US-AvaMultilingualNeural'
}

export async function synthesizePronunciation(
  text: string,
  targetLang: string,
  speechKey: string,
  speechRegion: string
): Promise<{ audioBase64: string; mimeType: string; voice: string }> {
  const voice = pickVoice(targetLang)
  const endpoint = `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`
  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
  const ssml = `<speak version="1.0" xml:lang="${voice.slice(0, 5)}"><voice name="${voice}">${escapedText}</voice></speak>`
  console.log('[azure] speech request', { targetLang, voice, text })
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': speechKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': SPEECH_OUTPUT_FORMAT,
      'User-Agent': 'osmosis-pronunciation',
    },
    body: ssml,
    signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Azure speech error: ${res.status} ${body}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  let audioBase64 = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    audioBase64 += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  audioBase64 = btoa(audioBase64)
  return {
    audioBase64,
    mimeType: 'audio/mpeg',
    voice,
  }
}

/**
 * Calls Azure Dictionary Lookup. Returns entries only for words that have a
 * dictionary record; words with no entry are absent from the result map
 * (caller should fall back to translateWords for those).
 */
// Azure hard limits: dictionary/lookup = 10 elements, translate = 100 elements
const DICT_CHUNK_SIZE = 10
const TRANSLATE_CHUNK_SIZE = 100

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

export async function lookupWords(
  words: string[], targetLang: string, apiKey: string, region: string
): Promise<Map<string, TranslationEntry>> {
  if (words.length === 0) return new Map()
  const chunkResults = await Promise.all(
    chunkArray(words, DICT_CHUNK_SIZE).map(async chunk => {
      const res = await fetch(`${DICT_ENDPOINT}&to=${encodeURIComponent(targetLang)}`, {
        method: 'POST',
        headers: headers(apiKey, region),
        body: JSON.stringify(chunk.map(w => ({ Text: w }))),
        signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Azure dict lookup error: ${res.status} ${body}`)
      }
      const data = (await res.json()) as AzureDictResponse
      const entries: Array<[string, TranslationEntry]> = []
      data.forEach((row, i) => {
        if (!row.translations.length) return
        const sorted = [...row.translations].sort((a, b) => b.confidence - a.confidence)
        const primary = sorted[0]!
        const entry: TranslationEntry = { t: primary.displayTarget, p: primary.posTag }
        if (row.normalizedSource && row.normalizedSource !== chunk[i]) entry.n = row.normalizedSource
        const alts = sorted
          .slice(1)
          .filter(alt => alt.posTag !== primary.posTag)
          .slice(0, 2)
          .map(alt => ({ t: alt.displayTarget, p: alt.posTag }))
        if (alts.length > 0) entry.a = alts
        entries.push([chunk[i]!, entry])
      })
      return entries
    })
  )
  return new Map(chunkResults.flat())
}

/** Calls Azure /translate. Used as fallback for words with no dictionary entry. */
export async function translateWords(
  words: string[],
  targetLang: string,
  apiKey: string,
  region: string,
  contextByWord?: Map<string, string>
): Promise<Map<string, TranslationEntry>> {
  if (words.length === 0) return new Map()

  const getContext = (word: string): string | undefined => contextByWord?.get(word.toLowerCase())

  const chunkResults = await Promise.all(
    chunkArray(words, TRANSLATE_CHUNK_SIZE).map(async chunk => {
      const hasContextInChunk = chunk.some(word => !!getContext(word))
      const makeBody = (includeContext: boolean) =>
        chunk.map(word => {
          const context = getContext(word)
          if (!includeContext || !context) return { Text: word }
          return { Text: word, Context: context }
        })
      const payloadWithContext = makeBody(hasContextInChunk)
      const payloadWithoutContext = makeBody(false)
      const contextedWordsInChunk = payloadWithContext.filter(item => 'Context' in item).length
      console.log('[azure] translate chunk', {
        chunkSize: chunk.length,
        hasContextInChunk,
        contextedWordsInChunk,
      })

      let res = await fetch(`${TRANSLATE_ENDPOINT}&to=${encodeURIComponent(targetLang)}`, {
        method: 'POST',
        headers: headers(apiKey, region),
        body: JSON.stringify(payloadWithContext),
        signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
      })

      if (!res.ok && hasContextInChunk) {
        const firstErrorBody = await res.text().catch(() => '')
        console.warn(`[azure] /translate with context failed, retrying without context: ${res.status} ${firstErrorBody.slice(0, 120)}`)
        console.log('[azure] translate chunk fallback (no context)', { chunkSize: chunk.length })
        res = await fetch(`${TRANSLATE_ENDPOINT}&to=${encodeURIComponent(targetLang)}`, {
          method: 'POST',
          headers: headers(apiKey, region),
          body: JSON.stringify(payloadWithoutContext),
          signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
        })
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Azure API error: ${res.status} ${body}`)
      }

      const data = (await res.json()) as AzureTranslateResponse
      if (!Array.isArray(data) || data.length !== chunk.length) {
        throw new Error(`Azure API returned unexpected response: expected ${chunk.length} items, got ${Array.isArray(data) ? data.length : typeof data}`)
      }
      const entries: Array<[string, TranslationEntry]> = []
      data.forEach((item, i) => {
        const t = item.translations[0]?.text
        if (t) {
          entries.push([chunk[i]!, { t }])
        } else {
          console.warn(`[azure] missing translation for word[${i}]="${chunk[i]}"`)
        }
      })
      return entries
    })
  )
  return new Map(chunkResults.flat())
}
