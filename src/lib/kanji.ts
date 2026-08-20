import kanjiData from '../data/kanji.json'

export interface Radical {
  glyph: string
  keyword: string
}

export interface Sentence {
  jp: string
  en: string
  furigana: string
}

export interface KanjiEntry {
  kanji: string
  grade: number
  on: string[]
  kun: string[]
  meaning: string
  meanings: string[]
  radicals: Radical[]
  sentences: Sentence[]
  mnemonic: string
  mnemonicSource: 'jpdb' | 'ai'
}

export const KANJI_DATA: KanjiEntry[] = kanjiData as unknown as KanjiEntry[]

const byGlyph = new Map(KANJI_DATA.map((entry) => [entry.kanji, entry]))

export function getKanji(kanji: string): KanjiEntry {
  const entry = byGlyph.get(kanji)
  if (!entry) throw new Error(`Unknown kanji: ${kanji}`)
  return entry
}