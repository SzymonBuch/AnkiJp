import { useEffect, useState } from 'react'
import { getAllDrawings } from '../lib/db'
import { getKanji } from '../lib/kanji'
import type { Rating } from '../lib/srs'
import {
  useStudySession,
  type SessionKind,
  type SessionProgress,
} from '../lib/useStudySession'
import { StudyCard } from './StudyCard'

interface SessionViewProps {
  kind: SessionKind
  title: string
  onExit: () => void
}

export function SessionView({ kind, title, onExit }: SessionViewProps) {
  const session = useStudySession(kind)
  const { status, revealed, rate, reveal } = session
  const [drawings, setDrawings] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    getAllDrawings().then((list) => {
      if (!cancelled) setDrawings(new Map(list.map((d) => [d.kanji, d.dataUrl])))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const shortcuts: Record<string, Rating> = {
      '1': 'again',
      '2': 'hard',
      '3': 'good',
      '4': 'easy',
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || status !== 'ready') return
      if (!revealed) {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault()
          reveal()
        }
        return
      }
      const rating = shortcuts[event.key]
      if (rating) rate(rating)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, revealed, rate, reveal])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            {status === 'ready' && (
              <span data-testid="session-progress" className="tabular-nums">
                {session.remaining} left
              </span>
            )}
            {(status === 'loading' || status === 'ready') && (
              <button
                type="button"
                onClick={session.finish}
                className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:text-slate-300"
              >
                End session
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-4">
        {status === 'loading' && <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>}
        {status === 'ready' && session.current && (
          <StudyCard
            entry={getKanji(session.current.kanji)}
            card={session.current}
            revealed={revealed}
            drawing={drawings.get(session.current.kanji) ?? null}
            onReveal={reveal}
            onRate={rate}
            onIgnore={session.ignore}
          />
        )}
        {(status === 'done' || status === 'empty') && (
          <Summary
            empty={status === 'empty'}
            progress={session.progress}
            onExit={onExit}
          />
        )}
      </main>
    </div>
  )
}

function Summary({
  empty,
  progress,
  onExit,
}: {
  empty: boolean
  progress: SessionProgress
  onExit: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      {empty ? (
        <>
          <h2 className="text-2xl font-semibold">All caught up!</h2>
          <p className="text-slate-600 dark:text-slate-300">No cards to study right now.</p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-semibold">Session complete</h2>
          <p className="text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{progress.newCards}</span> new ·{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{progress.reviewCards}</span>{' '}
            reviews · <span className="font-semibold text-slate-900 dark:text-slate-100">{progress.total}</span> total
          </p>
        </>
      )}
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
