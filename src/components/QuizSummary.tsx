import type { QuizMode } from '../lib/quiz'
import type { QuizAnswer } from '../lib/useQuizSession'

const MODE_LABEL: Record<QuizMode, string> = {
  reading: 'Reading',
  meaning: 'Meaning',
  reverse: 'Reverse',
  mixed: 'Mixed',
  cloze: 'Cloze',
}

interface QuizSummaryProps {
  mode: QuizMode
  total: number
  correctCount: number
  answers: QuizAnswer[]
  onRetake: () => void
  onExit: () => void
}

export function QuizSummary({ mode, total, correctCount, answers, onRetake, onExit }: QuizSummaryProps) {
  const percent = total === 0 ? 0 : Math.round((correctCount / total) * 100)
  const mistakes = answers.filter((answer) => !answer.correct)

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold">Quiz complete</h2>
        <p className="mt-1 text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {MODE_LABEL[mode]}
        </p>
        <div className="mx-auto mt-4 flex w-36 flex-col items-center rounded-2xl border border-slate-200 bg-white py-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <span className="text-5xl font-bold text-slate-900 dark:text-slate-100">{percent}%</span>
          <span className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {correctCount} / {total} correct
          </span>
        </div>
      </div>

      {mistakes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Missed {mistakes.length}
          </h3>
          <ul className="space-y-2">
            {mistakes.map((answer) => (
              <li
                key={answer.question.index}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-semibold leading-none">
                    {answer.question.kind === 'radical'
                      ? answer.question.glyph
                      : answer.question.kind === 'vocab'
                        ? answer.question.vocabId
                        : answer.question.kanji}
                  </span>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">{answer.question.prompt}</div>
                    <div className="font-medium text-green-700 dark:text-green-400">✓ {answer.question.correct}</div>
                    <div className="text-red-600 dark:text-red-400">✗ {answer.selected}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRetake}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 shadow-sm transition active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          Retake
        </button>
        <button
          type="button"
          onClick={onExit}
          className="flex-1 rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
        >
          Done
        </button>
      </div>
    </div>
  )
}