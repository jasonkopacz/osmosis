import type { UserSettings, SrsStats, StreakInfo, Message } from '../../types'
import { renderStreakSection } from '../components/streakDisplay'

export function renderProgress(
  container: HTMLElement,
  settings: UserSettings,
  onStartReview: () => void,
): void {
  container.replaceChildren()

  const hint = document.createElement('div')
  hint.className = 'osmo-hint progress-hint'
  hint.textContent = 'Loading…'
  container.appendChild(hint)

  void load(container, settings, onStartReview)
}

async function load(
  container: HTMLElement,
  settings: UserSettings,
  onStartReview: () => void,
): Promise<void> {
  // Fetch vocab stats and streak in parallel
  let stats: SrsStats & { error?: string }
  let streak: StreakInfo & { error?: string }

  try {
    ;[stats, streak] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'SRS_GET_STATS', targetLang: settings.targetLang } as Message) as Promise<SrsStats & { error?: string }>,
      chrome.runtime.sendMessage({ type: 'SRS_GET_STREAK' } as Message) as Promise<StreakInfo & { error?: string }>,
    ])
  } catch {
    renderError(container)
    return
  }

  if (stats.error) { renderError(container); return }

  paint(container, stats, streak, settings, onStartReview)
}

function paint(
  container: HTMLElement,
  stats: SrsStats,
  streak: StreakInfo & { error?: string },
  settings: UserSettings,
  onStartReview: () => void,
): void {
  container.replaceChildren()

  const body = document.createElement('div')
  body.className = 'body'

  // ── Vocabulary section label
  const topLabel = document.createElement('div')
  topLabel.className = 'field-label'
  topLabel.textContent = `${settings.targetLang.toUpperCase()} vocabulary`
  body.appendChild(topLabel)

  // ── Stat cards
  const grid = document.createElement('div')
  grid.className = 'stats-grid'

  const readyCount = (stats.sessionCount ?? 0) + stats.dueCount
  const dueCard = makeStatCard(
    readyCount.toString(),
    'Ready',
    readyCount > 0 ? 'stat-card--due stat-card--due-active' : 'stat-card--due',
  )
  const totalCard = makeStatCard(stats.total.toString(), 'Total', '')
  const todayCard = makeStatCard(stats.reviewedToday.toString(), 'Reviewed', 'stat-card--reviewed')

  grid.append(dueCard, totalCard, todayCard)
  body.appendChild(grid)

  // ── State breakdown
  if (stats.total > 0) {
    const breakdownLabel = document.createElement('div')
    breakdownLabel.className = 'field-label progress-breakdown-label'
    breakdownLabel.textContent = 'Status'
    body.appendChild(breakdownLabel)

    body.appendChild(makeBreakdownRow('Review', stats.inReview, stats.total, 'breakdown-fill--review'))
    body.appendChild(makeBreakdownRow('Relearning', stats.relearning, stats.total, 'breakdown-fill--relearning'))
  }

  // ── Reading streak (always shown, even with no vocab history)
  if (!streak.error) {
    body.appendChild(renderStreakSection(streak))
  }

  // ── CTA or empty state
  if (stats.total === 0) {
    body.appendChild(makeEmptyState())
  } else if (stats.reviewReady) {
    const parts: string[] = []
    if (stats.sessionCount && stats.sessionCount > 0) parts.push(`${stats.sessionCount} from browsing`)
    if (stats.dueCount > 0) parts.push(`${stats.dueCount} scheduled`)
    const cta = document.createElement('button')
    cta.className = 'osmo-btn osmo-btn--primary'
    cta.textContent = `Start Review${parts.length ? ` — ${parts.join(', ')}` : ''}`
    cta.addEventListener('click', onStartReview)
    body.appendChild(cta)
  } else {
    const sessionCount = stats.sessionCount ?? 0
    const remaining = Math.max(0, 25 - sessionCount)
    const allDone = document.createElement('div')
    allDone.className = 'osmo-hint progress-all-done'
    allDone.textContent = remaining > 0
      ? `Browse ${remaining} more word${remaining === 1 ? '' : 's'} to unlock your next review`
      : 'All caught up — keep browsing!'
    body.appendChild(allDone)
  }

  container.appendChild(body)
}

function makeStatCard(value: string, label: string, extraClass: string): HTMLDivElement {
  const card = document.createElement('div')
  card.className = `stat-card${extraClass ? ` ${extraClass}` : ''}`

  const val = document.createElement('div')
  val.className = 'stat-card__value'
  val.textContent = value

  const lbl = document.createElement('div')
  lbl.className = 'stat-card__label'
  lbl.textContent = label

  card.append(val, lbl)
  return card
}

function makeBreakdownRow(label: string, count: number, total: number, fillClass: string): HTMLDivElement {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0

  const row = document.createElement('div')
  row.className = 'breakdown-row'

  const lbl = document.createElement('span')
  lbl.className = 'breakdown-label'
  lbl.textContent = label

  const track = document.createElement('div')
  track.className = 'breakdown-track'
  const fill = document.createElement('div')
  fill.className = `breakdown-fill ${fillClass}`
  fill.style.width = `${pct}%`
  track.appendChild(fill)

  const cnt = document.createElement('span')
  cnt.className = 'breakdown-count'
  cnt.textContent = count.toString()

  row.append(lbl, track, cnt)
  return row
}

function makeEmptyState(): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'progress-empty'

  const icon = document.createElement('div')
  icon.className = 'progress-empty__icon'
  icon.textContent = '🌊'

  const title = document.createElement('div')
  title.className = 'progress-empty__title'
  title.textContent = 'No words tracked yet'

  const body = document.createElement('div')
  body.className = 'progress-empty__body'
  body.textContent = 'Hover translated words on any page and tap "Know it" or "Learning" to build your vocabulary.'

  wrap.append(icon, title, body)
  return wrap
}

function renderError(container: HTMLElement): void {
  container.replaceChildren()
  const hint = document.createElement('div')
  hint.className = 'osmo-hint progress-hint'
  hint.textContent = 'Could not load — try again'
  container.appendChild(hint)
}
