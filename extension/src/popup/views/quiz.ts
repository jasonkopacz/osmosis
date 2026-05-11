import type { UserSettings, SrsDueCard, SrsRating, SrsRateResult, Message } from '../../types'

import { POS_LABELS } from '../../utils/pos'

function formatInterval(days: number): string {
  if (days < 1) return '<1d'
  if (days === 1) return '1d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}yr`
}

export function renderQuiz(container: HTMLElement, settings: UserSettings): void {
  container.replaceChildren()

  const hint = document.createElement('div')
  hint.className = 'osmo-hint'
  hint.style.padding = '28px 0'
  hint.textContent = 'Loading…'
  container.appendChild(hint)

  void load(container, settings)
}

async function load(container: HTMLElement, settings: UserSettings): Promise<void> {
  let result: { cards?: SrsDueCard[]; error?: string }
  try {
    result = (await chrome.runtime.sendMessage({
      type: 'SRS_GET_DUE',
      targetLang: settings.targetLang,
      limit: 20,
    } as Message)) as { cards?: SrsDueCard[]; error?: string }
  } catch {
    renderError(container)
    return
  }

  if (result.error || !result.cards) { renderError(container); return }

  const cards = result.cards
  if (cards.length === 0) {
    renderEmpty(container, settings)
    return
  }

  runSession(container, settings, cards)
}

function runSession(container: HTMLElement, settings: UserSettings, cards: SrsDueCard[]): void {
  let index = 0
  let phase: 'question' | 'answer' = 'question'

  function renderCurrent(): void {
    container.replaceChildren()

    const body = document.createElement('div')
    body.className = 'body'

    // ── Meta row
    const meta = document.createElement('div')
    meta.className = 'quiz-meta'
    const counter = document.createElement('span')
    counter.textContent = `${index + 1} of ${cards.length}`
    const dots = buildDots(index, cards.length)
    meta.append(counter, dots)
    body.appendChild(meta)

    // ── Card
    const card = cards[index]!
    const cardEl = buildCard(card, phase)
    body.appendChild(cardEl)

    // ── Actions
    const actions = document.createElement('div')
    actions.className = 'quiz-actions'

    if (phase === 'question') {
      const revealBtn = document.createElement('button')
      revealBtn.className = 'osmo-btn osmo-btn--secondary'
      revealBtn.textContent = 'Show Answer'
      revealBtn.addEventListener('click', () => {
        phase = 'answer'
        renderCurrent()
      })
      actions.appendChild(revealBtn)
    } else {
      actions.appendChild(buildRatingGrid(card, settings, (result) => {
        index++
        phase = 'question'
        if (index >= cards.length) {
          renderComplete(container, cards.length, result)
        } else {
          renderCurrent()
        }
      }))
    }

    body.appendChild(actions)
    container.appendChild(body)
  }

  renderCurrent()
}

function buildDots(current: number, total: number): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'quiz-dots'
  // Cap display at 8 dots to avoid overflow
  const show = Math.min(total, 8)
  for (let i = 0; i < show; i++) {
    const dot = document.createElement('div')
    dot.className = i < current ? 'quiz-dot quiz-dot--done' : i === current ? 'quiz-dot quiz-dot--current' : 'quiz-dot'
    wrap.appendChild(dot)
  }
  return wrap
}

function buildCard(card: SrsDueCard, phase: 'question' | 'answer'): HTMLDivElement {
  const el = document.createElement('div')
  el.className = phase === 'answer' ? 'quiz-card quiz-card--revealed' : 'quiz-card'

  // Prompt line
  const prompt = document.createElement('div')
  prompt.className = 'quiz-prompt'
  prompt.textContent = 'What does this mean?'
  el.appendChild(prompt)

  // The translated word (question)
  const word = document.createElement('div')
  word.className = 'quiz-word'
  word.textContent = card.translation
  el.appendChild(word)

  // POS tag under the word
  if (card.posTag) {
    const pos = document.createElement('span')
    pos.className = 'quiz-pos'
    pos.textContent = POS_LABELS[card.posTag] ?? card.posTag.toLowerCase()
    el.appendChild(pos)
  }

  // Revealed answer
  if (phase === 'answer') {
    const sep = document.createElement('div')
    sep.className = 'quiz-sep'
    el.appendChild(sep)

    const answer = document.createElement('div')
    answer.className = 'quiz-answer'
    answer.textContent = card.word
    el.appendChild(answer)
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
    { rating: 1, cls: 'rating-btn--again', label: 'Again' },
    { rating: 2, cls: 'rating-btn--hard',  label: 'Hard'  },
    { rating: 3, cls: 'rating-btn--good',  label: 'Good'  },
    { rating: 4, cls: 'rating-btn--easy',  label: 'Easy'  },
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
      // Disable all buttons immediately
      grid.querySelectorAll<HTMLButtonElement>('.rating-btn').forEach(b => { b.disabled = true })
      try {
        const res = (await chrome.runtime.sendMessage({
          type: 'SRS_RATE',
          word: card.word,
          targetLang: settings.targetLang,
          rating,
        } as Message)) as SrsRateResult & { error?: string }
        if (!res.error) {
          days.textContent = formatInterval(res.intervalDays)
        }
        // Brief pause so user can see the interval before advancing
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

function renderComplete(container: HTMLElement, count: number, lastResult: SrsRateResult): void {
  container.replaceChildren()

  const body = document.createElement('div')
  body.className = 'body'

  const end = document.createElement('div')
  end.className = 'quiz-end'

  const icon = document.createElement('div')
  icon.className = 'quiz-end__icon'
  icon.textContent = '🎉'

  const title = document.createElement('div')
  title.className = 'quiz-end__title'
  title.textContent = 'Session complete!'

  const sub = document.createElement('div')
  sub.className = 'quiz-end__sub'
  sub.textContent = `${count} card${count === 1 ? '' : 's'} reviewed.\nLast word next in ${formatInterval(lastResult.intervalDays)}.`

  end.append(icon, title, sub)
  body.appendChild(end)
  container.appendChild(body)
}

function renderEmpty(container: HTMLElement, settings: UserSettings): void {
  container.replaceChildren()

  const body = document.createElement('div')
  body.className = 'body'

  const end = document.createElement('div')
  end.className = 'quiz-end'

  const icon = document.createElement('div')
  icon.className = 'quiz-end__icon'
  icon.textContent = '✅'

  const title = document.createElement('div')
  title.className = 'quiz-end__title'
  title.textContent = 'All caught up'

  const sub = document.createElement('div')
  sub.className = 'quiz-end__sub'
  sub.textContent = `No ${settings.targetLang.toUpperCase()} cards due right now.\nKeep browsing to build your vocabulary.`

  end.append(icon, title, sub)
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
