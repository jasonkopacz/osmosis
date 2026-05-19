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

// ── Session persistence ──────────────────────────────────────────────────────

const SESSION_KEY = 'osmosis_quiz_session'

type SavedSession = {
  cards: SrsDueCard[]
  index: number
  completed?: number
  total?: number
  phase: 'question' | 'answer'
  lang: string
}

function saveQuizSession(
  cards: SrsDueCard[],
  index: number,
  completed: number,
  total: number,
  phase: 'question' | 'answer',
  lang: string,
): void {
  void chrome.storage.local.set({ [SESSION_KEY]: { cards, index, completed, total, phase, lang } }).catch(() => {})
}

function clearQuizSession(): void {
  void chrome.storage.local.remove(SESSION_KEY).catch(() => {})
}

async function getSavedSession(lang: string): Promise<SavedSession | null> {
  try {
    const r = await chrome.storage.local.get(SESSION_KEY)
    const s = r[SESSION_KEY] as SavedSession | undefined
    if (s && s.lang === lang && s.index < s.cards.length) return s
  } catch (e) {
    console.warn('[osmosis:quiz] failed to restore session', e)
  }
  return null
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function renderQuiz(container: HTMLElement, settings: UserSettings): void {
  container.replaceChildren()

  const hint = document.createElement('div')
  hint.className = 'osmo-hint osmo-hint--quiz-loading'
  hint.textContent = 'Loading…'
  container.appendChild(hint)

  void restore(container, settings)
}

async function restore(container: HTMLElement, settings: UserSettings): Promise<void> {
  const saved = await getSavedSession(settings.targetLang)
  if (saved) {
    const total = saved.total ?? saved.cards.length + saved.index
    const completed = saved.completed ?? saved.index
    runSession(container, settings, saved.cards, saved.index, saved.phase, total, completed)
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
  sessionTotal?: number,
  startCompleted?: number,
): void {
  const total = sessionTotal ?? cards.length
  let completed = startCompleted ?? startIndex
  let index = startIndex
  let phase: 'question' | 'answer' = startPhase

  function sessionLabel(): string {
    return `${completed + 1} of ${total}`
  }

  function advance(result: SrsRateResult): void {
    completed++
    index++
    phase = 'question'
    if (index >= cards.length) {
      clearQuizSession()
      void chrome.runtime.sendMessage({ type: 'SRS_SESSION_COMPLETE', targetLang: settings.targetLang } as Message).catch(() => {})
      renderComplete(container, total, result)
    } else {
      renderCurrent()
    }
  }

  function renderCurrent(): void {
    const card = cards[index]!
    saveQuizSession(cards, index, completed, total, phase, settings.targetLang)
    container.replaceChildren()

    const body = document.createElement('div')
    body.className = 'body'

    const meta = document.createElement('div')
    meta.className = 'quiz-meta'
    const counter = document.createElement('span')
    counter.textContent = sessionLabel()

    const warnBtn = document.createElement('button')
    warnBtn.className = 'quiz-warn-btn'
    warnBtn.setAttribute('aria-label', 'Report this word')
    warnBtn.innerHTML = '<span class="quiz-warn-btn__icon">⚠</span><span class="quiz-warn-btn__label">Report</span>'
    warnBtn.addEventListener('click', () => {
      renderReport(container, card, settings, completed, total, () => {
        completed++
        cards.splice(index, 1)
        if (cards.length === 0) {
          clearQuizSession()
          void chrome.runtime.sendMessage({ type: 'SRS_SESSION_COMPLETE', targetLang: settings.targetLang } as Message).catch(() => {})
          renderComplete(container, total)
          return
        }
        if (index >= cards.length) index = cards.length - 1
        phase = 'question'
        renderCurrent()
      }, renderCurrent)
    })

    const metaRight = document.createElement('div')
    metaRight.className = 'quiz-meta-right'
    metaRight.append(buildDots(completed, total), warnBtn)
    meta.append(counter, metaRight)
    body.appendChild(meta)

    body.appendChild(buildCard(card, phase))

    const actions = document.createElement('div')
    actions.className = 'quiz-actions'

    if (phase === 'question') {
      const revealBtn = document.createElement('button')
      revealBtn.className = 'osmo-btn osmo-btn--secondary'
      revealBtn.textContent = 'Show Answer'
      revealBtn.addEventListener('click', () => { phase = 'answer'; renderCurrent() })
      actions.appendChild(revealBtn)
    } else {
      actions.appendChild(buildRatingGrid(card, settings, advance))
    }

    body.appendChild(actions)
    container.appendChild(body)
  }

  renderCurrent()
}

// ── Quiz report panel ─────────────────────────────────────────────────────────

function renderReport(
  container: HTMLElement,
  card: SrsDueCard,
  settings: UserSettings,
  completed: number,
  total: number,
  onDone: () => void,
  onCancel: () => void,
): void {
  container.replaceChildren()
  const body = document.createElement('div')
  body.className = 'body'

  const meta = document.createElement('div')
  meta.className = 'quiz-meta'
  const counter = document.createElement('span')
  counter.textContent = `${completed + 1} of ${total}`
  const metaRight = document.createElement('div')
  metaRight.className = 'quiz-meta-right'
  metaRight.appendChild(buildDots(completed, total))
  meta.append(counter, metaRight)
  body.appendChild(meta)

  const panel = document.createElement('div')
  panel.className = 'quiz-report-panel'

  const heading = document.createElement('div')
  heading.className = 'quiz-report-heading'
  heading.textContent = 'Report this word'
  panel.appendChild(heading)

  const optionsEl = document.createElement('div')
  optionsEl.className = 'quiz-report-options'

  const reportOptions: Array<{ label: string; sub: string; reason: string; isProperNoun?: boolean }> = [
    { label: 'Proper noun', sub: 'Name, place, or brand — shouldn\'t be translated', isProperNoun: true, reason: 'proper_noun' },
    { label: 'Wrong translation', sub: 'Translation is incorrect or poor', reason: 'incorrect_translation' },
    { label: 'Not a word', sub: 'Gibberish or invalid token that shouldn\'t exist', reason: 'not_a_word' },
  ]

  for (const opt of reportOptions) {
    const btn = document.createElement('button')
    btn.className = 'quiz-report-option'

    const lbl = document.createElement('div')
    lbl.className = 'quiz-report-option__label'
    lbl.textContent = opt.label

    const sub = document.createElement('div')
    sub.className = 'quiz-report-option__sub'
    sub.textContent = opt.sub

    btn.append(lbl, sub)
    btn.addEventListener('click', () => {
      optionsEl.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true })
      lbl.textContent = 'Reporting…'

      const msg: Message = opt.isProperNoun
        ? { type: 'REPORT_PROPER_NOUN', word: card.word, targetLang: settings.targetLang }
        : { type: 'REPORT_BAD_TRANSLATION', word: card.word, targetLang: settings.targetLang, translation: card.translation, reason: opt.reason, removeFromSrs: true }

      void (chrome.runtime.sendMessage(msg) as Promise<unknown>).finally(() => {
        lbl.textContent = '✓ Reported'
        setTimeout(onDone, 500)
      })
    })

    optionsEl.appendChild(btn)
  }

  panel.appendChild(optionsEl)

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'quiz-report-cancel'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.addEventListener('click', onCancel)
  panel.appendChild(cancelBtn)

  body.appendChild(panel)
  container.appendChild(body)
}

// ── Card ─────────────────────────────────────────────────────────────────────

function buildCard(card: SrsDueCard, phase: 'question' | 'answer'): HTMLDivElement {
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
    const answerWord = card.lemma ?? card.word.toLowerCase()
    el.appendChild(Object.assign(document.createElement('div'), { className: 'quiz-answer', textContent: answerWord }))
  }

  return el
}

// ── Rating buttons ────────────────────────────────────────────────────────────

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

// ── Shared helpers ────────────────────────────────────────────────────────────

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

function renderComplete(container: HTMLElement, count: number, _lastResult?: SrsRateResult): void {
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
  hint.className = 'osmo-hint osmo-hint--quiz-loading'
  hint.textContent = 'Could not load — try again'
  container.appendChild(hint)
}
