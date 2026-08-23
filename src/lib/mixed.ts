import type { ReviewLog } from './db'
import { getKanji } from './kanji'
import { getKanjiUsing } from './radicals'
import { bareId, cardId, typeOf, type ContentType, type SrsCard } from './srs'
import { getVocab, type VocabEntry } from './vocab'

/** A session runs over one content type or over all of them mixed together. */
export type SessionType = ContentType | 'mixed'

/** Topological band order of the study chain: radykał → znak → słowo. */
export const TYPE_RANK: Record<ContentType, number> = { radical: 0, kanji: 1, vocab: 2 }

/** All content types, in topological order. */
export const CONTENT_TYPES: readonly ContentType[] = ['radical', 'kanji', 'vocab']

/**
 * Latest introduction (first answer, `prevState === 'new'`) per card id.
 * 0 = never introduced. Built from the timestamp-ordered review log —
 * sessions stay log-driven, no extra bookkeeping (Etap 5).
 */
export type IntroductionTimes = ReadonlyMap<string, number>

export function introductionTimes(logs: readonly ReviewLog[]): IntroductionTimes {
  const intro = new Map<string, number>()
  for (const log of logs) {
    if (log.prevState !== 'new') continue
    const previous = intro.get(log.cardId) ?? 0
    if (log.timestamp > previous) intro.set(log.cardId, log.timestamp)
  }
  return intro
}

function seenAt(id: string, intro: IntroductionTimes): number {
  return intro.get(id) ?? 0
}

/**
 * When `component` last became seen through an introduction: as a radical,
 * as a same-glyph kanji (口 is both), or via any host kanji whose study made
 * it count as a component (`componentsOfSeenKanji`). 0 when never introduced.
 */
function componentIntroducedAt(component: string, intro: IntroductionTimes): number {
  let time = Math.max(
    seenAt(cardId('radical', component), intro),
    seenAt(cardId('kanji', component), intro),
  )
  for (const host of getKanjiUsing(component)) {
    time = Math.max(time, seenAt(cardId('kanji', host.kanji), intro))
  }
  return time
}

function kanjiIntroducedAt(glyph: string, intro: IntroductionTimes): number {
  let time = 0
  for (const { glyph: component } of getKanji(glyph).radicals) {
    // Self-fallback placeholders gate nothing (#2).
    if (component === glyph) continue
    time = Math.max(time, componentIntroducedAt(component, intro))
  }
  return time
}

function vocabIntroducedAt(entry: VocabEntry, intro: IntroductionTimes): number {
  let time = 0
  for (const glyph of entry.kanji) {
    time = Math.max(time, seenAt(cardId('kanji', glyph), intro))
  }
  return time
}

/**
 * When the card became introducible: the newest introduction among the facts
 * that gate it. Radicals depend on nothing; a kanji waits for its components;
 * a word waits for its kanji. 0 covers "unlocked from the start" (pure-kana
 * words) and unlocks granted without a log entry (migration rule B).
 */
export function introducedAt(card: SrsCard, intro: IntroductionTimes): number {
  switch (typeOf(card.id)) {
    case 'radical':
      return 0
    case 'kanji':
      return kanjiIntroducedAt(bareId(card.id), intro)
    case 'vocab':
      return vocabIntroducedAt(getVocab(bareId(card.id)), intro)
  }
}

/**
 * Study (mixed) order — key `(topological type rank, last-introduction
 * timestamp, pos)`: radicals before kanji before words; within a band the
 * most freshly unlocked cards float up, so right after introducing a
 * component its kanji lead the queue and their words follow; ties fall back
 * to the study position (usage rank / grade order / top-2000 rank).
 */
export function compareStudyMixed(a: SrsCard, b: SrsCard, intro: IntroductionTimes): number {
  const band = TYPE_RANK[typeOf(a.id)] - TYPE_RANK[typeOf(b.id)]
  if (band !== 0) return band
  const freshness = introducedAt(b, intro) - introducedAt(a, intro)
  if (freshness !== 0) return freshness
  return a.pos - b.pos
}
