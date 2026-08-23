import type { QuestionMode, QuizQuestion } from '../lib/quiz'
import { Furigana } from './Furigana'
import { TypeBadge } from './TypeBadge'

interface QuizQuestionViewProps {
  question: QuizQuestion
  index: number
  total: number
  selection: string | null
  onSelect: (option: string) => void
  onNext: () => void
}

const INSTRUCTION: Record<QuestionMode, string> = {
  reading: 'Choose the reading',
  meaning: 'Choose the meaning',
  reverse: 'Choose the kanji',
  cloze: 'Choose the fitting kanji',
}

const VOCAB_INSTRUCTION: Record<'meaning' | 'reading' | 'reverse', string> = {
  reading: 'Choose the reading',
  meaning: 'Choose the meaning',
  reverse: 'Choose the word',
}

function instructionFor(question: QuizQuestion): string {
  if (question.kind === 'vocab') return VOCAB_INSTRUCTION[question.mode]
  return INSTRUCTION[question.mode]
}

/** Glyph prompts stay huge; word and text prompts scale to stay legible. */
function promptClasses(question: QuizQuestion): string {
  const base = 'select-none font-medium leading-snug [overflow-wrap:anywhere]'
  if (question.kind === 'vocab') return `${base} text-4xl sm:text-5xl`
  if (question.mode === 'reverse') return `${base} text-6xl`
  return 'select-none text-[9rem] font-semibold leading-none sm:text-[11rem]'
}

export function QuizQuestionView({
  question,
  index,
  total,
  selection,
  onSelect,
  onNext,
}: QuizQuestionViewProps) {
  const answered = selection !== null
  const isCloze = question.mode === 'cloze'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <span>
          Question <span className="font-semibold text-slate-900 dark:text-slate-100">{index + 1}</span> of {total}
        </span>
        <span className="flex items-center gap-2">
          {/* Identical fronts (`r:一` vs `k:一`) are disambiguated by type. */}
          <TypeBadge type={question.kind === 'radical' ? 'radical' : question.kind === 'vocab' ? 'vocab' : 'kanji'} />
          {question.kind === 'kanji' && (
            <span className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
              G{question.grade}
            </span>
          )}
          <span className="text-slate-400 dark:text-slate-500">{instructionFor(question)}</span>
        </span>
      </div>

      {isCloze ? (
        <div className="mx-auto max-w-sm py-6 text-center text-2xl font-medium leading-relaxed sm:text-3xl">
          {question.prompt}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-6">
          {question.kind === 'vocab' && question.furiganaHtml && !question.hideFurigana ? (
            // Word prompts render their bundled furigana — except in reading
            // mode, where it would reveal the answer (hideFurigana).
            <div className="select-none text-5xl font-semibold leading-snug sm:text-6xl">
              <Furigana html={question.furiganaHtml} />
            </div>
          ) : (
            <div className={promptClasses(question)}>{question.prompt}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {question.options.map((option) => {
          let classes = 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
          if (answered && option === question.correct) {
            classes = 'border-green-500 bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300'
          } else if (answered && option === selection) {
            classes = 'border-red-400 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
          } else if (answered) {
            classes = 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500'
          }
          return (
            <button
              key={option}
              type="button"
              disabled={answered}
              onClick={() => onSelect(option)}
              className={`flex min-h-14 items-center justify-center rounded-xl border-2 px-4 py-3 text-center text-lg font-semibold shadow-sm transition [overflow-wrap:anywhere] disabled:cursor-default ${classes}`}
            >
              {option}
            </button>
          )
        })}
      </div>

      {answered && (
        <div className="flex flex-col items-center gap-3">
          <p
            className={`text-lg font-semibold ${
              selection === question.correct ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {selection === question.correct
              ? 'Correct!'
              : `Not quite — the answer is ${question.correct}`}
          </p>
          {question.kind === 'kanji' && isCloze && question.sentenceEn && (
            <p className="max-w-sm text-center text-sm text-slate-500 dark:text-slate-400">
              {question.sentenceEn}
            </p>
          )}
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
          >
            {index + 1 < total ? 'Next' : 'See results'}
            <span className="ml-2 text-xs font-normal opacity-60">enter</span>
          </button>
        </div>
      )}
    </div>
  )
}