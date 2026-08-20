import type { ReviewLog } from './db'

export const DAY_MS = 86_400_000

/** Aggregate counts for a single calendar day (local time). */
export interface DayStats {
  /** ISO date key `yyyy-mm-dd` in local time. */
  date: string
  /** Total answers logged that day. */
  answers: number
  /** Answers on cards whose previous state was `new`. */
  newCards: number
  /** Answers on cards whose previous state was `review`. */
  reviews: number
  /** Answers rated hard/good/easy (i.e. not forgotten). */
  correct: number
}

export interface OverallStats {
  totalAnswers: number
  newLearned: number
  reviewsDone: number
  /** % of all answers rated hard/good/easy. */
  accuracy: number
  /** % of review answers rated hard/good/easy. */
  retention: number
  /** Consecutive days with at least one answer, ending today or yesterday. */
  currentStreak: number
  /** Longest run of consecutive active days. */
  longestStreak: number
  daily: DayStats[]
}

/** A rating counts as remembered unless the card was forgotten (Again). */
function remembered(rating: string): boolean {
  return rating !== 'again'
}

function isoDateKey(time: number): string {
  const d = new Date(time)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Ms at local noon for an ISO date key — DST-safe reference point. */
function noonMs(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12).getTime()
}

/**
 * Compute aggregate statistics from the review log. Pure function — never
 * touches the DB. Streaks/daily buckets use local calendar days.
 */
export function computeStats(logs: ReviewLog[], now = Date.now()): OverallStats {
  const byDay = new Map<string, DayStats>()
  for (const log of logs) {
    const key = isoDateKey(log.timestamp)
    let day = byDay.get(key)
    if (!day) {
      day = { date: key, answers: 0, newCards: 0, reviews: 0, correct: 0 }
      byDay.set(key, day)
    }
    day.answers++
    if (log.prevState === 'new') day.newCards++
    else if (log.prevState === 'review') day.reviews++
    if (remembered(log.rating)) day.correct++
  }

  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalAnswers = daily.reduce((sum, d) => sum + d.answers, 0)
  const correct = daily.reduce((sum, d) => sum + d.correct, 0)
  const reviewsDone = logs.filter((log) => log.prevState === 'review').length
  const reviewCorrect = logs.filter((log) => log.prevState === 'review' && remembered(log.rating)).length
  const newLearned = daily.reduce((sum, d) => sum + d.newCards, 0)

  return {
    totalAnswers,
    newLearned,
    reviewsDone,
    accuracy: percent(correct, totalAnswers),
    retention: percent(reviewCorrect, reviewsDone),
    currentStreak: currentStreakOf(dayKeys(daily), now),
    longestStreak: longestStreakOf(dayKeys(daily)),
    daily,
  }
}

function dayKeys(daily: DayStats[]): Set<string> {
  return new Set(daily.map((d) => d.date))
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10
}

function currentStreakOf(days: Set<string>, now: number): number {
  if (days.size === 0) return 0
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  if (!days.has(isoDateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(isoDateKey(cursor.getTime()))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function longestStreakOf(days: Set<string>): number {
  const sorted = [...days].sort()
  let best = 0
  let run = 0
  let previous = -Infinity
  for (const key of sorted) {
    const time = noonMs(key)
    if (time - previous === DAY_MS) run++
    else run = 1
    previous = time
    best = Math.max(best, run)
  }
  return best
}