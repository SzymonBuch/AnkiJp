import { useEffect, useState } from 'react'
import { getLogs, getSummary, type Summary } from '../lib/db'
import type { Screen } from '../lib/nav'
import type { ContentType } from '../lib/srs'
import { computeStats } from '../lib/stats'

interface DashboardScreenProps {
  onNavigate: (screen: Screen, type?: ContentType) => void
}

/** Content types with study/review/quiz sessions; vocab joins in its own stage. */
const SESSION_TYPES: { type: ContentType; label: string }[] = [
  { type: 'kanji', label: 'Kanji' },
  { type: 'radical', label: 'Radicals' },
]

export function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSummary('kanji'), getLogs()]).then(([summaryResult, logs]) => {
      if (cancelled) return
      const stats = computeStats(logs)
      setSummary(summaryResult)
      setStreak(stats.currentStreak)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-slate-100 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-[#be1428] text-6xl font-bold text-white shadow-lg">
        安
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-semibold">AnkiJp</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Learn kanji through their radicals with Anki-style SRS and quizzes.
        </p>
      </div>

      {summary && (
        <div className="grid w-full max-w-sm grid-cols-2 gap-2 text-center sm:grid-cols-5">
          <Counter label="New" value={summary.fresh} accent="text-slate-700 dark:text-slate-300" />
          <Counter label="Learning" value={summary.learning} accent="text-amber-600 dark:text-amber-400" />
          <Counter label="Due" value={summary.due} accent="text-red-600 dark:text-red-400" />
          <Counter
            label="Future reviews"
            value={summary.future}
            accent="text-blue-600 dark:text-blue-400"
          />
          <div className="rounded-xl border border-slate-200 bg-white px-1 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-400" data-testid="dashboard-streak">
              {streak}
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Day streak
            </div>
          </div>
        </div>
      )}

      <div className="flex w-full max-w-sm flex-col gap-3">
        <SessionNav
          screen="study"
          label="Study new cards"
          description="Introduce new cards"
          onNavigate={onNavigate}
        />
        <SessionNav
          screen="review"
          label="Review due cards"
          description="Due for review today"
          onNavigate={onNavigate}
        />
        <SessionNav
          screen="quiz"
          label="Quiz"
          description="Isolated practice"
          onNavigate={onNavigate}
        />
        <NavButton
          label="Deck"
          description="Browse radicals and kanji"
          onClick={() => onNavigate('deck')}
        />
        <NavButton
          label="Statistics"
          description="Progress, accuracy, streaks"
          onClick={() => onNavigate('stats')}
        />
        <NavButton
          label="Settings"
          description="Daily limits, export, reset"
          onClick={() => onNavigate('settings')}
        />
      </div>

      <Attribution />
    </div>
  )
}

function SessionNav({
  screen,
  label,
  description,
  onNavigate,
}: {
  screen: Screen
  label: string
  description: string
  onNavigate: (screen: Screen, type?: ContentType) => void
}) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-5 py-3 shadow-sm dark:border-slate-600 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
        <span className="flex gap-2">
          {SESSION_TYPES.map(({ type, label: typeLabel }) => (
            <button
              key={type}
              type="button"
              onClick={() => onNavigate(screen, type)}
              className="min-h-9 rounded-full border border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-600 transition active:scale-95 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-400"
            >
              {typeLabel}
            </button>
          ))}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-slate-400 dark:text-slate-500">{description}</p>
    </div>
  )
}

function NavButton({
  label,
  description,
  onClick,
}: {
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-xl border border-slate-300 bg-white px-5 py-3 text-left shadow-sm transition active:scale-95 dark:border-slate-600 dark:bg-slate-900"
    >
      <span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <span className="text-sm text-slate-400 dark:text-slate-500">{description}</span>
    </button>
  )
}

function Counter({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-1 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
    </div>
  )
}

function Attribution() {
  return (
    <details className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
      <summary className="cursor-pointer select-none">Data sources &amp; attribution</summary>
      <p className="mt-1">
        Kanji readings, meanings and grades by{' '}
        <a className="underline" href="https://kanjiapi.dev" target="_blank" rel="noreferrer">kanjiapi.dev</a>{' '}
        from <a className="underline" href="https://www.edrdg.org/kanjidic/kanjidic.html" target="_blank" rel="noreferrer">KANJIDIC</a> (licensed under the EDRDG licence —{' '}
        <a className="underline" href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">edrdg.org</a>
        ); radicals, keywords and mnemonics by{' '}
        <a className="underline" href="https://jpdb.io" target="_blank" rel="noreferrer">jpdb</a>;
        example sentences by{' '}
        <a className="underline" href="https://tatoeba.org" target="_blank" rel="noreferrer">Tatoeba</a>{' '}
        (CC BY 2.0 —{' '}
        <a className="underline" href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noreferrer">creativecommons.org/licenses/by/2.0</a>
        ). See <code>ATTRIBUTIONS.md</code> for full details and licenses.
      </p>
    </details>
  )
}
