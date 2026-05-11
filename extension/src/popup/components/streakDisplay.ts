import type { StreakInfo } from '../../background/streak'
import { STREAK_GOAL } from '../../background/streak'

export function renderStreakSection(streakInfo: StreakInfo): HTMLDivElement {
  const wrap = document.createElement('div')

  // ── Label
  const label = document.createElement('div')
  label.className = 'field-label'
  label.style.marginTop = '4px'
  label.textContent = 'Reading streak'
  wrap.appendChild(label)

  // ── Streak + Longest grid
  const grid = document.createElement('div')
  grid.className = 'streak-grid'
  grid.append(
    makeStreakCard(streakInfo),
    makeLongestCard(streakInfo.longestStreak),
  )
  wrap.appendChild(grid)

  // ── Today's goal progress bar
  wrap.appendChild(makeTodayProgress(streakInfo))

  return wrap
}

function makeStreakCard(info: StreakInfo): HTMLDivElement {
  const card = document.createElement('div')

  let mod = ''
  let icon = '🌊'
  if (info.streak > 0 && info.goalMet) { mod = 'streak-card--active'; icon = '🔥' }
  else if (info.streak > 0 && info.atRisk) { mod = 'streak-card--risk'; icon = '⚡' }

  card.className = `streak-card${mod ? ` ${mod}` : ''}`

  const iconEl = document.createElement('div')
  iconEl.className = 'streak-card__icon'
  iconEl.textContent = icon
  iconEl.setAttribute('aria-hidden', 'true')

  const val = document.createElement('div')
  val.className = 'streak-card__value'
  val.textContent = info.streak.toString()

  const lbl = document.createElement('div')
  lbl.className = 'streak-card__label'
  lbl.textContent = info.streak === 1 ? 'day streak' : 'day streak'

  card.append(iconEl, val, lbl)
  return card
}

function makeLongestCard(longest: number): HTMLDivElement {
  const card = document.createElement('div')
  card.className = 'streak-card'

  const iconEl = document.createElement('div')
  iconEl.className = 'streak-card__icon'
  iconEl.textContent = '🏆'
  iconEl.setAttribute('aria-hidden', 'true')

  const val = document.createElement('div')
  val.className = 'streak-card__value'
  val.textContent = longest.toString()

  const lbl = document.createElement('div')
  lbl.className = 'streak-card__label'
  lbl.textContent = 'best streak'

  card.append(iconEl, val, lbl)
  return card
}

function makeTodayProgress(info: StreakInfo): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'streak-today'

  const header = document.createElement('div')
  header.className = 'streak-today__header'

  const lbl = document.createElement('span')
  lbl.className = 'streak-today__label'
  lbl.textContent = "Today's goal"

  const cnt = document.createElement('span')
  cnt.className = info.goalMet ? 'streak-today__count streak-today__count--met' : 'streak-today__count'
  cnt.textContent = `${Math.min(info.todayCount, STREAK_GOAL)} / ${STREAK_GOAL} words`

  header.append(lbl, cnt)

  const track = document.createElement('div')
  track.className = 'streak-today__track'

  const fill = document.createElement('div')
  const pct = Math.min(100, Math.round((info.todayCount / STREAK_GOAL) * 100))
  fill.className = info.goalMet
    ? 'streak-today__fill streak-today__fill--met'
    : 'streak-today__fill'
  fill.style.width = `${pct}%`

  track.appendChild(fill)
  wrap.append(header, track)
  return wrap
}
