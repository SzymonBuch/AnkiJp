import { useCallback, useEffect, useMemo, useState } from 'react'
import { getQuizPools, getSettings, setSettings, type QuizPools } from './db'
import { getKanji, KANJI_DATA } from './kanji'
import { RADICALS_DATA } from './radicals'
import { VOCAB_DATA } from './vocab'
import {
  buildMixedQuiz,
  buildQuiz,
  buildRadicalQuiz,
  buildVocabQuiz,
  DEFAULT_QUIZ_CONFIG,
  isClozeEligible,
  passesFilters,
  selectMixedTargets,
  selectQuizTargets,
  selectRadicalTargets,
  selectVocabTargets,
  type QuizConfig,
  type QuizMode,
  type QuizQuestion,
} from './quiz'
import { bareId, typeOf, type ContentType, type SrsCard } from './srs'
import type { SessionType } from './mixed'

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

const EMPTY_POOLS: QuizPools = { known: [], progress: [], new: [] }

function emptyPoolsByType(): Record<ContentType, QuizPools> {
  return { kanji: EMPTY_POOLS, radical: EMPTY_POOLS, vocab: EMPTY_POOLS }
}

export interface QuizSession {
  type: SessionType
  status: QuizStatus
  mode: QuizMode | null
  config: QuizConfig
  /** Live per-source counters under the current filters. */
  counts: QuizSourceCounts
  /** Max questions available from the selected sources under the current filters. */
  maxCount: number
  /** New kanji available for `extraNew` after the grade filter (kanji scope only). */
  maxExtraNew: number
  /** Targets that could be asked in cloze mode (0 disables the mode button). */
  clozeEligibleCount: number
  canStart: boolean
  updateConfig: (patch: Partial<QuizConfig>) => void
  changeScope: (scope: SessionType) => void
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

/**
 * State for a single, isolated quiz run. The card pools and the quiz config
 * are snapshotted once when the hook mounts; answering never writes to the
 * cards or logs, so the quiz cannot change SRS state.
 *
 * The pool is mixed across all content types by default (Etap 5); the setup
 * screen can narrow it to a single type at any time (`changeScope`). Grades/
 * cloze/extra-new stay kanji-specific; radicals quiz in meaning mode only.
 */
export function useQuizSession(initialScope: SessionType = 'mixed'): QuizSession {
  const [scope, setScope] = useState<SessionType>(initialScope)
  const [status, setStatus] = useState<QuizStatus>('loading')
  const [mode, setMode] = useState<QuizMode | null>(null)
  const [poolsByType, setPoolsByType] = useState<Record<ContentType, QuizPools>>(emptyPoolsByType)
  const [config, setConfig] = useState<QuizConfig>(DEFAULT_QUIZ_CONFIG)
  /** When the pools were snapshotted; all filters/sampling use this instant. */
  const [snapshotAt, setSnapshotAt] = useState(0)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [selection, setSelection] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getQuizPools('kanji'),
      getQuizPools('radical'),
      getQuizPools('vocab'),
      getSettings(),
    ]).then(([kanji, radical, vocab, settings]) => {
      if (cancelled) return
      const loaded = { kanji, radical, vocab }
      setPoolsByType(loaded)
      setSnapshotAt(Date.now())
      setConfig(clampConfig(settings.quiz, loaded, Date.now(), initialScope))
      const isEmpty = (Object.keys(loaded) as ContentType[]).every(
        (type) =>
          loaded[type].known.length === 0 &&
          loaded[type].progress.length === 0 &&
          loaded[type].new.length === 0,
      )
      setStatus(isEmpty ? 'empty' : 'setup')
    })
    return () => {
      cancelled = true
    }
    // Reruns only if the initial scope prop changes (it never does in place):
    // one snapshot serves every scope, so narrowing/broadening needs no reload.
  }, [initialScope])

  /** The pools the current scope draws from — all types merged when mixed. */
  const pools = useMemo<QuizPools>(() => {
    if (scope !== 'mixed') return poolsByType[scope]
    const merge = (key: keyof QuizPools) => [
      ...poolsByType.radical[key],
      ...poolsByType.kanji[key],
      ...poolsByType.vocab[key],
    ]
    return { known: merge('known'), progress: merge('progress'), new: merge('new') }
  }, [scope, poolsByType])

  const counts = useMemo<QuizSourceCounts>(() => {
    // The grade filter is meaningful only for kanji cards; a mixed pool keeps
    // radicals/words untouched by it.
    const grades = new Set(config.grades)
    const matches = (cards: SrsCard[]) =>
      cards.filter(
        (c) =>
          passesFilters(c, config, snapshotAt) &&
          (typeOf(c.id) !== 'kanji' || grades.has(getKanji(bareId(c.id)).grade)),
      ).length
    return {
      known: matches(pools.known),
      progress: matches(pools.progress),
      new: matches(pools.new),
    }
  }, [pools, config, snapshotAt])

  const maxCount = config.sources.reduce((sum, source) => sum + counts[source], 0)

  const maxExtraNew = useMemo(() => {
    if (scope !== 'kanji') return 0
    const grades = new Set(config.grades)
    return poolsByType.kanji.new.filter((c) => grades.has(getKanji(bareId(c.id)).grade)).length
  }, [poolsByType, config, scope])

  const clozeEligibleCount = useMemo(() => {
    if (scope !== 'kanji') return 0
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
    consider(poolsByType.kanji.new, false)
    return eligible
  }, [pools, poolsByType, config, snapshotAt, scope])

  const canStart = maxCount > 0 || (config.extraNew > 0 && maxExtraNew > 0)

  const updateConfig = useCallback(
    (patch: Partial<QuizConfig>) => {
      const next = clampConfig({ ...config, ...patch }, poolsByType, snapshotAt, scope)
      setConfig(next)
      void setSettings({ quiz: next }).catch(() => undefined)
    },
    [config, poolsByType, snapshotAt, scope],
  )

  const changeScope = useCallback(
    (next: SessionType) => {
      setScope(next)
      setConfig((prev) => clampConfig(prev, poolsByType, snapshotAt, next))
    },
    [poolsByType, snapshotAt],
  )

  const start = useCallback(
    (nextMode: QuizMode) => {
      let built: QuizQuestion[]
      if (scope === 'radical') {
        const targets = selectRadicalTargets(config, pools, snapshotAt)
        if (targets.length === 0) return
        built = buildRadicalQuiz(targets, RADICALS_DATA)
      } else if (scope === 'vocab') {
        const targets = selectVocabTargets(config, pools, snapshotAt)
        if (targets.length === 0) return
        built = buildVocabQuiz(nextMode, targets, VOCAB_DATA)
      } else if (scope === 'kanji') {
        const targets = selectQuizTargets(config, pools, {
          now: snapshotAt,
          predicate: nextMode === 'cloze' ? isClozeEligible : undefined,
        })
        if (targets.length === 0) return
        built = buildQuiz(nextMode, targets, KANJI_DATA)
      } else {
        // Mixed pool (Etap 5): cloze stays kanji-only, so it narrows to
        // per-type modes instead of running here.
        if (nextMode === 'cloze') return
        const grouped = selectMixedTargets(config, poolsByType, snapshotAt)
        const total =
          grouped.kanji.length + grouped.radical.length + grouped.vocab.length
        if (total === 0) return
        built = buildMixedQuiz(nextMode, grouped, {
          kanji: KANJI_DATA,
          radical: RADICALS_DATA,
          vocab: VOCAB_DATA,
        })
      }
      setMode(nextMode)
      setQuestions(built)
      setCurrentIndex(0)
      setAnswers([])
      setSelection(null)
      setStatus('ready')
    },
    [config, pools, poolsByType, scope, snapshotAt],
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
    type: scope,
    status,
    mode,
    config,
    counts,
    maxCount,
    maxExtraNew,
    clozeEligibleCount,
    canStart,
    updateConfig,
    changeScope,
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
function clampConfig(
  config: QuizConfig,
  poolsByType: Record<ContentType, QuizPools>,
  now: number,
  scope: SessionType,
): QuizConfig {
  const grades = new Set(config.grades)
  // The grade filter only ever drops kanji; radicals and words pass through.
  const gradeFilter = (card: SrsCard) =>
    typeOf(card.id) !== 'kanji' || grades.has(getKanji(bareId(card.id)).grade)
  const pools: QuizPools =
    scope === 'mixed'
      ? {
          known: [...poolsByType.radical.known, ...poolsByType.kanji.known, ...poolsByType.vocab.known],
          progress: [
            ...poolsByType.radical.progress,
            ...poolsByType.kanji.progress,
            ...poolsByType.vocab.progress,
          ],
          new: [...poolsByType.radical.new, ...poolsByType.kanji.new, ...poolsByType.vocab.new],
        }
      : poolsByType[scope]
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
