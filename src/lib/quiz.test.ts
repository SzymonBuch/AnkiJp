import { describe, expect, it } from 'vitest'
import { KANJI_DATA, type KanjiEntry } from './kanji'
import {
  buildQuiz,
  DEFAULT_QUIZ_CONFIG,
  isClozeEligible,
  primaryReading,
  sampleKanji,
  selectQuizTargets,
  type QuizConfig,
  type QuizQuestion,
} from './quiz'
import { bareId, cardId, createCard, DAY_MS, STARTING_EASE, type SrsCard } from './srs'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POOL = KANJI_DATA.slice(0, 6)

function entryFor(question: QuizQuestion) {
  return KANJI_DATA.find((e) => e.kanji === question.kanji)!
}

describe('buildQuiz', () => {
  it('builds one question per pool entry, in pool order, only from the known pool', () => {
    for (const mode of ['reading', 'meaning', 'reverse'] as const) {
      const quiz = buildQuiz(mode, POOL, KANJI_DATA, mulberry32(7))
      expect(quiz).toHaveLength(POOL.length)
      expect(quiz.map((q) => q.kanji)).toEqual(POOL.map((e) => e.kanji))
    }
  })

  it('reading mode: prompt is the kanji, correct is one of its readings, 4 unique options without other readings of the same kanji', () => {
    const quiz = buildQuiz('reading', POOL, KANJI_DATA, mulberry32(1))
    for (const q of quiz) {
      const entry = entryFor(q)
      const readings = new Set([...entry.on, ...entry.kun])
      expect(q.prompt).toBe(q.kanji)
      expect(readings).toContain(q.correct)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options).toContain(q.correct)
      for (const option of q.options) {
        if (option !== q.correct) expect(readings).not.toContain(option)
      }
    }
  })

  it('meaning mode: prompt is the kanji, correct is the keyword, no other meaning of the kanji in the options', () => {
    const quiz = buildQuiz('meaning', POOL, KANJI_DATA, mulberry32(2))
    for (const q of quiz) {
      const entry = entryFor(q)
      expect(q.prompt).toBe(q.kanji)
      expect(q.correct).toBe(entry.meaning)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      for (const option of q.options) {
        if (option !== q.correct) expect(entry.meanings).not.toContain(option)
      }
    }
  })

  it('reverse mode: prompt is the primary reading, distractors are kanji that cannot be read that way', () => {
    const quiz = buildQuiz('reverse', POOL, KANJI_DATA, mulberry32(3))
    for (const q of quiz) {
      const entry = entryFor(q)
      expect(q.prompt).toBe(primaryReading(entry))
      expect(q.correct).toBe(q.kanji)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      for (const option of q.options) {
        if (option === q.correct) continue
        const other = KANJI_DATA.find((e) => e.kanji === option)!
        expect([...other.on, ...other.kun]).not.toContain(q.prompt)
      }
    }
  })

  it('is deterministic for a given rng sequence', () => {
    const a = buildQuiz('reading', POOL, KANJI_DATA, mulberry32(42))
    const b = buildQuiz('reading', POOL, KANJI_DATA, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('handles a pool smaller than the option count (distractors come from all kanji)', () => {
    const quiz = buildQuiz('meaning', POOL.slice(0, 1), KANJI_DATA, mulberry32(11))
    expect(quiz).toHaveLength(1)
    expect(quiz[0].options).toHaveLength(4)
    expect(new Set(quiz[0].options).size).toBe(4)
    expect(quiz[0].options).toContain(quiz[0].correct)
  })

  it('every question has exactly one correct option', () => {
    const quiz = buildQuiz('reading', POOL, KANJI_DATA, mulberry32(5))
    for (const q of quiz) {
      expect(q.options.filter((option) => option === q.correct)).toHaveLength(1)
    }
  })
})

describe('sampleKanji', () => {
  it('is deterministic for a given rng sequence', () => {
    const arr = ['a', 'b', 'c', 'd', 'e']
    expect(sampleKanji(arr, 3, mulberry32(7))).toEqual(sampleKanji(arr, 3, mulberry32(7)))
  })

  it('returns count unique elements from the array', () => {
    const out = sampleKanji([1, 2, 3, 4, 5], 4, mulberry32(9))
    expect(out).toHaveLength(4)
    expect(new Set(out).size).toBe(4)
    for (const value of out) expect([1, 2, 3, 4, 5]).toContain(value)
  })

  it('returns the whole array when count exceeds its length', () => {
    expect(sampleKanji([1, 2], 10, mulberry32(1))).toHaveLength(2)
    expect(sampleKanji([], 3, mulberry32(1))).toEqual([])
  })
})

describe('selectQuizTargets', () => {
  const NOW = new Date('2026-08-20T12:00:00Z').getTime()

  function cardFor(entry: KanjiEntry, over: Partial<SrsCard> = {}): SrsCard {
    return { ...createCard(cardId('kanji', entry.kanji), KANJI_DATA.indexOf(entry), NOW), ...over }
  }

  function makePools() {
    const byGrade = (grade: number) => KANJI_DATA.filter((e) => e.grade === grade)
    return {
      known: byGrade(1)
        .slice(0, 5)
        .map((e) => cardFor(e, { state: 'review', interval: 30, due: NOW + 30 * DAY_MS })),
      progress: [
        ...byGrade(2)
          .slice(0, 4)
          .map((e) => cardFor(e, { state: 'learning', step: 0, due: NOW + 60_000 })),
        ...byGrade(3)
          .slice(0, 4)
          .map((e) => cardFor(e, { state: 'review', interval: 5, due: NOW + 3 * DAY_MS })),
      ],
      new: byGrade(4)
        .slice(0, 8)
        .map((e) => cardFor(e)),
    }
  }

  const ALL_GRADES = [1, 2, 3, 4, 5, 6]

  it('merges the selected sources', () => {
    const pools = makePools()
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known', 'progress'],
      grades: ALL_GRADES,
      count: 100,
    }
    expect(selectQuizTargets(config, pools, { now: NOW }, mulberry32(1))).toHaveLength(13)
  })

  it('applies the grade filter to every source group', () => {
    const pools = makePools()
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known', 'progress', 'new'],
      grades: [2],
      count: 100,
    }
    const targets = selectQuizTargets(config, pools, { now: NOW }, mulberry32(3))
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) expect(target.grade).toBe(2)
  })

  it('appends extraNew on top of count, without duplicates and even when new is not a source', () => {
    const pools = makePools()
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known'],
      grades: ALL_GRADES,
      count: 3,
      extraNew: 4,
    }
    const targets = selectQuizTargets(config, pools, { now: NOW }, mulberry32(5))
    expect(targets).toHaveLength(7)
    expect(new Set(targets.map((t) => t.kanji)).size).toBe(7)
    const newKanji = new Set(pools.new.map((c) => bareId(c.id)))
    for (const target of targets.slice(3)) expect(newKanji.has(target.kanji)).toBe(true)
  })

  it('extraNew respects the grade filter (extras can make up the whole set)', () => {
    const pools = makePools()
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known'],
      grades: [4],
      count: 2,
      extraNew: 3,
    }
    const targets = selectQuizTargets(config, pools, { now: NOW }, mulberry32(6))
    expect(targets).toHaveLength(3)
    for (const target of targets) expect(target.grade).toBe(4)
  })

  it('dueOnly keeps cards due by the end of today, inclusive of the boundary', () => {
    const pools = makePools()
    const d = new Date(NOW)
    d.setHours(0, 0, 0, 0)
    const endOfToday = d.getTime() + DAY_MS
    pools.known[0].due = endOfToday
    pools.known[1].due = endOfToday + 1
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known'],
      grades: ALL_GRADES,
      count: 100,
      dueOnly: true,
    }
    const targets = selectQuizTargets(config, pools, { now: NOW }, mulberry32(2))
    expect(targets.map((t) => t.kanji)).toEqual([bareId(pools.known[0].id)])
  })

  it('problematicOnly keeps only lapsed or low-ease cards', () => {
    const pools = makePools()
    pools.known[0].lapses = 1
    pools.known[1].ease = STARTING_EASE - 10
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known'],
      grades: ALL_GRADES,
      count: 100,
      problematicOnly: true,
    }
    const targets = selectQuizTargets(config, pools, { now: NOW }, mulberry32(4))
    expect(targets.map((t) => t.kanji).sort()).toEqual(
      [bareId(pools.known[0].id), bareId(pools.known[1].id)].sort(),
    )
  })

  it('applies the predicate before sampling', () => {
    const pools = makePools()
    const config: QuizConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      sources: ['known', 'progress', 'new'],
      grades: ALL_GRADES,
      count: 6,
    }
    // Only the 5 known grade-1 cards survive the predicate, so count=6 clamps to 5.
    const targets = selectQuizTargets(
      config,
      pools,
      { now: NOW, predicate: (e) => e.grade === 1 },
      mulberry32(8),
    )
    expect(targets).toHaveLength(5)
    for (const target of targets) expect(target.grade).toBe(1)
  })
})

describe('buildQuiz mixed + cloze', () => {
  it('mixed assigns each question a mode available for its entry', () => {
    const quiz = buildQuiz('mixed', POOL, KANJI_DATA, mulberry32(13))
    for (const q of quiz) {
      const entry = entryFor(q)
      const available = isClozeEligible(entry)
        ? ['reading', 'meaning', 'reverse', 'cloze']
        : ['reading', 'meaning', 'reverse']
      expect(available).toContain(q.mode)
    }
  })

  it('mixed eventually uses every mode available for an eligible entry', () => {
    const entry = POOL[0]
    const seen = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) {
      const [q] = buildQuiz('mixed', [entry], KANJI_DATA, mulberry32(seed))
      seen.add(q.mode)
    }
    expect([...seen].sort()).toEqual(['cloze', 'meaning', 'reading', 'reverse'])
  })

  it('cloze hides the kanji in the first matching sentence with exactly one correct option', () => {
    const quiz = buildQuiz('cloze', POOL, KANJI_DATA, mulberry32(21))
    for (const q of quiz) {
      const entry = entryFor(q)
      const sentence = entry.sentences.find((s) => s.jp.includes(entry.kanji))!
      expect(q.mode).toBe('cloze')
      expect(q.prompt).toContain('◯')
      expect(q.prompt).toBe(sentence.jp.replace(entry.kanji, '◯'))
      expect(q.sentenceJp).toBe(sentence.jp)
      expect(q.sentenceEn).toBe(sentence.en)
      expect(q.correct).toBe(entry.kanji)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options.filter((option) => option === q.correct)).toHaveLength(1)
      for (const option of q.options) {
        if (option === q.correct) continue
        const other = KANJI_DATA.find((e) => e.kanji === option)!
        expect([...other.on, ...other.kun]).not.toContain(primaryReading(entry))
      }
    }
  })

  it('every question carries the grade of its kanji', () => {
    for (const mode of ['reading', 'mixed', 'cloze'] as const) {
      const quiz = buildQuiz(mode, POOL, KANJI_DATA, mulberry32(31))
      for (const q of quiz) expect(q.grade).toBe(entryFor(q).grade)
    }
  })
})