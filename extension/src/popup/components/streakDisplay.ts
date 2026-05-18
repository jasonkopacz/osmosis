import type { StreakInfo } from '../../background/streak'
import { setDailyGoal } from '../../background/streak'

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: T) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

const debouncedSetDailyGoal = debounce((goal: number) => { void setDailyGoal(goal) }, 500)

const MIN_GOAL = 5
const MAX_GOAL = 50
const GOAL_STEP = 5

export function renderStreakSection(streakInfo: StreakInfo): HTMLDivElement {
  const wrap = document.createElement('div')

  // ── Label
  const label = document.createElement('div')
  label.className = 'field-label field-label--streak'
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

  // ── Today's goal progress bar (editable)
  wrap.appendChild(makeTodayProgress(streakInfo))

  return wrap
}

function makeStreakCard(info: StreakInfo): HTMLDivElement {
  const card = document.createElement('div')
  card.className = 'streak-card'

  const iconEl = document.createElement('div')
  iconEl.className = 'streak-card__icon'
  iconEl.textContent = info.streak > 0 ? '🔥' : '🌊'
  iconEl.setAttribute('aria-hidden', 'true')

  const val = document.createElement('div')
  val.className = 'streak-card__value'
  val.textContent = info.streak.toString()

  const lbl = document.createElement('div')
  lbl.className = 'streak-card__label'
  lbl.textContent = info.streak === 1 ? '1 day streak' : 'day streak'

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

  // ── Header: label + stepper
  const header = document.createElement('div')
  header.className = 'streak-today__header'

  const lbl = document.createElement('span')
  lbl.className = 'streak-today__label'
  lbl.textContent = "Today's goal"

  const stepper = document.createElement('div')
  stepper.className = 'streak-today__stepper'

  const decBtn = document.createElement('button')
  decBtn.type = 'button'
  decBtn.className = 'streak-today__step-btn'
  decBtn.textContent = '−'
  decBtn.setAttribute('aria-label', 'Decrease daily goal')

  const goalDisplay = document.createElement('span')
  goalDisplay.className = 'streak-today__goal-val'

  const incBtn = document.createElement('button')
  incBtn.type = 'button'
  incBtn.className = 'streak-today__step-btn'
  incBtn.textContent = '+'
  incBtn.setAttribute('aria-label', 'Increase daily goal')

  stepper.append(decBtn, goalDisplay, incBtn)
  header.append(lbl, stepper)

  // ── Progress row: bar + count
  const progressRow = document.createElement('div')
  progressRow.className = 'streak-today__progress-row'

  const track = document.createElement('div')
  track.className = 'streak-today__track'
  const fill = document.createElement('div')
  track.appendChild(fill)

  const cnt = document.createElement('span')
  cnt.className = 'streak-today__count'

  progressRow.append(track, cnt)
  wrap.append(header, progressRow)

  // ── Reactive update
  let currentGoal = info.goalTarget

  function refresh(): void {
    const met = info.todayCount >= currentGoal
    const pct = Math.min(100, Math.round((info.todayCount / currentGoal) * 100))

    goalDisplay.textContent = currentGoal.toString()
    fill.className = met
      ? 'streak-today__fill streak-today__fill--met'
      : 'streak-today__fill'
    fill.style.transform = `scaleX(${pct / 100})`
    cnt.textContent = `${Math.min(info.todayCount, currentGoal)} / ${currentGoal}`
    cnt.className = met ? 'streak-today__count streak-today__count--met' : 'streak-today__count'

    decBtn.disabled = currentGoal <= MIN_GOAL
    incBtn.disabled = currentGoal >= MAX_GOAL
  }

  decBtn.addEventListener('click', () => {
    if (currentGoal <= MIN_GOAL) return
    currentGoal -= GOAL_STEP
    refresh()
    debouncedSetDailyGoal(currentGoal)
  })

  incBtn.addEventListener('click', () => {
    if (currentGoal >= MAX_GOAL) return
    currentGoal += GOAL_STEP
    refresh()
    debouncedSetDailyGoal(currentGoal)
  })

  refresh()
  return wrap
}
