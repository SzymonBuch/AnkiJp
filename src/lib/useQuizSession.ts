import { useCallback, useEffect, useMemo, useState } from 'react'
import { getQuizPools, getSettings, setSettings, type QuizPools } from './db'
import { getKanji, KANJI_DATA } from './kanji'
import {
  buildQuiz,
  DEFAULT_QUIZ_CONFIG,
  isClozeEligible,
  passesFilters,
  selectQuizTargets,
  type QuizConfig,
  type QuizMode,
  type QuizQuestion,
} from './quiz'
import type { SrsCard } from './srs'

export type QuizStatus = 'loading' | 'setup' | 'ready' | 'done' | 'empty'

export interface QuizAnswer {
  question: QuizQuestion
  selected: string | null
  correct: boolean
}

export interface QuizSourceCounts {
  known: number
  progress: number
  new: number
}

export interface QuizSession {
  status: QuizStatus
  mode: QuizMode | null
  config: QuizConfig
  /** Live per-source counters under the current filters. */
  counts: QuizSourceCounts
  /** Max questions available from the selected sources under the current filters. */
  maxCount: number
  /** New kanji available for `extraNew` after the grade filter. */
  maxExtraNew: number
  /** Targets that could be asked in cloze mode (0 disables the mode button). */
  clozeEligibleCount: number
  canStart: boolean
  updateConfig: (patch: Partial<QuizConfig>) => void
  questions: QuizQuestion[]
  current: QuizQuestion | null
  currentIndex: number
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

const EMPTY_POOLS: QuizPools = { known: [], progress: [], new: [] }

/**
 * State for a single, isolated quiz run. The card pools and the quiz config
 * are snapshotted once when the hook mounts; answering never writes to the
 * cards or logs, so the quiz cannot change SRS state.
 */
export function useQuizSession(): QuizSession {
  const [status, setStatus] = useState<QuizStatus>('loading')
  const [mode, setMode] = useState<QuizMode | null>(null)
  const [pools, setPools] = useState<QuizPools>(EMPTY_POOLS)
  const [config, setConfig] = useState<QuizConfig>(DEFAULT_QUIZ_CONFIG)
  /** When the pools were snapshotted; all filters/sampling use this instant. */
  const [snapshotAt, setSnapshotAt] = useState(0)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [selection, setSelection] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getQuizPools(), getSettings()]).then(([loadedPools, settings]) => {
      if (cancelled) return
      setPools(loadedPools)
      setConfig(clampConfig(settings.quiz, loadedPools, Date.now()))
      setSnapshotAt(Date.now())
      const isEmpty =
        loadedPools.known.length === 0 &&
        loadedPools.progress.length === 0 &&
        loadedPools.new.length === 0
      setStatus(isEmpty ? 'empty' : 'setup')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo<QuizSourceCounts>(() => {
    const grades = new Set(config.grades)
    const matches = (cards: SrsCard[]) =>
      cards.filter((c) => passesFilters(c, config, snapshotAt) && grades.has(getKanji(c.kanji).grade))
        .length
    return { known: matches(pools.known), progress: matches(pools.progress), new: matches(pools.new) }
  }, [pools, config, snapshotAt])

  const maxCount = config.sources.reduce((sum, source) => sum + counts[source], 0)

  const maxExtraNew = useMemo(
    () => pools.new.filter((c) => new Set(config.grades).has(getKanji(c.kanji).grade)).length,
    [pools, config],
  )

  const clozeEligibleCount = useMemo(() => {
    const grades = new Set(config.grades)
    const seen = new Set<string>()
    let eligible = 0
    const consider = (cards: SrsCard[], applyFilters: boolean) => {
      for (const card of cards) {
        if (seen.has(card.kanji)) continue
        seen.add(card.kanji)
        const entry = getKanji(card.kanji)
        if (!grades.has(entry.grade)) continue
        if (applyFilters && !passesFilters(card, config, snapshotAt)) continue
        if (isClozeEligible(entry)) eligible++
      }
    }
    for (const source of config.sources) consider(pools[source], true)
    consider(pools.new, false)
    return eligible
  }, [pools, config, snapshotAt])

  const canStart = maxCount > 0 || (config.extraNew > 0 && maxExtraNew > 0)

  const updateConfig = useCallback(
    (patch: Partial<QuizConfig>) => {
      const next = clampConfig({ ...config, ...patch }, pools, snapshotAt)
      setConfig(next)
      void setSettings({ quiz: next }).catch(() => undefined)
    },
    [config, pools, snapshotAt],
  )

  const start = useCallback(
    (nextMode: QuizMode) => {
      const targets = selectQuizTargets(config, pools, {
        now: snapshotAt,
        predicate: nextMode === 'cloze' ? isClozeEligible : undefined,
      })
      if (targets.length === 0) return
      setMode(nextMode)
      setQuestions(buildQuiz(nextMode, targets, KANJI_DATA))
      setCurrentIndex(0)
      setAnswers([])
      setSelection(null)
      setStatus('ready')
    },
    [config, pools, snapshotAt],
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
    config,
    counts,
    maxCount,
    maxExtraNew,
    clozeEligibleCount,
    canStart,
    updateConfig,
    questions,
    current: questions[currentIndex] ?? null,
    currentIndex,
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

/** Clamp `count`/`extraNew` to what the snapshot actually offers right now. */
function clampConfig(config: QuizConfig, pools: QuizPools, now: number): QuizConfig {
  const grades = new Set(config.grades)
  const inGrades = (card: SrsCard) => grades.has(getKanji(card.kanji).grade)
  const poolSize = config.sources.reduce(
    (sum, source) =>
      sum + pools[source].filter((c) => passesFilters(c, config, now) && inGrades(c)).length,
    0,
  )
  const newAvailable = pools.new.filter(inGrades).length
  return {
    ...config,
    count: Math.min(Math.max(config.count, 1), Math.max(poolSize, 1)),
    extraNew: Math.min(config.extraNew, newAvailable),
  }
}
