import { useEffect } from 'react'
import { QuizQuestionView } from '../components/QuizQuestionView'
import { QuizSetup } from '../components/QuizSetup'
import { QuizSummary } from '../components/QuizSummary'
import { useQuizSession } from '../lib/useQuizSession'
import type { ContentType } from '../lib/srs'

interface QuizScreenProps {
  type?: ContentType
  onExit: () => void
}

export function QuizScreen({ type = 'kanji', onExit }: QuizScreenProps) {
  const quiz = useQuizSession(type)

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
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <h1 className="text-lg font-semibold">{type === 'radical' ? 'Radical quiz' : 'Quiz'}</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={onExit}
              className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:text-slate-300"
            >
              End session
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-4">
        {quiz.status === 'loading' && <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>}
        {quiz.status === 'empty' && <EmptyState onExit={onExit} />}
        {quiz.status === 'setup' && (
          <QuizSetup
            type={type}
            config={quiz.config}
            counts={quiz.counts}
            maxCount={quiz.maxCount}
            maxExtraNew={quiz.maxExtraNew}
            clozeEligibleCount={quiz.clozeEligibleCount}
            canStart={quiz.canStart}
            onChange={quiz.updateConfig}
            onStart={quiz.start}
          />
        )}
        {quiz.status === 'ready' && quiz.current && (
          <QuizQuestionView
            question={quiz.current}
            index={quiz.currentIndex}
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
      <h2 className="text-2xl font-semibold">Nothing to quiz yet</h2>
      <p className="max-w-sm text-slate-600 dark:text-slate-300">
        Your deck is empty of quizable cards. Study a few first — quizzes can draw from cards you
        know, ones in progress, or even brand-new ones.
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
      >
        Done
      </button>
    </div>
  )
}