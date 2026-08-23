import { useCallback, useEffect, useMemo, useState } from 'react'
import { getQuizPools, getSettings, setSettings, type QuizPools } from './db'
import { getKanji, KANJI_DATA } from './kanji'
import { RADICALS_DATA } from './radicals'
import {
  buildQuiz,
  buildRadicalQuiz,
  DEFAULT_QUIZ_CONFIG,
  isClozeEligible,
  passesFilters,
  selectQuizTargets,
  selectRadicalTargets,
  type QuizConfig,
  type QuizMode,
  type QuizQuestion,
} from './quiz'
import { bareId, type ContentType, type SrsCard } from './srs'

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
  type: ContentType
  status: QuizStatus
  mode: QuizMode | null
  config: QuizConfig
  /** Live per-source counters under the current filters. */
  counts: QuizSourceCounts
  /** Max questions available from the selected sources under the current filters. */
  maxCount: number
  /** New kanji available for `extraNew` after the grade filter (kanji only). */
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
 * State for a single, isolated quiz run over one content type. The card pools
 * and the quiz config are snapshotted once when the hook mounts; answering
 * never writes to the cards or logs, so the quiz cannot change SRS state.
 * Radicals quiz in meaning mode only; grades/cloze/extra-new are kanji-only.
 */
export function useQuizSession(type: ContentType = 'kanji'): QuizSession {
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
    Promise.all([getQuizPools(type), getSettings()]).then(([loadedPools, settings]) => {
      if (cancelled) return
      setPools(loadedPools)
      setConfig(clampConfig(settings.quiz, loadedPools, Date.now(), type))
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
  }, [type])

  const counts = useMemo<QuizSourceCounts>(() => {
    const matches = (cards: SrsCard[]) => cards.filter((c) => passesFilters(c, config, snapshotAt)).length
    if (type !== 'kanji') {
      return { known: matches(pools.known), progress: matches(pools.progress), new: matches(pools.new) }
    }
    const grades = new Set(config.grades)
    const withGrades = (cards: SrsCard[]) =>
      cards.filter((c) => passesFilters(c, config, snapshotAt) && grades.has(getKanji(bareId(c.id)).grade)).length
    return {
      known: withGrades(pools.known),
      progress: withGrades(pools.progress),
      new: withGrades(pools.new),
    }
  }, [pools, config, snapshotAt, type])

  const maxCount = config.sources.reduce((sum, source) => sum + counts[source], 0)

  const maxExtraNew = useMemo(() => {
    if (type !== 'kanji') return 0
    const grades = new Set(config.grades)
    return pools.new.filter((c) => grades.has(getKanji(bareId(c.id)).grade)).length
  }, [pools, config, type])

  const clozeEligibleCount = useMemo(() => {
    if (type !== 'kanji') return 0
    const grades = new Set(config.grades)
    const seen = new Set<string>()
    let eligible = 0
    const consider = (cards: SrsCard[], applyFilters: boolean) => {
      for (const card of cards) {
        if (seen.has(card.id)) continue
        seen.add(card.id)
        const entry = getKanji(bareId(card.id))
        if (!grades.has(entry.grade)) continue
        if (applyFilters && !passesFilters(card, config, snapshotAt)) continue
        if (isClozeEligible(entry)) eligible++
      }
    }
    for (const source of config.sources) consider(pools[source], true)
    consider(pools.new, false)
    return eligible
  }, [pools, config, snapshotAt, type])

  const canStart = maxCount > 0 || (config.extraNew > 0 && maxExtraNew > 0)

  const updateConfig = useCallback(
    (patch: Partial<QuizConfig>) => {
      const next = clampConfig({ ...config, ...patch }, pools, snapshotAt, type)
      setConfig(next)
      void setSettings({ quiz: next }).catch(() => undefined)
    },
    [config, pools, snapshotAt, type],
  )

  const start = useCallback(
    (nextMode: QuizMode) => {
      if (type === 'radical') {
        const targets = selectRadicalTargets(config, pools, snapshotAt)
        if (targets.length === 0) return
        setMode(nextMode)
        setQuestions(buildRadicalQuiz(targets, RADICALS_DATA))
      } else {
        const targets = selectQuizTargets(config, pools, {
          now: snapshotAt,
          predicate: nextMode === 'cloze' ? isClozeEligible : undefined,
        })
        if (targets.length === 0) return
        setMode(nextMode)
        setQuestions(buildQuiz(nextMode, targets, KANJI_DATA))
      }
      setCurrentIndex(0)
      setAnswers([])
      setSelection(null)
      setStatus('ready')
    },
    [config, pools, snapshotAt, type],
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
    type,
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
function clampConfig(config: QuizConfig, pools: QuizPools, now: number, type: ContentType): QuizConfig {
  const gradeFilter = (card: SrsCard) => {
    if (type !== 'kanji') return true
    return new Set(config.grades).has(getKanji(bareId(card.id)).grade)
  }
  const poolSize = config.sources.reduce(
    (sum, source) =>
      sum + pools[source].filter((c) => passesFilters(c, config, now) && gradeFilter(c)).length,
    0,
  )
  const newAvailable = pools.new.filter(gradeFilter).length
  return {
    ...config,
    count: Math.min(Math.max(config.count, 1), Math.max(poolSize, 1)),
    extraNew: Math.min(config.extraNew, newAvailable),
  }
}
