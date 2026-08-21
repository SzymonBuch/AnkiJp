import { describe, expect, it } from 'vitest'
import {
  createCard,
  DAY_MS,
  EASY_INTERVAL_DAYS,
  GRADUATING_INTERVAL_DAYS,
  LAPSE_NEW_INTERVAL_DAYS,
  LEARNING_STEPS_MIN,
  MAX_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  MIN_MS,
  RELEARNING_STEPS_MIN,
  STARTING_EASE,
  fuzzedInterval,
  rateCard,
  ratingOutcome,
  type Rating,
  type SrsCard,
} from './srs'

const NOW = new Date('2026-08-20T12:00:00Z').getTime()
const rngMin = () => 0

function reviewCard(overrides: Partial<SrsCard> = {}): SrsCard {
  const base: SrsCard = {
    kanji: '一',
    pos: 0,
    known: false,
    ignored: false,
    state: 'review',
    step: -1,
    ease: STARTING_EASE,
    interval: 10,
    due: NOW,
    reps: 5,
    lapses: 0,
  }
  return { ...base, ...overrides }
}

describe('createCard', () => {
  it('starts a card in the new state with Anki defaults', () => {
    const c = createCard('一', 3, NOW)
    expect(c).toEqual({
      kanji: '一',
      pos: 3,
      ignored: false,
      known: false,
      knownPrev: null,
      state: 'new',
      step: -1,
      ease: STARTING_EASE,
      interval: 0,
      due: NOW,
      reps: 0,
      lapses: 0,
    })
  })
})

describe('learning steps (new / learning)', () => {
  it('Again from a new card -> step 0 at 1 min, state learning', () => {
    const c = rateCard(createCard('一', 0, NOW), 'again', NOW)
    expect(c.state).toBe('learning')
    expect(c.step).toBe(0)
    expect(c.due).toBe(NOW + LEARNING_STEPS_MIN[0] * MIN_MS)
    expect(c.interval).toBe(0)
  })

  it('first Good on a new card -> step 0 at 1 min (Anki moves new cards to the first step)', () => {
    const c = rateCard(createCard('一', 0, NOW), 'good', NOW)
    expect(c.state).toBe('learning')
    expect(c.step).toBe(0)
    expect(c.due).toBe(NOW + LEARNING_STEPS_MIN[0] * MIN_MS)
  })

  it('Good advances step 0 -> step 1 at 10 min', () => {
    const c = rateCard(createCard('一', 0, NOW), 'good', NOW)
    const next = rateCard(c, 'good', NOW + MIN_MS)
    expect(next.step).toBe(1)
    expect(next.due).toBe(NOW + MIN_MS + LEARNING_STEPS_MIN[1] * MIN_MS)
  })

  it('Good from the last step -> graduates to review at 1 day', () => {
    let c = rateCard(createCard('一', 0, NOW), 'good', NOW)
    c = rateCard(c, 'good', NOW + MIN_MS)
    const graduated = rateCard(c, 'good', NOW + MIN_MS + 10 * MIN_MS)
    expect(graduated.state).toBe('review')
    expect(graduated.interval).toBe(GRADUATING_INTERVAL_DAYS)
    expect(graduated.due).toBe(NOW + MIN_MS + 10 * MIN_MS + GRADUATING_INTERVAL_DAYS * DAY_MS)
  })

  it('Easy -> graduates immediately to review at ~4 days (Anki Easy Interval)', () => {
    const c = rateCard(createCard('一', 0, NOW), 'easy', NOW, rngMin)
    expect(c.state).toBe('review')
    expect(c.interval).toBe(EASY_INTERVAL_DAYS)
    expect(c.due).toBe(NOW + EASY_INTERVAL_DAYS * DAY_MS)
    expect(c.ease).toBe(STARTING_EASE)
  })

  it('Hard from step 0 -> stays at step 0 (min 1 min)', () => {
    const c = rateCard(createCard('一', 0, NOW), 'hard', NOW)
    expect(c.step).toBe(0)
    expect(c.due).toBe(NOW + MIN_MS)
  })

  it('Hard from step 1 -> steps back to step 0 (1 min)', () => {
    let c = rateCard(createCard('一', 0, NOW), 'good', NOW)
    c = rateCard(c, 'good', NOW + MIN_MS)
    const back = rateCard(c, 'hard', NOW + MIN_MS + MIN_MS)
    expect(back.step).toBe(0)
    expect(back.due).toBe(NOW + MIN_MS + MIN_MS + MIN_MS)
  })

  it('Again from step 1 -> back to step 0 (1 min)', () => {
    let c = rateCard(createCard('一', 0, NOW), 'good', NOW)
    c = rateCard(c, 'good', NOW + MIN_MS)
    const back = rateCard(c, 'again', NOW + MIN_MS + MIN_MS)
    expect(back.step).toBe(0)
    expect(back.due).toBe(NOW + MIN_MS + MIN_MS + MIN_MS)
  })

  it('learning ratings never touch ease or lapses', () => {
    let c = rateCard(createCard('一', 0, NOW), 'again', NOW)
    c = rateCard(c, 'good', NOW + MIN_MS)
    c = rateCard(c, 'hard', NOW + 2 * MIN_MS)
    c = rateCard(c, 'again', NOW + 3 * MIN_MS)
    expect(c.ease).toBe(STARTING_EASE)
    expect(c.lapses).toBe(0)
  })
})

describe('review answers', () => {
  it('Again -> lapse: relearning 10 min, interval reset to 1 day, ease -20, lapse +1', () => {
    const c = rateCard(reviewCard({ interval: 100, ease: 250 }), 'again', NOW)
    expect(c.state).toBe('relearning')
    expect(c.step).toBe(0)
    expect(c.interval).toBe(LAPSE_NEW_INTERVAL_DAYS)
    expect(c.due).toBe(NOW + RELEARNING_STEPS_MIN[0] * MIN_MS)
    expect(c.ease).toBe(230)
    expect(c.lapses).toBe(1)
  })

  it('Again resets a very long interval to 1 day', () => {
    const c = rateCard(reviewCard({ interval: 3650, ease: 240 }), 'again', NOW)
    expect(c.interval).toBe(1)
    expect(c.ease).toBe(220)
  })

  it('Hard -> interval x1.2, ease -15', () => {
    const c = rateCard(reviewCard({ interval: 10, ease: 250 }), 'hard', NOW, rngMin)
    expect(c.interval).toBe(12)
    expect(c.ease).toBe(235)
    expect(c.due).toBe(NOW + 12 * DAY_MS)
  })

  it('Hard never shrinks the interval (min ivl + 1)', () => {
    const c = rateCard(reviewCard({ interval: 1, ease: 250 }), 'hard', NOW, rngMin)
    expect(c.interval).toBe(2)
  })

  it('Good -> interval x ease, ease unchanged', () => {
    const c = rateCard(reviewCard({ interval: 10, ease: 200 }), 'good', NOW, rngMin)
    expect(c.interval).toBe(19)
    expect(c.ease).toBe(200)
  })

  it('Easy -> interval x ease x1.3, ease +15', () => {
    const c = rateCard(reviewCard({ interval: 20, ease: 250 }), 'easy', NOW, rngMin)
    expect(c.interval).toBe(62)
    expect(c.ease).toBe(265)
  })

  it('ease never drops below the 130% floor', () => {
    const c = rateCard(reviewCard({ interval: 10, ease: 135 }), 'hard', NOW, rngMin)
    expect(c.ease).toBe(MIN_EASE)
  })

  it("ease never exceeds Anki's 500% cap", () => {
    const c = rateCard(reviewCard({ interval: 10, ease: MAX_EASE - 10 }), 'easy', NOW, rngMin)
    expect(c.ease).toBe(MAX_EASE)
  })

  it('review intervals are capped at the Anki maximum', () => {
    const c = rateCard(reviewCard({ interval: 30000, ease: 150 }), 'good', NOW, rngMin)
    expect(c.interval).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
    expect(c.interval).toBeGreaterThan(MAX_INTERVAL_DAYS - 2000)
  })
})

describe('relearning', () => {
  it('Good on the relearning step -> back to review at 1 day', () => {
    const lapsed = rateCard(reviewCard({ interval: 100 }), 'again', NOW)
    const c = rateCard(lapsed, 'good', NOW + RELEARNING_STEPS_MIN[0] * MIN_MS, rngMin)
    expect(c.state).toBe('review')
    expect(c.interval).toBe(LAPSE_NEW_INTERVAL_DAYS)
  })

  it('Easy during relearning also returns to review at the lapsed interval', () => {
    const lapsed = rateCard(reviewCard({ interval: 100 }), 'again', NOW)
    const c = rateCard(lapsed, 'easy', NOW + MIN_MS, rngMin)
    expect(c.state).toBe('review')
    expect(c.interval).toBe(LAPSE_NEW_INTERVAL_DAYS)
  })

  it('Again during relearning -> back to the 10 min step', () => {
    const lapsed = rateCard(reviewCard({ interval: 100 }), 'again', NOW)
    const c = rateCard(lapsed, 'again', NOW + MIN_MS)
    expect(c.state).toBe('relearning')
    expect(c.step).toBe(0)
    expect(c.due).toBe(NOW + MIN_MS + RELEARNING_STEPS_MIN[0] * MIN_MS)
  })
})

describe('ratingOutcome', () => {
  const newCard = createCard('一', 0, NOW)
  const learnStep0 = rateCard(createCard('一', 0, NOW), 'again', NOW)
  const learnStep1 = rateCard(rateCard(createCard('一', 0, NOW), 'good', NOW), 'good', NOW)
  const relearning = rateCard(reviewCard({ interval: 100 }), 'again', NOW)
  const review = reviewCard()

  const cases: [name: string, card: SrsCard, rating: Rating, expected: string][] = [
    ['new / again -> first learning step', newCard, 'again', '1 min'],
    ['new / hard -> first learning step', newCard, 'hard', '1 min'],
    ['new / good -> first learning step', newCard, 'good', '1 min'],
    ['new / easy -> graduates at the easy interval', newCard, 'easy', '~4 days'],

    ['learning step 0 / again -> stays on step 0', learnStep0, 'again', '1 min'],
    ['learning step 0 / hard -> stays on step 0', learnStep0, 'hard', '1 min'],
    ['learning step 0 / good -> advances to step 1', learnStep0, 'good', '10 min'],
    ['learning step 0 / easy -> graduates early', learnStep0, 'easy', '~4 days'],

    ['learning step 1 / again -> back to step 0', learnStep1, 'again', '1 min'],
    ['learning step 1 / hard -> back to step 0', learnStep1, 'hard', '1 min'],
    ['learning step 1 / good -> graduates', learnStep1, 'good', '~1 day'],
    ['learning step 1 / easy -> graduates at the easy interval', learnStep1, 'easy', '~4 days'],

    ['relearning / again -> repeats the step', relearning, 'again', 'relearn 10 min'],
    ['relearning / hard -> repeats the step', relearning, 'hard', 'relearn 10 min'],
    ['relearning / good -> back to review', relearning, 'good', '~1 day'],
    ['relearning / easy -> back to review', relearning, 'easy', '~1 day'],

    ['review / again -> lapse into relearning', review, 'again', 'relearn 10 min'],
    ['review / hard -> interval x1.2', review, 'hard', '~12 days'],
    ['review / good -> interval x ease (min fuzz edge)', review, 'good', '~24 days'],
    ['review / easy -> interval x ease x1.3 (min fuzz edge)', review, 'easy', '~32 days'],
  ]

  it.each(cases)('%s', (_name, card, rating, expected) => {
    expect(ratingOutcome(card, rating)).toBe(expected)
  })

  it('does not mutate the input card', () => {
    const input = reviewCard()
    const before = { ...input }
    ratingOutcome(input, 'easy')
    expect(input).toEqual(before)
  })
})

describe('fuzz', () => {
  it('is applied to intervals >= 2 days within 5% (min edge)', () => {
    expect(fuzzedInterval(250, rngMin)).toBe(238)
  })

  it('is applied to intervals >= 2 days within 5% (max edge)', () => {
    expect(fuzzedInterval(250, () => 0.999)).toBe(262)
  })

  it('is never applied to 1-day intervals', () => {
    expect(fuzzedInterval(1, rngMin)).toBe(1)
    expect(fuzzedInterval(1, () => 0.999)).toBe(1)
  })
})

describe('bookkeeping', () => {
  it('increments reps on every answer', () => {
    let c = createCard('一', 0, NOW)
    c = rateCard(c, 'good', NOW)
    expect(c.reps).toBe(1)
    c = rateCard(c, 'again', NOW + MIN_MS)
    expect(c.reps).toBe(2)
    c = rateCard(c, 'easy', NOW + 2 * MIN_MS, rngMin)
    expect(c.reps).toBe(3)
  })

  it('lapses only increment on review Again', () => {
    const c = rateCard(reviewCard(), 'good', NOW, rngMin)
    expect(c.lapses).toBe(0)
    const a = rateCard(reviewCard(), 'again', NOW)
    expect(a.lapses).toBe(1)
  })

  it('does not mutate the input card', () => {
    const input = createCard('一', 0, NOW)
    const before = { ...input }
    rateCard(input, 'easy', NOW, rngMin)
    expect(input).toEqual(before)
  })
})