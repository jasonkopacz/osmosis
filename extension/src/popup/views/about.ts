export function renderAbout(root: HTMLElement, onBack: () => void): void {
  root.replaceChildren()

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div')
  header.className = 'header'

  const backBtn = document.createElement('button')
  backBtn.className = 'icon-btn'
  backBtn.setAttribute('aria-label', 'Back')
  backBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M15 18l-6-6 6-6"/></svg>'
  backBtn.addEventListener('click', onBack)

  const title = document.createElement('span')
  title.className = 'settings-title'
  title.textContent = 'About Osmosis'
  header.append(backBtn, title, document.createElement('span'))

  // ── Body (scrollable) ─────────────────────────────────────────────────────
  const body = document.createElement('div')
  body.className = 'about-body'

  const div = () => { const hr = document.createElement('hr'); hr.className = 'osmo-divider'; return hr }

  // Tagline
  const tagline = document.createElement('p')
  tagline.className = 'about-tagline'
  tagline.textContent = 'Passively build your vocabulary by reading the web — no separate study sessions required.'
  body.appendChild(tagline)
  body.appendChild(div())

  // ── How it works
  body.appendChild(sectionLabel('How it works'))
  body.appendChild(para(
    'As you browse, Osmosis replaces a portion of words on every page with translations in your target language. ' +
    'Hover any highlighted word to see the original, its part of speech, and alternative translations. ' +
    'Rate words from the tooltip to begin tracking them.'
  ))
  body.appendChild(div())

  // ── Word levels
  body.appendChild(sectionLabel('Word levels — CEFR'))
  body.appendChild(para('Controls which words are eligible for replacement based on how common they are in the target language.'))

  const levels: Array<[string, string]> = [
    ['All', 'No filter — every eligible word'],
    ['A1', 'Beginner — core ~500 words'],
    ['A2', 'Elementary — ~1,000 words'],
    ['B1', 'Intermediate — ~2,000 words'],
    ['B2', 'Upper intermediate — ~3,500 words'],
    ['C1', 'Advanced — ~5,000 words'],
    ['C2', 'Mastery — rare & specialised terms'],
  ]
  const levelGrid = document.createElement('div')
  levelGrid.className = 'about-level-grid'
  for (const [code, desc] of levels) {
    const row = document.createElement('div')
    row.className = 'about-level-row'
    const codeEl = document.createElement('span')
    codeEl.className = 'about-level-code'
    codeEl.textContent = code
    const descEl = document.createElement('span')
    descEl.className = 'about-level-desc'
    descEl.textContent = desc
    row.append(codeEl, descEl)
    levelGrid.appendChild(row)
  }
  body.appendChild(levelGrid)
  body.appendChild(div())

  // ── Review & quizzing
  body.appendChild(sectionLabel('Review & quizzing'))
  body.appendChild(para(
    'After encountering 25 words while browsing, a review session unlocks automatically in the Review tab. ' +
    'Each session contains up to 25 cards drawn from your recent browsing and any overdue vocabulary.'
  ))

  const cardTypes: Array<[string, string]> = [
    ['Recall', 'The translated word is shown. Remember the original and rate your confidence.'],
    ['Fill-in', 'A real sentence from your browsing, with the word replaced by its translation. Pick the correct original from four options.'],
  ]
  const typeList = document.createElement('div')
  typeList.className = 'about-card-types'
  for (const [name, desc] of cardTypes) {
    const item = document.createElement('div')
    item.className = 'about-card-type'
    const nameEl = document.createElement('span')
    nameEl.className = 'about-card-type__name'
    nameEl.textContent = name
    const descEl = document.createElement('span')
    descEl.className = 'about-card-type__desc'
    descEl.textContent = desc
    item.append(nameEl, descEl)
    typeList.appendChild(item)
  }
  body.appendChild(typeList)

  body.appendChild(para(
    'Ratings (New / Almost / Got it / Nailed it) feed into FSRS — a scientifically-validated spaced repetition ' +
    'algorithm that schedules each word at the optimal moment for long-term memory retention.'
  ))
  body.appendChild(div())

  // ── Tips
  body.appendChild(sectionLabel('Tips'))
  const tips = [
    'Use the percentage slider to control how many words are replaced per page.',
    'The CEFR filter lets you focus on words matching your proficiency level.',
    'Rate words directly in tooltips to add them to your review deck faster.',
    'Closing the popup mid-review is fine — your session resumes where you left off.',
    'New words encountered while a review is in progress carry over to the next session.',
  ]
  const tipList = document.createElement('ul')
  tipList.className = 'about-tips'
  for (const tip of tips) {
    const li = document.createElement('li')
    li.textContent = tip
    tipList.appendChild(li)
  }
  body.appendChild(tipList)
  body.appendChild(div())

  // ── Version
  const version = document.createElement('p')
  version.className = 'about-version'
  const manifest = chrome.runtime.getManifest()
  version.textContent = `Osmosis v${manifest.version}`
  body.appendChild(version)

  root.append(header, body)
}

function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'field-label'
  el.textContent = text
  return el
}

function para(text: string): HTMLParagraphElement {
  const el = document.createElement('p')
  el.className = 'about-text'
  el.textContent = text
  return el
}
