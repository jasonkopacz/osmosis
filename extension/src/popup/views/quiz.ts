import type { UserSettings, SrsDueCard, SrsRating, SrsRateResult, Message } from '../../types'
import { POS_LABELS } from '../../utils/pos'
import { REVIEW_THRESHOLD } from '../../constants'

function formatInterval(days: number): string {
  if (days < 1) return '<1d'
  if (days === 1) return '1d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}yr`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isContextCard(card: SrsDueCard): card is SrsDueCard & { context: string; choices: string[] } {
  return !!card.context && Array.isArray(card.choices) && card.choices.length > 0
}

// ── Session persistence ──────────────────────────────────────────────────────

const SESSION_KEY = 'osmosis_quiz_session'

type SavedSession = {
  cards: SrsDueCard[]
  index: number
  phase: 'question' | 'answer'
  lang: string
}

function saveQuizSession(cards: SrsDueCard[], index: number, phase: 'question' | 'answer', lang: string): void {
  void chrome.storage.local.set({ [SESSION_KEY]: { cards, index, phase, lang } }).catch(() => {})
}

function clearQuizSession(): void {
  void chrome.storage.local.remove(SESSION_KEY).catch(() => {})
}

async function getSavedSession(lang: string): Promise<SavedSession | null> {
  try {
    const r = await chrome.storage.local.get(SESSION_KEY)
    const s = r[SESSION_KEY] as SavedSession | undefined
    if (s && s.lang === lang && s.index < s.cards.length) return s
  } catch {}
  return null
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function renderQuiz(container: HTMLElement, settings: UserSettings): void {
  container.replaceChildren()

  const hint = document.createElement('div')
  hint.className = 'osmo-hint'
  hint.style.padding = '28px 0'
  hint.textContent = 'Loading…'
  container.appendChild(hint)

  void restore(container, settings)
}

async function restore(container: HTMLElement, settings: UserSettings): Promise<void> {
  const saved = await getSavedSession(settings.targetLang)
  if (saved) {
    runSession(container, settings, saved.cards, saved.index, saved.phase)
    return
  }
  void load(container, settings)
}

async function load(container: HTMLElement, settings: UserSettings): Promise<void> {
  let result: { cards?: SrsDueCard[]; error?: string }
  try {
    result = (await chrome.runtime.sendMessage({
      type: 'SRS_GET_REVIEW_SESSION',
      targetLang: settings.targetLang,
      limit: REVIEW_THRESHOLD,
    } as Message)) as { cards?: SrsDueCard[]; error?: string }
  } catch {
    renderError(container)
    return
  }

  if (result.error || !result.cards) { renderError(container); return }

  const cards = result.cards
  if (cards.length === 0) {
    renderEmpty(container)
    return
  }

  runSession(container, settings, cards)
}

function runSession(
  container: HTMLElement,
  settings: UserSettings,
  cards: SrsDueCard[],
  startIndex = 0,
  startPhase: 'question' | 'answer' = 'question',
): void {
  let index = startIndex
  let phase: 'question' | 'answer' = startPhase

  function advance(result: SrsRateResult): void {
    index++
    phase = 'question'
    if (index >= cards.length) {
      clearQuizSession()
      void chrome.runtime.sendMessage({ type: 'SRS_SESSION_COMPLETE', targetLang: settings.targetLang } as Message).catch(() => {})
      renderComplete(container, cards.length, result)
    } else {
      renderCurrent()
    }
  }

  function renderCurrent(): void {
    saveQuizSession(cards, index, phase, settings.targetLang)
    container.replaceChildren()

    const body = document.createElement('div')
    body.className = 'body'

    const meta = document.createElement('div')
    meta.className = 'quiz-meta'
    const counter = document.createElement('span')
    counter.textContent = `${index + 1} of ${cards.length}`
    meta.append(counter, buildDots(index, cards.length))
    body.appendChild(meta)

    const card = cards[index]!
    const actions = document.createElement('div')
    actions.className = 'quiz-actions'

    if (isContextCard(card)) {
      body.appendChild(buildContextCard(card))
      actions.appendChild(buildChoiceGrid(card, settings, advance))
    } else {
      body.appendChild(buildFlashcard(card, phase))

      if (phase === 'question') {
        const revealBtn = document.createElement('button')
        revealBtn.className = 'osmo-btn osmo-btn--secondary'
        revealBtn.textContent = 'Show Answer'
        revealBtn.addEventListener('click', () => { phase = 'answer'; renderCurrent() })
        actions.appendChild(revealBtn)
      } else {
        actions.appendChild(buildRatingGrid(card, settings, advance))
      }
    }

    body.appendChild(actions)
    container.appendChild(body)
  }

  renderCurrent()
}

// ── Flashcard (existing) ────────────────────────────────────────────────────

function buildFlashcard(card: SrsDueCard, phase: 'question' | 'answer'): HTMLDivElement {
  const el = document.createElement('div')
  el.className = phase === 'answer' ? 'quiz-card quiz-card--revealed' : 'quiz-card'

  const word = document.createElement('div')
  word.className = 'quiz-word'
  word.textContent = card.translation
  el.appendChild(word)

  if (card.posTag) {
    const pos = document.createElement('span')
    pos.className = 'quiz-pos'
    pos.textContent = POS_LABELS[card.posTag] ?? card.posTag.toLowerCase()
    el.appendChild(pos)
  }

  if (phase === 'answer') {
    el.appendChild(Object.assign(document.createElement('div'), { className: 'quiz-sep' }))
    el.appendChild(Object.assign(document.createElement('div'), { className: 'quiz-answer', textContent: card.word }))
  }

  return el
}

function buildRatingGrid(
  card: SrsDueCard,
  settings: UserSettings,
  onRated: (result: SrsRateResult) => void,
): HTMLDivElement {
  const grid = document.createElement('div')
  grid.className = 'rating-grid'

  const ratings: Array<{ rating: SrsRating; cls: string; label: string }> = [
    { rating: 1, cls: 'rating-btn--again', label: 'New'      },
    { rating: 2, cls: 'rating-btn--hard',  label: 'Almost'   },
    { rating: 3, cls: 'rating-btn--good',  label: 'Got it'   },
    { rating: 4, cls: 'rating-btn--easy',  label: 'Nailed it'},
  ]

  for (const { rating, cls, label } of ratings) {
    const btn = document.createElement('button')
    btn.className = `rating-btn ${cls}`

    const lbl = document.createElement('span')
    lbl.className = 'rating-btn__label'
    lbl.textContent = label

    const days = document.createElement('span')
    days.className = 'rating-btn__days'
    days.textContent = '…'

    btn.append(lbl, days)

    btn.addEventListener('click', async () => {
      grid.querySelectorAll<HTMLButtonElement>('.rating-btn').forEach(b => { b.disabled = true })
      try {
        const res = (await chrome.runtime.sendMessage({
          type: 'SRS_RATE',
          word: card.word,
          targetLang: settings.targetLang,
          rating,
        } as Message)) as SrsRateResult & { error?: string }
        if (!res.error) days.textContent = formatInterval(res.intervalDays)
        await new Promise(resolve => setTimeout(resolve, 350))
        onRated(res)
      } catch {
        onRated({ word: card.word, targetLang: settings.targetLang, state: 'review', intervalDays: 1, dueAt: 0, stability: 1, difficulty: 5, lapses: 0, reps: 1 })
      }
    })

    grid.appendChild(btn)
  }

  return grid
}

// ── Context fill-in-the-blank ───────────────────────────────────────────────

function buildContextCard(card: SrsDueCard & { context: string }): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'quiz-card'

  const sentenceEl = document.createElement('div')
  sentenceEl.className = 'quiz-context-sentence'

  // Replace the English word with the target-language translation shown inline
  const re = new RegExp(`\\b${escapeRegExp(card.word)}\\w*`, 'gi')
  const sentence = card.context
  const match = re.exec(sentence)

  if (match) {
    if (match.index > 0) sentenceEl.appendChild(document.createTextNode(sentence.slice(0, match.index)))
    const highlight = document.createElement('span')
    highlight.className = 'quiz-context-word'
    highlight.textContent = card.translation
    sentenceEl.appendChild(highlight)
    const after = sentence.slice(match.index + match[0].length)
    if (after) sentenceEl.appendChild(document.createTextNode(after))
  } else {
    sentenceEl.textContent = sentence
  }

  el.appendChild(sentenceEl)

  return el
}

function buildChoiceGrid(
  card: SrsDueCard & { choices: string[] },
  settings: UserSettings,
  onRated: (result: SrsRateResult) => void,
): HTMLDivElement {
  const grid = document.createElement('div')
  grid.className = 'context-choices'

  for (const choice of card.choices) {
    const btn = document.createElement('button')
    btn.className = 'context-choice-btn'
    btn.textContent = choice

    btn.addEventListener('click', async () => {
      const correct = choice.toLowerCase() === card.word.toLowerCase()

      grid.querySelectorAll<HTMLButtonElement>('.context-choice-btn').forEach(b => {
        b.disabled = true
        if (b.textContent?.toLowerCase() === card.word.toLowerCase()) {
          b.classList.add('context-choice-btn--correct')
        } else if (b === btn && !correct) {
          b.classList.add('context-choice-btn--wrong')
        }
      })

      const rating: SrsRating = correct ? 3 : 1
      let rateResult: SrsRateResult = {
        word: card.word, targetLang: settings.targetLang, state: 'review',
        intervalDays: correct ? 4 : 0, dueAt: Date.now(),
        stability: card.stability, difficulty: card.difficulty,
        lapses: card.lapses, reps: card.reps + 1,
      }

      try {
        const res = (await chrome.runtime.sendMessage({
          type: 'SRS_RATE',
          word: card.word,
          targetLang: settings.targetLang,
          rating,
        } as Message)) as SrsRateResult & { error?: string }
        if (!res.error) rateResult = res
      } catch { /* use defaults */ }

      await new Promise(resolve => setTimeout(resolve, 900))
      onRated(rateResult)
    })

    grid.appendChild(btn)
  }

  return grid
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function buildDots(current: number, total: number): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'quiz-dots'
  const show = Math.min(total, 8)
  for (let i = 0; i < show; i++) {
    const dot = document.createElement('div')
    dot.className = i < current ? 'quiz-dot quiz-dot--done' : i === current ? 'quiz-dot quiz-dot--current' : 'quiz-dot'
    wrap.appendChild(dot)
  }
  return wrap
}

function renderComplete(container: HTMLElement, count: number, _lastResult: SrsRateResult): void {
  container.replaceChildren()
  const body = document.createElement('div')
  body.className = 'body'
  const end = document.createElement('div')
  end.className = 'quiz-end'
  end.append(
    Object.assign(document.createElement('div'), { className: 'quiz-end__icon', textContent: '🎉' }),
    Object.assign(document.createElement('div'), { className: 'quiz-end__title', textContent: 'Session complete!' }),
    Object.assign(document.createElement('div'), { className: 'quiz-end__sub', textContent: `${count} card${count === 1 ? '' : 's'} reviewed. Keep browsing to unlock your next session.` }),
  )
  body.appendChild(end)
  container.appendChild(body)
}

function renderEmpty(container: HTMLElement): void {
  container.replaceChildren()
  const body = document.createElement('div')
  body.className = 'body'
  const end = document.createElement('div')
  end.className = 'quiz-end'
  end.append(
    Object.assign(document.createElement('div'), { className: 'quiz-end__icon', textContent: '✅' }),
    Object.assign(document.createElement('div'), { className: 'quiz-end__title', textContent: 'All caught up' }),
    Object.assign(document.createElement('div'), { className: 'quiz-end__sub', textContent: 'Browse a few more pages and your first review session will unlock automatically.' }),
  )
  body.appendChild(end)
  container.appendChild(body)
}

function renderError(container: HTMLElement): void {
  container.replaceChildren()
  const hint = document.createElement('div')
  hint.className = 'osmo-hint'
  hint.style.padding = '28px 0'
  hint.textContent = 'Could not load — try again'
  container.appendChild(hint)
}
