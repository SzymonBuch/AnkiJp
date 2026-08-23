import { getKanji, type KanjiEntry } from './kanji'
import { getRadical, type RadicalEntry } from './radicals'
import { bareId, DAY_MS, STARTING_EASE, type SrsCard } from './srs'
import type { QuizPools } from './db'

export type QuizSource = 'known' | 'progress' | 'new'

/** Session-level mode; `mixed` resolves to a concrete mode per question. */
export type QuizMode = 'reading' | 'meaning' | 'reverse' | 'mixed' | 'cloze'
/** Concrete per-question mode (what a `QuizQuestion` actually carries). */
export type QuestionMode = Exclude<QuizMode, 'mixed'>

export interface QuizConfig {
  sources: QuizSource[]
  /** School grades 1–6; meaningful only for kanji quizzes. */
  grades: number[]
  count: number
  extraNew: number
  dueOnly: boolean
  problematicOnly: boolean
}

export const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  sources: ['known'],
  grades: [1, 2, 3, 4, 5, 6],
  count: 10,
  extraNew: 0,
  dueOnly: false,
  problematicOnly: false,
}

interface QuestionBase {
  index: number
  mode: QuestionMode
  /** Text shown as the prompt. */
  prompt: string
  /** The correct answer text. */
  correct: string
  /** 4 shuffled options; exactly one equals `correct`. */
  options: string[]
}

export interface KanjiQuestion extends QuestionBase {
  kind: 'kanji'
  /** The kanji the question is about. */
  kanji: string
  /** School grade of the kanji (G1–G6 badge). */
  grade: number
  /** The primary reading the question is built around. */
  reading: string
  /** Cloze only: the example sentence with the kanji hidden… */
  sentenceJp?: string
  /** …and its English translation, revealed after answering. */
  sentenceEn?: string
}

export interface RadicalQuestion extends QuestionBase {
  kind: 'radical'
  /** Prompt is the bare glyph; identical to some kanji fronts — TypeBadge disambiguates. */
  glyph: string
  keyword: string
}

export type QuizQuestion = KanjiQuestion | RadicalQuestion

export interface SelectQuizOpts {
  now?: number
  /** Extra target filter applied before sampling (e.g. cloze sentence eligibility). */
  predicate?: (entry: KanjiEntry) => boolean
}

/** Primary reading of an entry: first on-yomi, falling back to the first kun-yomi. */
export function primaryReading(entry: KanjiEntry): string {
  return entry.on[0] ?? entry.kun[0] ?? ''
}

/** A kanji can be quizzed in cloze mode when some example sentence contains it verbatim. */
export function isClozeEligible(entry: KanjiEntry): boolean {
  return entry.sentences.some((s) => s.jp.includes(entry.kanji))
}

/** True when a card survives the quiz's extra filters (`dueOnly` / `problematicOnly`). */
export function passesFilters(
  card: SrsCard,
  config: Pick<QuizConfig, 'dueOnly' | 'problematicOnly'>,
  now: number,
): boolean {
  if (config.dueOnly && (card.state === 'new' || card.due > endOfToday(now))) return false
  if (config.problematicOnly && card.lapses <= 0 && card.ease >= STARTING_EASE) return false
  return true
}

/**
 * Pick quiz targets from the snapshotted pools. Pure function — never touches
 * the DB or SRS state. Samples `count` entries from the merged, filtered
 * sources, then appends up to `extraNew` random new kanji (grade-filtered,
 * never duplicating the base set).
 */
export function selectQuizTargets(
  config: QuizConfig,
  pools: QuizPools,
  opts: SelectQuizOpts = {},
  rng: () => number = Math.random,
): KanjiEntry[] {
  const now = opts.now ?? Date.now()
  const grades = new Set(config.grades)
  const selected = new Set<string>()
  const targets: KanjiEntry[] = []

  const sourceCards = config.sources.flatMap((source) => pools[source] ?? [])
  const candidates = sourceCards
    .filter((card) => passesFilters(card, config, now))
    .map((card) => getKanji(bareId(card.id)))
    .filter((entry) => grades.has(entry.grade))
    .filter((entry) => opts.predicate?.(entry) ?? true)
  for (const entry of sampleKanji(candidates, config.count, rng)) {
    if (!selected.has(entry.kanji)) {
      selected.add(entry.kanji)
      targets.push(entry)
    }
  }

  if (config.extraNew > 0) {
    const extraCandidates = pools.new
      .map((card) => getKanji(bareId(card.id)))
      .filter((entry) => grades.has(entry.grade) && !selected.has(entry.kanji))
    for (const entry of sampleKanji(extraCandidates, config.extraNew, rng)) {
      if (!selected.has(entry.kanji)) {
        selected.add(entry.kanji)
        targets.push(entry)
      }
    }
  }
  return targets
}

/** Random sample without replacement: Fisher–Yates shuffle + cut. */
export function sampleKanji<T>(arr: T[], count: number, rng: () => number): T[] {
  return shuffle(arr, rng).slice(0, Math.max(0, count))
}

/**
 * Build a complete, isolated kanji quiz from the given targets. Pure function —
 * never touches the DB, the SRS state or logs. Question targets are only the
 * given entries; distractors may come from any kanji (they are simply wrong
 * answers). `mixed` picks a concrete mode per question, uniformly among the
 * modes available for that entry (cloze included when the entry has sentences).
 */
export function buildQuiz(
  mode: QuizMode,
  poolEntries: KanjiEntry[],
  allEntries: KanjiEntry[],
  rng: () => number = Math.random,
): KanjiQuestion[] {
  return poolEntries.map((entry, index) => {
    const questionMode = mode === 'mixed' ? pickMode(entry, rng) : mode
    return buildQuestion(questionMode, entry, index, allEntries, rng)
  })
}

/**
 * Radical quiz (Etap 2): meaning mode — glyph → keyword — with distractors
 * drawn from the full radical pool. Reverse stays unbuilt until the keywords
 * prove unique enough on real cards (0 duplicates today, but long strings).
 */
export function buildRadicalQuiz(
  targets: RadicalEntry[],
  all: RadicalEntry[],
  rng: () => number = Math.random,
): RadicalQuestion[] {
  return targets.map((entry, index) => ({
    kind: 'radical',
    index,
    mode: 'meaning' as const,
    prompt: entry.glyph,
    glyph: entry.glyph,
    keyword: entry.keyword,
    correct: entry.keyword,
    options: buildOptions(entry.keyword, candidateKeywords(entry, all), 3, rng),
  }))
}

function candidateKeywords(target: RadicalEntry, all: RadicalEntry[]): string[] {
  const seen = new Set([target.keyword])
  const out: string[] = []
  for (const { keyword } of all) {
    if (!seen.has(keyword)) {
      seen.add(keyword)
      out.push(keyword)
    }
  }
  return out
}

/** Sample radical quiz targets from snapshotted pools; same source semantics as kanji. */
export function selectRadicalTargets(
  config: Pick<QuizConfig, 'sources' | 'count' | 'dueOnly' | 'problematicOnly'>,
  pools: QuizPools,
  now: number,
  rng: () => number = Math.random,
): RadicalEntry[] {
  const seen = new Set<string>()
  const candidates: RadicalEntry[] = []
  for (const card of config.sources.flatMap((source) => pools[source] ?? [])) {
    if (!passesFilters(card, config, now)) continue
    const glyph = bareId(card.id)
    if (seen.has(glyph)) continue
    seen.add(glyph)
    candidates.push(getRadical(glyph))
  }
  return sampleKanji(candidates, config.count, rng)
}

function availableModes(entry: KanjiEntry): QuestionMode[] {
  return isClozeEligible(entry)
    ? ['reading', 'meaning', 'reverse', 'cloze']
    : ['reading', 'meaning', 'reverse']
}

function pickMode(entry: KanjiEntry, rng: () => number): QuestionMode {
  const modes = availableModes(entry)
  return modes[Math.floor(rng() * modes.length)]
}

function buildQuestion(
  mode: QuestionMode,
  entry: KanjiEntry,
  index: number,
  all: KanjiEntry[],
  rng: () => number,
): KanjiQuestion {
  const reading = primaryReading(entry)
  const question: KanjiQuestion = {
    kind: 'kanji',
    index,
    mode,
    kanji: entry.kanji,
    grade: entry.grade,
    prompt: mode === 'cloze' ? clozePrompt(entry) : promptFor(mode, entry, reading),
    reading,
    correct: correctFor(mode, entry),
    options: [],
  }
  question.options = buildOptions(question.correct, candidatesFor(mode, entry, all), 3, rng)
  if (mode === 'cloze') {
    const sentence = entry.sentences.find((s) => s.jp.includes(entry.kanji))
    question.sentenceJp = sentence?.jp
    question.sentenceEn = sentence?.en
  }
  return question
}

function correctFor(mode: QuestionMode, entry: KanjiEntry): string {
  switch (mode) {
    case 'reading':
      return primaryReading(entry)
    case 'meaning':
      return entry.meaning
    case 'reverse':
    case 'cloze':
      return entry.kanji
  }
}

function promptFor(mode: QuestionMode, entry: KanjiEntry, reading: string): string {
  return mode === 'reverse' ? reading : entry.kanji
}

const CLOZE_BLANK = '◯'

function clozePrompt(entry: KanjiEntry): string {
  const sentence = entry.sentences.find((s) => s.jp.includes(entry.kanji))
  return sentence ? sentence.jp.replace(entry.kanji, CLOZE_BLANK) : CLOZE_BLANK
}

/** Distractor pool: plausible-looking wrong answers for one target entry. */
function candidatesFor(mode: QuestionMode, target: KanjiEntry, all: KanjiEntry[]): string[] {
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
      // reverse and cloze share the same structural rule: only kanji that
      // cannot be read with the target's primary reading keep exactly one
      // correct option.
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

function endOfToday(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime() + DAY_MS
}
