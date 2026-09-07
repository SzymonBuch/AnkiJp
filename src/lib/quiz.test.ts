import { describe, expect, it } from 'vitest'
import { KANJI_DATA, type KanjiEntry } from './kanji'
import { RADICALS_DATA, type RadicalEntry } from './radicals'
import { VOCAB_DATA, type VocabEntry } from './vocab'
import {
  buildMixedQuiz,
  buildQuiz,
  buildRadicalQuiz,
  buildVocabQuiz,
  DEFAULT_QUIZ_CONFIG,
  isClozeEligible,
  primaryReading,
  sampleKanji,
  selectMixedTargets,
  selectQuizTargets,
  selectRadicalTargets,
  selectVocabTargets,
  type KanjiQuestion,
  type QuizConfig,
  type VocabQuestion,
} from './quiz'
import { bareId, cardId, createCard, DAY_MS, STARTING_EASE, typeOf, type ContentType, type SrsCard } from './srs'
import type { QuizPools } from './db'

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

function entryFor(question: KanjiQuestion) {
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

describe('buildRadicalQuiz (Etap 2: glyph → keyword, distractors from the full pool)', () => {
  const POOL_R = RADICALS_DATA.slice(0, 6)

  it('builds one meaning question per target with the glyph as prompt', () => {
    const quiz = buildRadicalQuiz(POOL_R, RADICALS_DATA, mulberry32(7))
    expect(quiz).toHaveLength(POOL_R.length)
    for (let i = 0; i < quiz.length; i++) {
      const q = quiz[i]
      expect(q.kind).toBe('radical')
      expect(q.mode).toBe('meaning')
      expect(q.index).toBe(i)
      expect(q.prompt).toBe(POOL_R[i].glyph)
      expect(q.glyph).toBe(POOL_R[i].glyph)
      expect(q.keyword).toBe(POOL_R[i].keyword)
      expect(q.correct).toBe(POOL_R[i].keyword)
    }
  })

  it('has exactly one correct option and no duplicate options', () => {
    const quiz = buildRadicalQuiz(POOL_R, RADICALS_DATA, mulberry32(3))
    for (const q of quiz) {
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options.filter((option) => option === q.correct)).toHaveLength(1)
    }
  })

  it('never offers the target keyword as a distractor and draws the rest from radicals', () => {
    const [target] = RADICALS_DATA.slice(40, 41)
    const [q] = buildRadicalQuiz([target], RADICALS_DATA, mulberry32(5))
    const poolKeywords = new Set(RADICALS_DATA.map((r) => r.keyword))
    for (const option of q.options) {
      if (option === q.correct) continue
      expect(poolKeywords.has(option)).toBe(true)
      expect(option).not.toBe(target.keyword)
    }
  })

  it('is deterministic for a given rng sequence', () => {
    expect(buildRadicalQuiz(POOL_R, RADICALS_DATA, mulberry32(11))).toEqual(
      buildRadicalQuiz(POOL_R, RADICALS_DATA, mulberry32(11)),
    )
  })
})

describe('selectRadicalTargets', () => {
  const NOW = new Date('2026-08-20T12:00:00Z').getTime()

  function radicalCard(glyph: string, over: Partial<SrsCard> = {}): SrsCard {
    return { ...createCard(cardId('radical', glyph), RADICALS_DATA.findIndex((r) => r.glyph === glyph), NOW), ...over }
  }

  function makePools() {
    const glyphs = RADICALS_DATA.map((r) => r.glyph)
    return {
      known: glyphs.slice(0, 5).map((g) => radicalCard(g, { state: 'review', interval: 30, due: NOW + 30 * DAY_MS })),
      progress: glyphs.slice(5, 9).map((g) => radicalCard(g, { state: 'learning', step: 0, due: NOW + 60_000 })),
      new: glyphs.slice(9, 14).map((g) => radicalCard(g)),
    }
  }

  function targetsOf(pools: ReturnType<typeof makePools>, sources: QuizConfig['sources'], count: number): RadicalEntry[] {
    return selectRadicalTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources, count },
      pools,
      NOW,
      mulberry32(2),
    )
  }

  it('merges the selected sources without duplicates', () => {
    const targets = targetsOf(makePools(), ['known', 'progress'], 100)
    expect(targets).toHaveLength(9)
    expect(new Set(targets.map((t) => t.glyph)).size).toBe(9)
  })

  it('respects dueOnly and problematicOnly through the shared card filters', () => {
    const pools = makePools()
    const config: QuizConfig = { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], count: 100, dueOnly: true }
    expect(selectRadicalTargets(config, pools, NOW, mulberry32(1))).toHaveLength(0)

    pools.known[0].lapses = 1
    const problematic = selectRadicalTargets(
      { ...config, dueOnly: false, problematicOnly: true },
      pools,
      NOW,
      mulberry32(1),
    )
    expect(problematic.map((t) => t.glyph)).toEqual([bareId(pools.known[0].id)])
  })

  it('returns RadicalEntry objects whose ids are radical namespaced cards', () => {
    const pools = makePools()
    const targets = targetsOf(pools, ['new'], 3)
    expect(targets).toHaveLength(3)
    for (const target of targets) {
      expect(typeOf(cardId('radical', target.glyph))).toBe('radical')
    }
  })
})

describe('selectQuizTargets grade-0 extension (Etap 3 deck, Etap 4 quiz option)', () => {
  const NOW = new Date('2026-08-20T12:00:00Z').getTime()
  const GRADE0 = KANJI_DATA.filter((e) => e.grade === 0)

  function makePools() {
    return {
      known: GRADE0.slice(0, 4).map((e) => ({
        ...createCard(cardId('kanji', e.kanji), KANJI_DATA.indexOf(e), NOW),
        state: 'review' as const,
        interval: 30,
        due: NOW + 30 * DAY_MS,
      })),
      progress: [],
      new: [],
    }
  }

  it('excludes grade-0 kanji from the default grades [1–6] filter', () => {
    const targets = selectQuizTargets(
      { ...DEFAULT_QUIZ_CONFIG, count: 100 },
      makePools(),
      { now: NOW },
      mulberry32(1),
    )
    expect(targets).toEqual([])
  })

  it('quizzes grade-0 kanji once the option is enabled', () => {
    const targets = selectQuizTargets(
      { ...DEFAULT_QUIZ_CONFIG, grades: [0], count: 100 },
      makePools(),
      { now: NOW },
      mulberry32(2),
    )
    expect(targets.map((t) => t.kanji).sort()).toEqual(GRADE0.slice(0, 4).map((e) => e.kanji).sort())
    for (const target of targets) expect(target.grade).toBe(0)
  })
})

describe('buildVocabQuiz (Etap 4)', () => {
  /** Mid-frequency words: distinct glosses and a deep distractor pool. */
  const VPOOL = VOCAB_DATA.slice(120, 126)

  function entryFor(question: VocabQuestion): VocabEntry {
    return VOCAB_DATA.find((e) => e.id === question.vocabId)!
  }

  const glossesOf = (e: VocabEntry): Set<string> => new Set([e.meaning, ...e.meanings])

  /** Entries allowed as distractor sources: no gloss shared with the target (#14). */
  function eligible(target: VocabEntry): VocabEntry[] {
    const targetGlosses = glossesOf(target)
    return VOCAB_DATA.filter(
      (e) =>
        e.id !== target.id &&
        ![e.meaning, ...e.meanings].some((gloss) => targetGlosses.has(gloss)),
    )
  }

  function shapeScore(target: VocabEntry, entry: VocabEntry): number {
    return (
      Math.abs([...entry.id].length - [...target.id].length) +
      Math.abs(entry.kanji.length - target.kanji.length)
    )
  }

  it('meaning mode: prompt is the word with furigana available, correct is the display meaning', () => {
    const quiz = buildVocabQuiz('meaning', VPOOL, VOCAB_DATA, mulberry32(1))
    expect(quiz).toHaveLength(VPOOL.length)
    for (const q of quiz) {
      const entry = entryFor(q)
      expect(q.kind).toBe('vocab')
      expect(q.prompt).toBe(entry.id)
      expect(q.furiganaHtml).toBe(entry.furiganaHtml)
      expect(q.hideFurigana).toBeUndefined()
      expect(q.correct).toBe(entry.meaning)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options.filter((o) => o === q.correct)).toHaveLength(1)
    }
  })

  it('reading mode: prompt hides furigana and contains no <ruby>', () => {
    const quiz = buildVocabQuiz('reading', VPOOL, VOCAB_DATA, mulberry32(2))
    for (const q of quiz) {
      const entry = entryFor(q)
      expect(q.mode).toBe('reading')
      // The furigana would spell out the answer — it must be hidden entirely.
      expect(q.hideFurigana).toBe(true)
      // No furigana data rides along with a reading prompt at all.
      expect(q.furiganaHtml).toBeUndefined()
      expect(q.prompt).not.toContain('<ruby>')
      expect(q.correct).toBe(entry.reading)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      for (const option of q.options) {
        if (option !== q.correct) {
          expect(option).not.toBe(entry.reading)
          expect(VOCAB_DATA.some((e) => e.reading === option)).toBe(true)
        }
      }
    }
  })

  it('reverse mode: prompt is the meaning, correct is the word form', () => {
    const quiz = buildVocabQuiz('reverse', VPOOL, VOCAB_DATA, mulberry32(3))
    for (const q of quiz) {
      const entry = entryFor(q)
      expect(q.prompt).toBe(entry.meaning)
      expect(q.correct).toBe(entry.id)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      for (const option of q.options) {
        if (option === q.correct) continue
        const other = VOCAB_DATA.find((e) => e.id === option)!
        const shared = [...glossesOf(other)].some((gloss) => glossesOf(entry).has(gloss))
        expect(shared).toBe(false)
      }
    }
  })

  it('distractors share no gloss with the target in any mode (#14, all glosses both ways)', () => {
    for (const mode of ['meaning', 'reading', 'reverse'] as const) {
      const quiz = buildVocabQuiz(mode, VPOOL, VOCAB_DATA, mulberry32(4))
      for (const q of quiz) {
        const entry = entryFor(q)
        const pick = mode === 'meaning' ? (e: VocabEntry) => e.meaning : mode === 'reading' ? (e: VocabEntry) => e.reading : (e: VocabEntry) => e.id
        const legalStrings = new Set(eligible(entry).map(pick))
        for (const option of q.options) {
          if (option !== q.correct) expect(legalStrings.has(option)).toBe(true)
        }
      }
    }
  })

  it('draws distractors from the nearest-shape slice of the pool', () => {
    const [target] = VPOOL
    const [q] = buildVocabQuiz('reverse', [target], VOCAB_DATA, mulberry32(5))
    const ranked = eligible(target)
      .map((entry) => shapeScore(target, entry))
      .sort((a, b) => a - b)
    const cutoff = ranked[Math.min(23, ranked.length - 1)]
    for (const option of q.options) {
      if (option === q.correct) continue
      const other = VOCAB_DATA.find((e) => e.id === option)!
      expect(shapeScore(target, other)).toBeLessThanOrEqual(cutoff)
    }
  })

  it('mixed resolves only to meaning/reading/reverse and eventually uses all three', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const quiz = buildVocabQuiz('mixed', VPOOL, VOCAB_DATA, mulberry32(seed))
      for (const q of quiz) {
        expect(['meaning', 'reading', 'reverse']).toContain(q.mode)
      }
    }
    const seen = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) {
      const [q] = buildVocabQuiz('mixed', VPOOL.slice(0, 1), VOCAB_DATA, mulberry32(seed))
      seen.add(q.mode)
    }
    expect([...seen].sort()).toEqual(['meaning', 'reading', 'reverse'])
  })

  it('rejects cloze explicitly — sentences are not quizzed for vocab yet', () => {
    expect(() => buildVocabQuiz('cloze', VPOOL, VOCAB_DATA, mulberry32(6))).toThrow(/cloze/i)
  })

  it('is deterministic for a given rng sequence', () => {
    expect(buildVocabQuiz('mixed', VPOOL, VOCAB_DATA, mulberry32(7))).toEqual(
      buildVocabQuiz('mixed', VPOOL, VOCAB_DATA, mulberry32(7)),
    )
  })
})

describe('selectVocabTargets', () => {
  const NOW = new Date('2026-08-20T12:00:00Z').getTime()

  function vocabCard(word: VocabEntry, over: Partial<SrsCard> = {}): SrsCard {
    return { ...createCard(`w:${word.id}`, VOCAB_DATA.indexOf(word), NOW), ...over }
  }

  function makePools() {
    const words = VOCAB_DATA.slice(200)
    return {
      known: words.slice(0, 5).map((w) => vocabCard(w, { state: 'review', interval: 30, due: NOW + 30 * DAY_MS })),
      progress: words.slice(5, 9).map((w) => vocabCard(w, { state: 'learning', step: 0, due: NOW + 60_000 })),
      new: words.slice(9, 14).map((w) => vocabCard(w)),
    }
  }

  it('merges the selected sources without duplicates', () => {
    const pools = makePools()
    const targets = selectVocabTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known', 'progress'], count: 100 },
      pools,
      NOW,
      mulberry32(1),
    )
    expect(targets).toHaveLength(9)
    expect(new Set(targets.map((t) => t.id)).size).toBe(9)
  })

  it('respects dueOnly and problematicOnly through the shared card filters', () => {
    const pools = makePools()
    const config: QuizConfig = { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], count: 100, dueOnly: true }
    expect(selectVocabTargets(config, pools, NOW, mulberry32(2))).toHaveLength(0)

    pools.known[0].lapses = 1
    const problematic = selectVocabTargets(
      { ...config, dueOnly: false, problematicOnly: true },
      pools,
      NOW,
      mulberry32(3),
    )
    expect(problematic.map((t) => t.id)).toEqual([bareId(pools.known[0].id)])
  })

  it('samples at most `count` targets', () => {
    const pools = makePools()
    const targets = selectVocabTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known', 'progress', 'new'], count: 4 },
      pools,
      NOW,
      mulberry32(4),
    )
    expect(targets).toHaveLength(4)
  })
})

describe('mixed scope: selectMixedTargets + buildMixedQuiz (Etap 5)', () => {
  const NOW = new Date('2026-08-20T12:00:00Z').getTime()
  const R = RADICALS_DATA.slice(0, 3)
  const K = KANJI_DATA.filter((e) => e.grade === 1).slice(0, 3)
  const K0 = KANJI_DATA.filter((e) => e.grade === 0).slice(0, 1)
  const W = VOCAB_DATA.slice(200, 203)

  function reviewCard(id: string, pos: number): SrsCard {
    return { ...createCard(id, pos, NOW), state: 'review', interval: 30, due: NOW + 30 * DAY_MS }
  }

  function poolsFor(cards: SrsCard[]): QuizPools {
    return { known: cards, progress: [], new: [] }
  }

  function makePoolsByType(withGrade0 = false): Record<ContentType, QuizPools> {
    return {
      radical: poolsFor(R.map((r) => reviewCard(cardId('radical', r.glyph), RADICALS_DATA.indexOf(r)))),
      kanji: poolsFor(
        [...K, ...(withGrade0 ? K0 : [])].map((e) =>
          reviewCard(cardId('kanji', e.kanji), KANJI_DATA.indexOf(e)),
        ),
      ),
      vocab: poolsFor(W.map((w) => reviewCard(`w:${w.id}`, VOCAB_DATA.indexOf(w)))),
    }
  }

  it('samples targets from all three content types at once', () => {
    const targets = selectMixedTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], count: 100 },
      makePoolsByType(),
      NOW,
      mulberry32(1),
    )
    expect(targets.radical.map((r) => r.glyph).sort()).toEqual(R.map((r) => r.glyph).sort())
    expect(targets.kanji.map((k) => k.kanji).sort()).toEqual(K.map((k) => k.kanji).sort())
    expect(targets.vocab.map((w) => w.id).sort()).toEqual(W.map((w) => w.id).sort())
  })

  it('grade filter narrows only the kanji portion — radicals and words never drop (#Etap5)', () => {
    const pools = makePoolsByType(true)
    const defaultRun = selectMixedTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], count: 100 },
      pools,
      NOW,
      mulberry32(2),
    )
    // Default grades [1–6]: the grade-0 kanji is out, everything else stays.
    expect(defaultRun.kanji).toHaveLength(K.length)
    for (const entry of defaultRun.kanji) expect(entry.grade).toBeGreaterThan(0)
    expect(defaultRun.radical).toHaveLength(R.length)
    expect(defaultRun.vocab).toHaveLength(W.length)

    const g0Only = selectMixedTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], grades: [0], count: 100 },
      pools,
      NOW,
      mulberry32(3),
    )
    expect(g0Only.kanji.map((k) => ({ kanji: k.kanji, grade: k.grade }))).toEqual(
      K0.map((e) => ({ kanji: e.kanji, grade: 0 })),
    )
    expect(g0Only.radical).toHaveLength(R.length)
    expect(g0Only.vocab).toHaveLength(W.length)
  })

  it('dueOnly applies across all types; problematicOnly picks exactly the lapsing cards', () => {
    const pools = makePoolsByType()
    const dueOnly = selectMixedTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], count: 100, dueOnly: true },
      pools,
      NOW,
      mulberry32(4),
    )
    // Every seeded card is due in 30 days — nothing qualifies in any type.
    expect(dueOnly.radical).toEqual([])
    expect(dueOnly.kanji).toEqual([])
    expect(dueOnly.vocab).toEqual([])

    pools.radical.known[0].lapses = 1
    pools.kanji.known[0].lapses = 1
    pools.vocab.known[0].lapses = 1
    const problematic = selectMixedTargets(
      { ...DEFAULT_QUIZ_CONFIG, sources: ['known'], count: 100, problematicOnly: true },
      pools,
      NOW,
      mulberry32(5),
    )
    expect(problematic.radical.map((r) => r.glyph)).toEqual([R[0].glyph])
    expect(problematic.kanji.map((k) => k.kanji)).toEqual([K[0].kanji])
    expect(problematic.vocab.map((w) => w.id)).toEqual([W[0].id])
  })

  it('buildMixedQuiz: radicals fall back to meaning mode, vocab reading hides furigana, indices are contiguous', () => {
    const targets = { radical: [R[0]], kanji: [K[0]], vocab: [W[0]] }
    const all = { kanji: KANJI_DATA, radical: RADICALS_DATA, vocab: VOCAB_DATA }
    const quiz = buildMixedQuiz('reading', targets, all, mulberry32(6))

    expect(quiz).toHaveLength(3)
    expect(quiz.map((q) => q.index).sort((a, b) => a - b)).toEqual([0, 1, 2])

    const radicalQ = quiz.find((q) => q.kind === 'radical')!
    expect(radicalQ.mode).toBe('meaning')
    expect(radicalQ.correct).toBe(R[0].keyword)

    const kanjiQ = quiz.find((q) => q.kind === 'kanji')!
    expect(kanjiQ.mode).toBe('reading')
    expect(kanjiQ.correct).toBe(primaryReading(K[0]))

    const vocabQ = quiz.find((q) => q.kind === 'vocab')! as VocabQuestion
    expect(vocabQ.mode).toBe('reading')
    expect(vocabQ.hideFurigana).toBe(true)
    expect(vocabQ.furiganaHtml).toBeUndefined()
    expect(vocabQ.prompt).not.toContain('<ruby>')

    for (const q of quiz) {
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options.filter((option) => option === q.correct)).toHaveLength(1)
    }
  })

  it('buildMixedQuiz is deterministic for a given rng sequence', () => {
    const targets = { radical: R, kanji: K, vocab: W }
    const all = { kanji: KANJI_DATA, radical: RADICALS_DATA, vocab: VOCAB_DATA }
    expect(buildMixedQuiz('mixed', targets, all, mulberry32(8))).toEqual(
      buildMixedQuiz('mixed', targets, all, mulberry32(8)),
    )
  })
})