import radicalData from '../data/radicals.json'
import { KANJI_DATA, type KanjiEntry } from './kanji'

export interface RadicalEntry {
  glyph: string
  keyword: string
  /** How many deck kanji use this component (usage ranking, most-used first). */
  usedIn: number
}

/**
 * Radicals are the jpdb components of the final deck. The bundled array is
 * already sorted by usage frequency (decision #15), so a radical's study
 * position (`pos` at seeding time) is simply its index here.
 */
export const RADICALS_DATA: RadicalEntry[] = radicalData as unknown as RadicalEntry[]

const byGlyph = new Map(RADICALS_DATA.map((entry) => [entry.glyph, entry]))

/** Reverse index component → kanji containing it, in deck order (Etap 1). */
const kanjiByComponent = new Map<string, KanjiEntry[]>()
for (const entry of KANJI_DATA) {
  for (const { glyph } of entry.radicals) {
    // Self-fallbacks are build-time placeholders (single-element kanji), not
    // real components — they have no radical card and never appear here.
    if (glyph === entry.kanji) continue
    const list = kanjiByComponent.get(glyph)
    if (!list) {
      kanjiByComponent.set(glyph, [entry])
    } else if (!list.includes(entry)) {
      // jpdb decompositions may repeat a component (高 lists 口 twice);
      // the grid shows each kanji once.
      list.push(entry)
    }
  }
}

export function getRadical(glyph: string): RadicalEntry {
  const entry = byGlyph.get(glyph)
  if (!entry) throw new Error(`Unknown radical: ${glyph}`)
  return entry
}

/** Deck kanji whose decomposition contains this component, most-used first. */
export function getKanjiUsing(glyph: string): KanjiEntry[] {
  return kanjiByComponent.get(glyph) ?? []
}
