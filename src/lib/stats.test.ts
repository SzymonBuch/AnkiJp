import { describe, expect, it } from 'vitest'
import type { ReviewLog } from './db'
import { computeStats, DAY_MS } from './stats'

const NOW = new Date('2026-08-20T12:00:00Z').getTime()

function log(overrides: Partial<ReviewLog>): ReviewLog {
  return {
    cardId: 'k:一',
    rating: 'good',
    prevState: 'new',
    newState: 'review',
    interval: 1,
    ease: 250,
    due: 0,
    timestamp: NOW,
    ...overrides,
  }
}

describe('stat buckets', () => {
  it('groups answers by local calendar day', () => {
    const stats = computeStats(
      [
        log({ rating: 'good', prevState: 'new', timestamp: NOW }),
        log({ rating: 'good', prevState: 'new', timestamp: NOW + DAY_MS }),
        log({ rating: 'good', prevState: 'new', timestamp: NOW + 2 * DAY_MS }),
      ],
      NOW,
    )
    expect(stats.daily).toHaveLength(3)
    expect(stats.daily.map((d) => d.answers)).toEqual([1, 1, 1])
  })

  it('counts new/review/correct per day', () => {
    const stats = computeStats(
      [
        log({ rating: 'good', prevState: 'new' }),
        log({ rating: 'again', prevState: 'review' }),
        log({ rating: 'easy', prevState: 'review' }),
      ],
      NOW,
    )
    expect(stats.daily[0]).toMatchObject({ answers: 3, newCards: 1, reviews: 2, correct: 2 })
  })
})

describe('accuracy and retention', () => {
  it('accuracy covers all answers; retention only review answers', () => {
    const stats = computeStats(
      [
        log({ rating: 'good', prevState: 'new' }),
        log({ rating: 'again', prevState: 'review' }),
        log({ rating: 'good', prevState: 'review' }),
        log({ rating: 'hard', prevState: 'review' }),
      ],
      NOW,
    )
    expect(stats.accuracy).toBe(75)
    expect(stats.retention).toBe(66.7)
  })

  it('returns 0 when there is no data (no divisions by zero)', () => {
    const stats = computeStats([], NOW)
    expect(stats).toEqual({
      totalAnswers: 0,
      newLearned: 0,
      reviewsDone: 0,
      accuracy: 0,
      retention: 0,
      currentStreak: 0,
      longestStreak: 0,
      daily: [],
    })
  })

  it('hard counts as remembered (not a lapse)', () => {
    const stats = computeStats([log({ rating: 'hard', prevState: 'review' })], NOW)
    expect(stats.retention).toBe(100)
    expect(stats.accuracy).toBe(100)
  })
})

describe('streaks', () => {
  it('counts a current streak ending today and one ending yesterday', () => {
    const today = computeStats([log({ timestamp: NOW })], NOW)
    expect(today.currentStreak).toBe(1)

    const yesterdayActive = computeStats([log({ timestamp: NOW - DAY_MS })], NOW)
    expect(yesterdayActive.currentStreak).toBe(1)
  })

  it('breaks a streak when yesterday is inactive', () => {
    const stats = computeStats([log({ timestamp: NOW - 2 * DAY_MS })], NOW)
    expect(stats.currentStreak).toBe(0)
  })

  it('finds the longest historical run', () => {
    const stats = computeStats(
      [
        log({ timestamp: NOW - 4 * DAY_MS }),
        log({ timestamp: NOW - 3 * DAY_MS }),
        log({ timestamp: NOW - 2 * DAY_MS }),
        log({ timestamp: NOW }), // isolated today -> contributes current streak, not longest
      ],
      NOW,
    )
    expect(stats.longestStreak).toBe(3)
    expect(stats.currentStreak).toBe(1)
  })
})