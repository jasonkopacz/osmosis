export const DEFAULT_STREAK_GOAL = 10
export const STREAK_GOAL = DEFAULT_STREAK_GOAL  // backward-compat alias
export const STREAK_KEY = 'osmosis_streak_log'
export const DAILY_GOAL_KEY = 'osmosis_daily_goal'
const RETAIN_DAYS = 366

export type StreakInfo = {
  streak: number          // consecutive active days (including today if goal met)
  longestStreak: number   // all-time best consecutive run
  todayCount: number      // words encountered today
  goalMet: boolean        // todayCount >= goalTarget
  atRisk: boolean         // streak > 0 but today's goal not yet met
  goalTarget: number      // stored daily goal
}

// ── Date helpers (local time, not UTC) ───────────────────────────────────────

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function prevDay(dateStr: string): string {
  const [y, m, day] = dateStr.split('-').map(Number)
  const d = new Date(y!, m! - 1, day!)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ── Core logic (pure, exported for tests) ────────────────────────────────────

export type StreakLog = Record<string, number>  // YYYY-MM-DD → word count

export function computeStreak(log: StreakLog, today: string, goal = DEFAULT_STREAK_GOAL): Omit<StreakInfo, 'goalTarget'> {
  const todayCount = log[today] ?? 0
  const goalMet = todayCount >= goal

  let streak = 0
  let d = goalMet ? today : prevDay(today)

  while ((log[d] ?? 0) >= goal) {
    streak++
    d = prevDay(d)
  }

  const atRisk = streak > 0 && !goalMet

  return {
    streak,
    longestStreak: computeLongest(log, goal),
    todayCount,
    goalMet,
    atRisk,
  }
}

export function computeLongest(log: StreakLog, goal = DEFAULT_STREAK_GOAL): number {
  const goalDays = Object.entries(log)
    .filter(([, count]) => count >= goal)
    .map(([date]) => date)
    .sort()

  if (goalDays.length === 0) return 0

  let longest = 1
  let current = 1
  for (let i = 1; i < goalDays.length; i++) {
    const isConsecutive = goalDays[i] === nextDay(goalDays[i - 1]!)
    if (isConsecutive) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }
  return longest
}

function nextDay(dateStr: string): string {
  const [y, m, day] = dateStr.split('-').map(Number)
  const d = new Date(y!, m! - 1, day!)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── Daily goal storage ───────────────────────────────────────────────────────

export async function getDailyGoal(): Promise<number> {
  const r = await chrome.storage.local.get(DAILY_GOAL_KEY)
  const stored = r[DAILY_GOAL_KEY]
  return (typeof stored === 'number' && stored > 0) ? stored : DEFAULT_STREAK_GOAL
}

export async function setDailyGoal(goal: number): Promise<void> {
  await chrome.storage.local.set({ [DAILY_GOAL_KEY]: goal })
}

// ── Chrome storage I/O ───────────────────────────────────────────────────────

export async function updateStreakLog(wordCount: number): Promise<void> {
  if (wordCount <= 0) return
  const stored = await chrome.storage.local.get(STREAK_KEY)
  const log = { ...(stored[STREAK_KEY] ?? {}) } as StreakLog

  const today = todayStr()
  log[today] = (log[today] ?? 0) + wordCount

  // Prune entries older than RETAIN_DAYS
  const cutoff = daysAgoStr(RETAIN_DAYS)
  for (const key of Object.keys(log)) {
    if (key < cutoff) delete log[key]
  }

  await chrome.storage.local.set({ [STREAK_KEY]: log })
}

export async function getStreakInfo(): Promise<StreakInfo> {
  const [stored, goal] = await Promise.all([
    chrome.storage.local.get(STREAK_KEY),
    getDailyGoal(),
  ])
  const log = (stored[STREAK_KEY] ?? {}) as StreakLog
  return { ...computeStreak(log, todayStr(), goal), goalTarget: goal }
}
