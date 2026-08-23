import vocabData from '../data/vocab.json'
import type { Sentence } from './kanji'

/** One vocabulary card: dictionary form → meaning + reading (decision #5). */
export interface VocabEntry {
  /** The word form itself (`食べる`) — doubles as the bare card id after `w:`. */
  id: string
  /** JMdict entry resolved by the keb+reb cascade (decision #13). */
  entId: string
  /** Kana reading of the dictionary form. */
  reading: string
  /** Pre-rendered `<ruby>` furigana, same convention as kanji sentences. */
  furiganaHtml: string
  /** Displayed meaning (first sense, ≤3 glosses). */
  meaning: string
  /** Complete glosses — the distractor filters use all of them (decision #14). */
  meanings: string[]
  /** Kanji the word uses; empty for pure-kana words (legal, decision #12). */
  kanji: string[]
  sentences: Sentence[]
}

/**
 * Vocabulary is the jpdb top-2000 in ranking order, so an entry's index is
 * both its study position and its usefulness rank (decisions #4, #15).
 */
export const VOCAB_DATA: VocabEntry[] = vocabData as unknown as VocabEntry[]

const byId = new Map(VOCAB_DATA.map((entry) => [entry.id, entry]))

export function getVocab(id: string): VocabEntry {
  const entry = byId.get(id)
  if (!entry) throw new Error(`Unknown vocab: ${id}`)
  return entry
}
