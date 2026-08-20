import { describe, expect, it } from 'vitest'
import { KANJI_DATA } from './kanji'
import { buildQuiz, primaryReading, type QuizQuestion } from './quiz'

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