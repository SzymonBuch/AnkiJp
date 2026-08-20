export type Rating = 'again' | 'hard' | 'good' | 'easy'
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export interface SrsCard {
  kanji: string
  /** Position in the study order (seed order), used to order new cards. */
  pos: number
  /** Manually marked as "known" (e.g. in the Deck). Included in quiz pools. */
  known: boolean
  state: CardState
  /** Index into the current step list (learning/relearning), 0-based. */
  step: number
  /** Ease as percent points, Anki-style: starts at 250, minimum 130. */
  ease: number
  /** Current interval in days (0 for new cards). */
  interval: number
  /** Epoch ms when the card is due again. */
  due: number
  reps: number
  lapses: number
}

/** Learning steps in minutes (Anki default: 1m 10m). */
export const LEARNING_STEPS_MIN = [1, 10]
/** Relearning step in minutes after a lapse (Anki default: 10m). */
export const RELEARNING_STEPS_MIN = [10]
/** Interval a card graduates with (Anki default: 1d). */
export const GRADUATING_INTERVAL_DAYS = 1
/** Easy Interval for graduating cards (Anki default: 4d). */
export const EASY_INTERVAL_DAYS = 4
/** Interval a review card is reset to after a lapse (Anki default: 1d). */
export const LAPSE_NEW_INTERVAL_DAYS = 1
/** Starting ease (Anki default: 250%). */
export const STARTING_EASE = 250
/** Minimum ease (Anki default: 130%). */
export const MIN_EASE = 130
/** Maximum ease (Anki cap: 500%). */
export const MAX_EASE = 500
/** Maximum review interval in days (Anki cap: 36500). */
export const MAX_INTERVAL_DAYS = 36500

export const DAY_MS = 86_400_000
export const MIN_MS = 60_000

export function createCard(kanji: string, pos: number, now: number): SrsCard {
  return {
    kanji,
    pos,
    known: false,
    state: 'new',
    step: -1,
    ease: STARTING_EASE,
    interval: 0,
    due: now,
    reps: 0,
    lapses: 0,
  }
}

/**
 * Answer a card and return its new state. Pure function — does not persist.
 * `rng` is injectable for deterministic fuzz in tests (default Math.random).
 */
export function rateCard(
  card: SrsCard,
  rating: Rating,
  now: number,
  rng: () => number = Math.random,
): SrsCard {
  const next: SrsCard = { ...card, reps: card.reps + 1 }
  if (next.state === 'review') return rateReview(next, rating, now, rng)
  return rateLearning(next, rating, now, rng)
}

function rateLearning(card: SrsCard, rating: Rating, now: number, rng: () => number): SrsCard {
  const steps = card.state === 'relearning' ? RELEARNING_STEPS_MIN : LEARNING_STEPS_MIN
  if (card.state === 'new') card.state = 'learning'
  switch (rating) {
    case 'again':
      card.step = 0
      card.due = now + steps[0] * MIN_MS
      return card
    case 'hard':
      card.step = Math.max(0, card.step - 1)
      card.due = now + steps[card.step] * MIN_MS
      return card
    case 'good':
      if (card.step + 1 >= steps.length) {
        return graduate(card, now, GRADUATING_INTERVAL_DAYS, rng)
      }
      card.step += 1
      card.due = now + steps[card.step] * MIN_MS
      return card
    case 'easy':
      if (card.state === 'relearning') {
        return graduate(card, now, LAPSE_NEW_INTERVAL_DAYS, rng)
      }
      return graduate(card, now, EASY_INTERVAL_DAYS, rng)
  }
}

function rateReview(card: SrsCard, rating: Rating, now: number, rng: () => number): SrsCard {
  switch (rating) {
    case 'again':
      card.state = 'relearning'
      card.step = 0
      card.interval = LAPSE_NEW_INTERVAL_DAYS
      card.due = now + RELEARNING_STEPS_MIN[0] * MIN_MS
      card.ease = Math.max(MIN_EASE, card.ease - 20)
      card.lapses += 1
      return card
    case 'hard': {
      const ivl = Math.max(Math.round(card.interval * 1.2), card.interval + 1)
      card.interval = Math.min(MAX_INTERVAL_DAYS, fuzzedInterval(ivl, rng))
      card.ease = Math.max(MIN_EASE, card.ease - 15)
      card.due = now + card.interval * DAY_MS
      return card
    }
    case 'good': {
      const ivl = Math.max(Math.round((card.interval * card.ease) / 100), 1)
      card.interval = Math.min(MAX_INTERVAL_DAYS, fuzzedInterval(ivl, rng))
      card.due = now + card.interval * DAY_MS
      return card
    }
    case 'easy': {
      const ivl = Math.max(Math.round((card.interval * card.ease * 1.3) / 100), 1)
      card.interval = Math.min(MAX_INTERVAL_DAYS, fuzzedInterval(ivl, rng))
      card.ease = Math.min(MAX_EASE, card.ease + 15)
      card.due = now + card.interval * DAY_MS
      return card
    }
  }
}

function graduate(card: SrsCard, now: number, intervalDays: number, rng: () => number): SrsCard {
  card.state = 'review'
  card.interval = Math.min(MAX_INTERVAL_DAYS, fuzzedInterval(intervalDays, rng))
  card.due = now + card.interval * DAY_MS
  return card
}

/** Anki fuzz: ±5% for intervals >= 2 days, result inclusive on both ends. */
export function fuzzedInterval(ivl: number, rng: () => number): number {
  if (ivl < 2) return ivl
  const fuzz = Math.trunc(ivl * 0.05)
  const min = Math.max(2, ivl - fuzz)
  const max = ivl + fuzz
  return min + Math.floor(rng() * (max - min + 1))
}
