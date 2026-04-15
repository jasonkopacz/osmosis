const ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=plain'

type AzureResponse = { translations: { text: string; to: string }[] }[]

export async function translateWords(
  words: string[], targetLang: string, apiKey: string, region: string
): Promise<Map<string, string>> {
  if (words.length === 0) return new Map()
  const res = await fetch(`${ENDPOINT}&to=${encodeURIComponent(targetLang)}`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(words.map(w => ({ Text: w }))),
  })
  if (!res.ok) throw new Error(`Azure API error: ${res.status}`)
  const data = (await res.json()) as AzureResponse
  const map = new Map<string, string>()
  data.forEach((item, i) => {
    const t = item.translations[0]?.text
    if (t) map.set(words[i]!, t)
  })
  return map
}
