import { useEffect, useState } from 'react'
import { getLogs } from '../lib/db'
import { computeStats, type OverallStats } from '../lib/stats'

interface StatsScreenProps {
  onExit: () => void
}

export function StatsScreen({ onExit }: StatsScreenProps) {
  const [stats, setStats] = useState<OverallStats | null>(null)

  useEffect(() => {
    let cancelled = false
    getLogs().then((logs) => {
      if (cancelled) return
      setStats(computeStats(logs))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="text-lg font-semibold">Statistics</h1>
          <button
            type="button"
            onClick={onExit}
            className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:text-slate-300"
          >
            Exit
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        {!stats ? (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>
        ) : stats.totalAnswers === 0 ? (
          <p className="py-16 text-center text-slate-500 dark:text-slate-400">
            No reviews yet. Study a few cards to see statistics here.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Answers" value={stats.totalAnswers} />
              <Metric label="New learned" value={stats.newLearned} />
              <Metric label="Reviews" value={stats.reviewsDone} />
              <div className="grid grid-cols-2 gap-2 sm:col-span-4">
                <Metric label="Day streak" value={stats.currentStreak.toFixed(0)} />
                <Metric label="Longest streak" value={stats.longestStreak.toFixed(0)} />
                <Metric label="Accuracy" value={`${stats.accuracy}%`} />
                <Metric label="Retention" value={`${stats.retention}%`} />
              </div>
            </div>

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Reviews per day
              </h2>
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                {[...stats.daily].reverse().map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {day.date}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                      <div
                        className="flex h-full items-center rounded-md bg-slate-800 px-2 text-[10px] font-semibold tabular-nums text-white dark:bg-slate-300 dark:text-slate-900"
                        style={{ width: `${barWidth(day.answers, stats)}%` }}
                      >
                        {day.answers}
                      </div>
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {day.newCards} new · {day.reviews} rev
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
    </div>
  )
}

/** Relative bar width; a minimal width keeps single-answer days readable. */
function barWidth(answers: number, stats: OverallStats): number {
  const max = Math.max(...stats.daily.map((d) => d.answers))
  if (max === 0) return 0
  return Math.max(24, Math.round((answers / max) * 100))
}