import type { QuizQuestion } from '../lib/quiz'

interface QuizQuestionViewProps {
  question: QuizQuestion
  index: number
  total: number
  selection: string | null
  onSelect: (option: string) => void
  onNext: () => void
}

const INSTRUCTION: Record<QuizQuestion['mode'], string> = {
  reading: 'Choose the reading',
  meaning: 'Choose the meaning',
  reverse: 'Choose the kanji',
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
  const isReverse = question.mode === 'reverse'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <span>
          Question <span className="font-semibold text-slate-900 dark:text-slate-100">{index + 1}</span> of {total}
        </span>
        <span className="text-slate-400 dark:text-slate-500">{INSTRUCTION[question.mode]}</span>
      </div>

      <div className="flex flex-col items-center gap-2 py-6">
        <div
          className={`select-none leading-none ${
            isReverse ? 'text-6xl font-medium' : 'text-[9rem] font-semibold sm:text-[11rem]'
          }`}
        >
          {question.prompt}
        </div>
      </div>

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
              className={`rounded-xl border-2 px-4 py-4 text-center text-lg font-semibold shadow-sm transition disabled:cursor-default ${classes}`}
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