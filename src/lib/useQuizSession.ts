import { useCallback, useEffect, useMemo, useState } from 'react'
import { getKnownPool } from './db'
import { getKanji, KANJI_DATA, type KanjiEntry } from './kanji'
import { buildQuiz, type QuizMode, type QuizQuestion } from './quiz'

export type QuizStatus = 'loading' | 'setup' | 'ready' | 'done' | 'empty'

export interface QuizAnswer {
  question: QuizQuestion
  selected: string | null
  correct: boolean
}

export interface QuizSession {
  status: QuizStatus
  mode: QuizMode | null
  poolCount: number
  questions: QuizQuestion[]
  current: QuizQuestion | null
  total: number
  answered: number
  correctCount: number
  answers: QuizAnswer[]
  selection: string | null
  select: (option: string) => void
  next: () => void
  start: (mode: QuizMode) => void
  restart: () => void
}

/**
 * State for a single, isolated quiz run. The known-kanji pool is snapshotted
 * once when the hook mounts; answering never writes to the DB, so the quiz
 * cannot change SRS state or logs.
 */
export function useQuizSession(): QuizSession {
  const [status, setStatus] = useState<QuizStatus>('loading')
  const [mode, setMode] = useState<QuizMode | null>(null)
  const [poolCount, setPoolCount] = useState(0)
  const [poolEntries, setPoolEntries] = useState<KanjiEntry[]>([])
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [selection, setSelection] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getKnownPool().then((pool) => {
      if (cancelled) return
      setPoolCount(pool.kanji.length)
      setPoolEntries(pool.kanji.map((k) => getKanji(k)))
      setStatus(pool.kanji.length === 0 ? 'empty' : 'setup')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const buildQuestions = useCallback(
    (nextMode: QuizMode): QuizQuestion[] => buildQuiz(nextMode, poolEntries, KANJI_DATA),
    [poolEntries],
  )

  const start = useCallback(
    (nextMode: QuizMode) => {
      setMode(nextMode)
      setQuestions(buildQuestions(nextMode))
      setCurrentIndex(0)
      setAnswers([])
      setSelection(null)
      setStatus('ready')
    },
    [buildQuestions],
  )

  const restart = useCallback(() => {
    if (!mode) return
    start(mode)
  }, [mode, start])

  const select = useCallback(
    (option: string) => {
      if (selection !== null) return
      const question = questions[currentIndex]
      if (!question) return
      setSelection(option)
      setAnswers((prev) => [
        ...prev,
        { question, selected: option, correct: option === question.correct },
      ])
    },
    [selection, questions, currentIndex],
  )

  const next = useCallback(() => {
    if (selection === null) return
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((index) => index + 1)
      setSelection(null)
    } else {
      setStatus('done')
    }
  }, [selection, currentIndex, questions.length])

  const correctCount = useMemo(
    () => answers.reduce((sum, answer) => sum + (answer.correct ? 1 : 0), 0),
    [answers],
  )

  return {
    status,
    mode,
    poolCount,
    questions,
    current: questions[currentIndex] ?? null,
    total: questions.length,
    answered: answers.length,
    correctCount,
    answers,
    selection,
    select,
    next,
    start,
    restart,
  }
}