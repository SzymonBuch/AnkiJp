import { describe, expect, it } from 'vitest'
import type { ReviewLog } from './db'
import {
  compareStudyMixed,
  introducedAt,
  introductionTimes,
  TYPE_RANK,
} from './mixed'
import { KANJI_DATA } from './kanji'
import { RADICALS_DATA, getRadicalDependencies } from './radicals'
import { VOCAB_DATA } from './vocab'
import { cardId, createCard, type SrsCard } from './srs'

const NOW = new Date('2026-08-20T12:00:00Z').getTime()

function card(id: string, pos = 0): SrsCard {
  return createCard(id, pos, NOW)
}

function introLog(cardId: string, timestamp: number): ReviewLog {
  return {
    cardId,
    rating: 'good',
    prevState: 'new',
    newState: 'learning',
    interval: 0,
    ease: 250,
    due: timestamp,
    timestamp,
  }
}

/** A deck kanji with at least two distinct (non-self) components. */
const MULTI = KANJI_DATA.find(
  (e) => e.radicals.filter((r) => r.glyph !== e.kanji).length >= 2,
)!
const MULTI_COMPONENTS = MULTI.radicals.filter((r) => r.glyph !== MULTI.kanji).map((r) => r.glyph)

describe('introductionTimes', () => {
  it('keeps the latest introduction per card and skips non-introduction answers', () => {
    const intro = introductionTimes([
      introLog('r:口', NOW - 300),
      // A later answer of the same card is a review, not a re-introduction…
      { ...introLog('r:口', NOW - 100), prevState: 'learning', newState: 'review' },
      // …but a second first-answer (e.g. after a reset) moves the stamp.
      introLog('r:口', NOW - 200),
      introLog('k:一', NOW),
    ])
    expect(intro.get('r:口')).toBe(NOW - 200)
    expect(intro.get('k:一')).toBe(NOW)
    expect(intro.get('k:二')).toBeUndefined()
  })
})

describe('introducedAt (freshness heuristic)', () => {
  it('is always 0 for radicals — they depend on nothing', () => {
    const glyph = RADICALS_DATA[0].glyph
    expect(introducedAt(card(cardId('radical', glyph)), new Map())).toBe(0)
  })

  it('dates a radical by its newest direct component only', () => {
    const deps = getRadicalDependencies('動')
    const intro = new Map([
      [cardId('radical', deps[0]), NOW - 500],
      [cardId('kanji', deps[1]), NOW - 100],
    ])
    expect(introducedAt(card(cardId('radical', '動')), intro)).toBe(NOW - 100)
  })

  it('dates a kanji by its newest introduced component', () => {
    const [first, second] = MULTI_COMPONENTS
    const intro = new Map([
      [cardId('radical', first), NOW - 500],
      [cardId('radical', second), NOW - 100],
    ])
    expect(introducedAt(card(cardId('kanji', MULTI.kanji)), intro)).toBe(NOW - 100)
  })

  it('accepts aliases: the component studied as a same-glyph kanji counts too', () => {
    const alias = RADICALS_DATA.find((r) => KANJI_DATA.some((k) => k.kanji === r.glyph))!
    const host = KANJI_DATA.find((e) =>
      e.radicals.some((r) => r.glyph === alias.glyph && r.glyph !== e.kanji),
    )
    if (!host) return
    const intro = new Map([[cardId('kanji', alias.glyph), NOW - 42]])
    expect(introducedAt(card(cardId('kanji', host.kanji)), intro)).toBe(NOW - 42)
  })

  it('accepts hosts: introducing a kanji that carries the component unlocks its siblings', () => {
    const component = MULTI_COMPONENTS[0]
    const host = KANJI_DATA.find(
      (e) =>
        e.kanji !== MULTI.kanji &&
        e.radicals.some((r) => r.glyph === component && r.glyph !== e.kanji),
    )
    if (!host) return
    const intro = new Map([[cardId('kanji', host.kanji), NOW - 7]])
    expect(introducedAt(card(cardId('kanji', MULTI.kanji)), intro)).toBe(NOW - 7)
  })

  it('ignores self-fallback placeholders (#2)', () => {
    const selfOnly = KANJI_DATA.find(
      (e) => e.radicals.length >= 1 && e.radicals.every((r) => r.glyph === e.kanji),
    )!
    expect(introducedAt(card(cardId('kanji', selfOnly.kanji)), new Map())).toBe(0)
  })

  it('dates a word by its newest introduced kanji; pure-kana words stay at 0 (#12)', () => {
    const word = VOCAB_DATA.find((e) => e.kanji.length >= 1)!
    const intro = new Map(word.kanji.map((glyph, i) => [cardId('kanji', glyph), NOW - i * 10]))
    expect(introducedAt(card(cardId('vocab', word.id)), intro)).toBe(NOW)

    const kana = VOCAB_DATA.find((e) => e.kanji.length === 0)
    if (!kana) return
    expect(introducedAt(card(cardId('vocab', kana.id)), intro)).toBe(0)
  })
})

describe('compareStudyMixed (key: type rank, last-introduction time, pos)', () => {
  it('orders bands topologically: radicals before kanji before words', () => {
    expect(TYPE_RANK).toEqual({ radical: 0, kanji: 1, vocab: 2 })
    const radical = card(`r:${RADICALS_DATA[50].glyph}`, 50)
    const kanji = card(cardId('kanji', KANJI_DATA[3].kanji), 3)
    const word = card(`w:${VOCAB_DATA[5].id}`, 5)
    const sorted = [word, kanji, radical].sort((a, b) => compareStudyMixed(a, b, new Map()))
    expect(sorted.map((c) => c.id)).toEqual([radical.id, kanji.id, word.id])
  })

  it('floats freshly unlocked cards to the front of their band regardless of pos', () => {
    const oldGlyph = RADICALS_DATA[80].glyph
    // The two kanji must not share components, or the shared introductions
    // would date both cards equally.
    const gatedA = KANJI_DATA.find(
      (e) =>
        e.kanji !== MULTI.kanji &&
        e.radicals.every((r) => !MULTI_COMPONENTS.includes(r.glyph)) &&
        e.radicals.some((r) => r.glyph === oldGlyph && r.glyph !== e.kanji),
    )
    if (!gatedA) return
    // kanjiFresh has higher pos but was unlocked just now; kanjiOld earlier.
    const kanjiOld = card(cardId('kanji', gatedA.kanji), 1)
    const kanjiFresh = card(cardId('kanji', MULTI.kanji), 900)
    const intro = new Map([
      [cardId('radical', oldGlyph), NOW - 1000],
      ...MULTI_COMPONENTS.map((glyph) => [cardId('radical', glyph), NOW] as const),
    ])
    expect(introducedAt(kanjiOld, intro)).toBe(NOW - 1000)
    expect(introducedAt(kanjiFresh, intro)).toBe(NOW)
    const sorted = [kanjiOld, kanjiFresh].sort((a, b) => compareStudyMixed(a, b, intro))
    expect(sorted.map((c) => c.id)).toEqual([
      cardId('kanji', MULTI.kanji),
      cardId('kanji', gatedA.kanji),
    ])
  })

  it('breaks freshness ties with pos (usage rank / grade order / top-2000)', () => {
    const sorted = [
      card(cardId('kanji', KANJI_DATA[9].kanji), 9),
      card(cardId('kanji', KANJI_DATA[2].kanji), 2),
      card(cardId('kanji', KANJI_DATA[5].kanji), 5),
    ].sort((a, b) => compareStudyMixed(a, b, new Map()))
    expect(sorted.map((c) => c.pos)).toEqual([2, 5, 9])
  })
})
