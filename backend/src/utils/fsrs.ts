/**
 * FSRS-4.5 (Free Spaced Repetition Scheduler)
 * Pure functions — no side effects, no I/O.
 *
 * Trained default parameters from the FSRS paper (Ye et al., 2023).
 * Algorithm: https://github.com/open-spaced-repetition/fsrs4anki
 */

export type SrsRating = 1 | 2 | 3 | 4  // Again | Hard | Good | Easy

export type SrsState = 'review' | 'relearning'

export interface CardParams {
  stability: number   // S — interval in days for 90% retention
  difficulty: number  // D — card difficulty 1–10 (higher = harder)
  lapses: number
  reps: number
  state: SrsState
  lastRatedAt: number // unix seconds; 0 = never rated
}

export interface SchedulingResult {
  stability: number
  difficulty: number
  lapses: number
  reps: number
  state: SrsState
  dueAt: number       // unix seconds
  intervalDays: number
}

// FSRS-4.5 default trained weights
const W = [
  0.4072,  // w0  initial S for Again
  1.1829,  // w1  initial S for Hard
  3.1262,  // w2  initial S for Good
  15.4722, // w3  initial S for Easy
  7.2102,  // w4  initial D base
  0.5316,  // w5  initial D rating decay
  1.0651,  // w6  difficulty update weight
  0.0589,  // w7  mean-reversion weight
  1.4596,  // w8  recall stability exponent
  0.1103,  // w9  recall stability S power
  1.0165,  // w10 recall stability R factor
  1.9784,  // w11 lapse stability constant
  0.0953,  // w12 lapse stability D power
  0.2975,  // w13 lapse stability S power
  2.2042,  // w14 lapse stability R factor
  0.2407,  // w15 hard penalty multiplier
  2.9466,  // w16 easy bonus multiplier
] as const

const DESIRED_RETENTION = 0.9
const MIN_INTERVAL_DAYS = 1
const MAX_INTERVAL_DAYS = 36500 // 100 years

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

const INIT_STABILITY: Record<SrsRating, number> = { 1: W[0], 2: W[1], 3: W[2], 4: W[3] }

function initStability(rating: SrsRating): number {
  return INIT_STABILITY[rating]
}

function initDifficulty(rating: SrsRating): number {
  return clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10)
}

function retrievability(daysSinceLast: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.exp(Math.log(DESIRED_RETENTION) * daysSinceLast / stability)
}

function recallStability(D: number, S: number, R: number, rating: SrsRating): number {
  const hardPenalty = rating === 2 ? W[15] : 1
  const easyBonus = rating === 4 ? W[16] : 1
  return (
    S *
    (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp((1 - R) * W[10]) - 1) + 1) *
    hardPenalty *
    easyBonus
  )
}

function forgetStability(D: number, S: number, R: number): number {
  return W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp((1 - R) * W[14])
}

function updateDifficulty(D: number, rating: SrsRating): number {
  const rawNext = D - W[6] * (rating - 3)
  // Mean reversion toward the initial difficulty for Easy (keeps hard cards from becoming too easy)
  const initEasy = initDifficulty(4)
  const reverted = W[7] * initEasy + (1 - W[7]) * rawNext
  return clamp(reverted, 1, 10)
}

function intervalFromStability(stability: number): number {
  // For desired retention R0: interval = S * ln(R0) / ln(0.9)
  // At R0=0.9 this simplifies to just S (days)
  const raw = stability * Math.log(DESIRED_RETENTION) / Math.log(0.9)
  return clamp(Math.round(raw), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)
}

/**
 * Schedule the first rating on a brand-new word.
 * This replaces the need for a separate "learning" state.
 */
export function scheduleNew(rating: SrsRating, nowSec: number): SchedulingResult {
  const stability = initStability(rating)
  const difficulty = initDifficulty(rating)
  const intervalDays = intervalFromStability(stability)
  return {
    stability,
    difficulty,
    lapses: 0,
    reps: 1,
    state: 'review',
    intervalDays,
    dueAt: nowSec + intervalDays * 86400,
  }
}

/**
 * Schedule an existing card given the current rating.
 * Handles both 'review' → 'review'/'relearning' and 'relearning' → 'review'/'relearning'.
 */
export function scheduleExisting(card: CardParams, rating: SrsRating, nowSec: number): SchedulingResult {
  const daysSinceLast = card.lastRatedAt > 0
    ? (nowSec - card.lastRatedAt) / 86400
    : 0
  const R = retrievability(daysSinceLast, card.stability)
  const newDifficulty = updateDifficulty(card.difficulty, rating)

  if (rating === 1) {
    // Lapse — card goes to relearning
    const newStability = clamp(forgetStability(card.difficulty, card.stability, R), 0.01, card.stability)
    const intervalDays = intervalFromStability(newStability)
    return {
      stability: newStability,
      difficulty: newDifficulty,
      lapses: card.lapses + 1,
      reps: card.reps + 1,
      state: 'relearning',
      intervalDays,
      dueAt: nowSec + intervalDays * 86400,
    }
  }

  // Recall (rating 2, 3, or 4)
  const newStability = recallStability(card.difficulty, card.stability, R, rating)
  const intervalDays = intervalFromStability(newStability)
  return {
    stability: newStability,
    difficulty: newDifficulty,
    lapses: card.lapses,
    reps: card.reps + 1,
    state: 'review',
    intervalDays,
    dueAt: nowSec + intervalDays * 86400,
  }
}
