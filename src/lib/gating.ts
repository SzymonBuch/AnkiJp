import { getKanji, type KanjiEntry } from './kanji'
import { getRadicalDependencies } from './radicals'
import { bareId, cardId, typeOf, type SrsCard } from './srs'
import { VOCAB_DATA, type VocabEntry } from './vocab'

export interface GateContext {
  /** Ids of cards seen at least once (state ≠ `new`), any content type. */
  seenIds: ReadonlySet<string>
  /** Union of the non-self components of every seen kanji. */
  componentsOfSeenKanji: ReadonlySet<string>
}

/**
 * Snapshot of "what has been seen", computed in memory from a card listing.
 * Cheap enough to rebuild on every queue construction, which keeps gating
 * live inside a session (studying a component unlocks kanji mid-session).
 */
export function buildGateContext(cards: readonly SrsCard[]): GateContext {
  const seenIds = new Set<string>()
  const componentsOfSeenKanji = new Set<string>()
  for (const card of cards) {
    if (card.state === 'new') continue
    seenIds.add(card.id)
    if (typeOf(card.id) !== 'kanji') continue
    const glyph = bareId(card.id)
    for (const { glyph: component } of getKanji(glyph).radicals) {
      // Self-fallback placeholders are not real components (#2).
      if (component !== glyph) componentsOfSeenKanji.add(component)
    }
  }
  return { seenIds, componentsOfSeenKanji }
}

/**
 * One predicate shared by radical seeding (migration rule B, decision #11)
 * and kanji gating (decision #3): a component counts as seen once it has been
 * studied as a radical, or as a kanji with the same glyph (口 is both), or
 * when it appeared in the decomposition of any studied kanji.
 */
export function isComponentSeen(glyph: string, ctx: GateContext): boolean {
  return (
    ctx.seenIds.has(cardId('radical', glyph)) ||
    ctx.seenIds.has(cardId('kanji', glyph)) ||
    ctx.componentsOfSeenKanji.has(glyph)
  )
}

/** A kanji is introducible once every real component has been seen (#3, #2). */
export function isKanjiUnlocked(entry: KanjiEntry, ctx: GateContext): boolean {
  return entry.radicals.every(
    ({ glyph }) => glyph === entry.kanji || isComponentSeen(glyph, ctx),
  )
}

/** Radical-specific dependency predicate: only the exact radical/kanji card counts. */
export function isRadicalComponentSeen(glyph: string, ctx: GateContext): boolean {
  return ctx.seenIds.has(cardId('radical', glyph)) || ctx.seenIds.has(cardId('kanji', glyph))
}

/** A radical is new-card eligible once every direct component has been seen. */
export function isRadicalUnlocked(glyph: string, ctx: GateContext): boolean {
  return getRadicalDependencies(glyph).every((component) => isRadicalComponentSeen(component, ctx))
}

/** Direct components still blocking a radical card. */
export function missingRadicalComponents(glyph: string, ctx: GateContext): string[] {
  return getRadicalDependencies(glyph).filter((component) => !isRadicalComponentSeen(component, ctx))
}

/** Components still blocking an unlocked-to-be kanji (Deck drill-down list). */
export function missingComponents(entry: KanjiEntry, ctx: GateContext): string[] {
  return entry.radicals
    .filter(({ glyph }) => glyph !== entry.kanji && !isComponentSeen(glyph, ctx))
    .map(({ glyph }) => glyph)
}

/**
 * A word becomes introducible once every kanji it uses has been seen (#8, no
 * exceptions — every vocab kanji exists in the deck). Seeing the kanji itself
 * is required: unlocking it via components is not enough, so words follow
 * their kanji in study order. Pure-kana words pass trivially (#12).
 */
export function isVocabUnlocked(entry: VocabEntry, ctx: GateContext): boolean {
  return entry.kanji.every((glyph) => ctx.seenIds.has(cardId('kanji', glyph)))
}

/** A ranked word still waiting for its kanji, with the glyphs it misses. */
export interface LockedVocabRow {
  entry: VocabEntry
  missing: string[]
}

/**
 * Every ranked vocabulary word that is not yet introducible (Etap 4 roadmap:
 * the Deck drill-down and the empty-session hint). Words are returned in
 * top-2000 order — the order they will unlock in.
 */
export function lockedVocabRows(cards: readonly SrsCard[]): LockedVocabRow[] {
  const ctx = buildGateContext(cards)
  const rows: LockedVocabRow[] = []
  for (const entry of VOCAB_DATA) {
    const missing = entry.kanji.filter((glyph) => !ctx.seenIds.has(cardId('kanji', glyph)))
    if (missing.length > 0) rows.push({ entry, missing })
  }
  return rows
}
