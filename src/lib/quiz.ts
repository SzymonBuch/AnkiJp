import type { KanjiEntry } from './kanji'

export type QuizMode = 'reading' | 'meaning' | 'reverse'

export interface QuizQuestion {
  index: number
  mode: QuizMode
  /** The kanji the question is about (always from the known pool). */
  kanji: string
  /** Text shown as the prompt: a kanji (reading/meaning) or a reading (reverse). */
  prompt: string
  /** The primary reading the question is built around. */
  reading: string
  /** The correct answer text. */
  correct: string
  /** 4 shuffled options; exactly one equals `correct`. */
  options: string[]
}

/** Primary reading of an entry: first on-yomi, falling back to the first kun-yomi. */
export function primaryReading(entry: KanjiEntry): string {
  return entry.on[0] ?? entry.kun[0] ?? ''
}

/**
 * Build a complete, isolated quiz from the known pool. Pure function — never
 * touches the DB, the SRS state or logs. Question targets are only pool
 * entries; distractors may come from any kanji (they are simply wrong answers).
 */
export function buildQuiz(
  mode: QuizMode,
  poolEntries: KanjiEntry[],
  allEntries: KanjiEntry[],
  rng: () => number = Math.random,
): QuizQuestion[] {
  return poolEntries.map((entry, index) => {
    const reading = primaryReading(entry)
    const correct = correctFor(mode, entry)
    const prompt = promptFor(mode, entry, reading)
    const options = buildOptions(correct, candidatesFor(mode, entry, allEntries), 3, rng)
    return { index, mode, kanji: entry.kanji, prompt, reading, correct, options }
  })
}

function correctFor(mode: QuizMode, entry: KanjiEntry): string {
  switch (mode) {
    case 'reading':
    case 'reverse':
      return mode === 'reading' ? primaryReading(entry) : entry.kanji
    case 'meaning':
      return entry.meaning
  }
}

function promptFor(mode: QuizMode, entry: KanjiEntry, reading: string): string {
  return mode === 'reverse' ? reading : entry.kanji
}

/** Distractor pool: plausible-looking wrong answers for one target entry. */
function candidatesFor(mode: QuizMode, target: KanjiEntry, all: KanjiEntry[]): string[] {
  const targetReadings = new Set([...target.on, ...target.kun])
  const targetMeanings = new Set([target.meaning, ...target.meanings])
  const displayReading = primaryReading(target)
  const seen = new Set<string>()
  const out: string[] = []

  for (const e of all) {
    if (e.kanji === target.kanji) continue
    let options: string[] = []
    if (mode === 'reading') {
      options = [...e.on, ...e.kun].filter((r) => r && !targetReadings.has(r))
    } else if (mode === 'meaning') {
      options = e.meaning && !targetMeanings.has(e.meaning) ? [e.meaning] : []
    } else if (!e.on.includes(displayReading) && !e.kun.includes(displayReading)) {
      options = [e.kanji]
    }
    for (const candidate of options) {
      if (!seen.has(candidate)) {
        seen.add(candidate)
        out.push(candidate)
      }
    }
  }
  return out
}

function buildOptions(correct: string, candidates: string[], amount: number, rng: () => number): string[] {
  return shuffle([correct, ...sampleN(candidates, amount, rng)], rng)
}

function sampleN<T>(arr: T[], n: number, rng: () => number): T[] {
  const pool = [...arr]
  const out: T[] = []
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  }
  return out
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}