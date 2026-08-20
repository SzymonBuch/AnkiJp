import { useEffect } from 'react'
import { QuizQuestionView } from '../components/QuizQuestionView'
import { QuizSetup } from '../components/QuizSetup'
import { QuizSummary } from '../components/QuizSummary'
import { useQuizSession } from '../lib/useQuizSession'

export function QuizScreen({ onExit }: { onExit: () => void }) {
  const quiz = useQuizSession()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || quiz.status !== 'ready') return
      if (quiz.selection === null) {
        const index = Number(event.key)
        const option = quiz.current && index >= 1 && index <= 4 ? quiz.current.options[index - 1] : undefined
        if (option) quiz.select(option)
      } else if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault()
        quiz.next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quiz])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <h1 className="text-lg font-semibold">Quiz</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            {quiz.status === 'ready' && quiz.current && (
              <span className="tabular-nums" data-testid="quiz-progress">
                {quiz.answered} / {quiz.total}
              </span>
            )}
            <button
              type="button"
              onClick={onExit}
              className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95"
            >
              End session
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-4">
        {quiz.status === 'loading' && <p className="py-12 text-center text-slate-500">Loading…</p>}
        {quiz.status === 'empty' && <EmptyState onExit={onExit} />}
        {quiz.status === 'setup' && <QuizSetup poolCount={quiz.poolCount} onStart={quiz.start} />}
        {quiz.status === 'ready' && quiz.current && (
          <QuizQuestionView
            question={quiz.current}
            index={quiz.answered}
            total={quiz.total}
            selection={quiz.selection}
            onSelect={quiz.select}
            onNext={quiz.next}
          />
        )}
        {quiz.status === 'done' && quiz.mode && (
          <QuizSummary
            mode={quiz.mode}
            total={quiz.total}
            correctCount={quiz.correctCount}
            answers={quiz.answers}
            onRetake={quiz.restart}
            onExit={onExit}
          />
        )}
      </main>
    </div>
  )
}

function EmptyState({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <h2 className="text-2xl font-semibold">No known kanji yet</h2>
      <p className="max-w-sm text-slate-600">
        Quizzes only include kanji you already know. Keep studying until cards reach the known
        interval, or mark them as known from the Deck.
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95"
      >
        Done
      </button>
    </div>
  )
}