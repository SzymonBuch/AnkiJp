import { useEffect, useState } from 'react'
import { getAllCards, getLogs, getSummary, type Summary } from '../lib/db'
import type { DeckFocus, Screen } from '../lib/nav'
import { bareId, typeOf, type ContentType } from '../lib/srs'
import type { SessionType } from '../lib/mixed'
import { buildGateContext, isKanjiUnlocked, lockedVocabRows } from '../lib/gating'
import { getKanji } from '../lib/kanji'
import { computeStats } from '../lib/stats'

interface DashboardScreenProps {
  onNavigate: (screen: Screen, type?: SessionType, focus?: DeckFocus | null) => void
}

/** Content types with single-type study/review/quiz sessions, topological order. */
const SESSION_TYPES: { type: ContentType; label: string }[] = [
  { type: 'kanji', label: 'Kanji' },
  { type: 'radical', label: 'Radicals' },
  { type: 'vocab', label: 'Words' },
]

const SUMMARY_KEYS = ['fresh', 'learning', 'due', 'future'] as const
const SUMMARY_LABELS: Record<(typeof SUMMARY_KEYS)[number], string> = {
  fresh: 'New',
  learning: 'Learning',
  due: 'Due',
  future: 'Future',
}

export function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const [summaries, setSummaries] = useState<Record<ContentType, Summary> | null>(null)
  const [streak, setStreak] = useState(0)
  const [gate, setGate] = useState<{ blocked: number; locked: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Per-type summaries (Etap 6): the dashboard shows the counters broken
    // down per content type with a summed total row.
    Promise.all([
      getSummary('radical'),
      getSummary('kanji'),
      getSummary('vocab'),
      getLogs(),
      getAllCards(),
    ]).then(([radical, kanji, vocab, logs, cards]) => {
      if (cancelled) return
      setSummaries({ radical, kanji, vocab })
      setStreak(computeStats(logs).currentStreak)
      // Gating snapshot (#3): what the learner is still locked out of —
      // surfaced here so the next productive step stays one tap away.
      if (cards.length === 0) return
      const ctx = buildGateContext(cards)
      const blocked = cards.filter(
        (card) =>
          typeOf(card.id) === 'kanji' &&
          !card.ignored &&
          card.state === 'new' &&
          !isKanjiUnlocked(getKanji(bareId(card.id)), ctx),
      ).length
      setGate({ blocked, locked: lockedVocabRows(cards).length })
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
          Learn radicals, kanji and words in chained Anki-style sessions.
        </p>
      </div>

      {summaries && (
        <div className="flex w-full max-w-sm flex-col gap-2" data-testid="dashboard-counters">
          <CounterTable summaries={summaries} />
          {gate && gate.blocked + gate.locked > 0 && (
            <GateCard
              blocked={gate.blocked}
              locked={gate.locked}
              onOpen={() => onNavigate('deck', 'mixed', gate.blocked > 0 ? 'blocked' : 'locked')}
            />
          )}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="text-center text-sm tabular-nums">
              <span className="font-bold text-green-700 dark:text-green-400" data-testid="dashboard-streak">
                {streak}
              </span>{' '}
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                day streak
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex w-full max-w-sm flex-col gap-3">
        <SessionNav
          screen="study"
          label="Study new cards"
          description="Radicals, kanji and words together — or pick a single type"
          onNavigate={onNavigate}
        />
        <SessionNav
          screen="review"
          label="Review due cards"
          description="Everything due today, ordered by date"
          onNavigate={onNavigate}
        />
        <SessionNav
          screen="quiz"
          label="Quiz"
          description="Mixed pool by default — isolated practice"
          onNavigate={onNavigate}
        />
        <NavButton
          label="Deck"
          description="Browse radicals, kanji and words"
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

/**
 * One session entry. The row itself starts the mixed session (the default,
 * Etap 5); the chips narrow it to a single content type.
 */
function SessionNav({
  screen,
  label,
  description,
  onNavigate,
}: {
  screen: Screen
  label: string
  description: string
  onNavigate: (screen: Screen, type?: SessionType) => void
}) {
  return (
    <div className="flex items-stretch justify-between gap-2 rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900">
      <button
        type="button"
        onClick={() => onNavigate(screen)}
        className="min-h-11 flex-1 rounded-l-xl py-3 pl-5 text-left transition active:scale-[0.98]"
      >
        <span className="flex items-center gap-2">
          <span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
          <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-slate-100 dark:text-slate-900">
            Mixed
          </span>
        </span>
        <span className="mt-0.5 block text-sm text-slate-400 dark:text-slate-500">{description}</span>
      </button>
      <span className="flex flex-wrap items-center gap-1.5 pr-4 py-2">
        {SESSION_TYPES.map(({ type, label: typeLabel }) => (
          <button
            key={type}
            type="button"
            onClick={() => onNavigate(screen, type)}
            className="relative z-10 min-h-9 rounded-full border border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-600 transition active:scale-95 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-400"
          >
            {typeLabel}
          </button>
        ))}
      </span>
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

/** Per-type counters (Etap 6): one row per content type plus the summed total. */
function CounterTable({ summaries }: { summaries: Record<ContentType, Summary> }) {
  const total = {
    fresh: 0,
    learning: 0,
    due: 0,
    future: 0,
  }
  for (const { type } of SESSION_TYPES) {
    for (const key of SUMMARY_KEYS) total[key] += summaries[type][key]
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full text-sm tabular-nums" data-testid="dashboard-summary">
        <thead>
          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
            <th className="px-3 py-2 text-left font-medium" aria-label="Content type" />
            {SUMMARY_KEYS.map((key) => (
              <th key={key} className="px-2 py-2 text-right font-medium">
                {SUMMARY_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...SESSION_TYPES].reverse().map(({ type, label }) => (
            <CounterRow key={type} label={label} values={summaries[type]} />
          ))}
          <CounterRow label="Total" values={total} total />
        </tbody>
      </table>
    </div>
  )
}

function CounterRow({
  label,
  values,
  total = false,
}: {
  label: string
  values: Pick<Summary, (typeof SUMMARY_KEYS)[number]>
  total?: boolean
}) {
  return (
    <tr
      className={`border-b border-slate-100 last:border-b-0 dark:border-slate-800 ${
        total ? 'font-semibold' : ''
      }`}
    >
      <td className="px-3 py-1.5 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </td>
      {SUMMARY_KEYS.map((key) => (
        <td
          key={key}
          className={`px-2 py-1.5 text-right ${SUMMARY_ACCENTS[key]}`}
        >
          {values[key]}
        </td>
      ))}
    </tr>
  )
}

const SUMMARY_ACCENTS: Record<(typeof SUMMARY_KEYS)[number], string> = {
  fresh: 'text-slate-700 dark:text-slate-300',
  learning: 'text-amber-600 dark:text-amber-400',
  due: 'text-red-600 dark:text-red-400',
  future: 'text-blue-600 dark:text-blue-400',
}

/**
 * Locked-progress summary (Etap 2): kanji gated by unstudied components plus
 * words queued behind their kanji. Tapping it opens the matching Deck
 * drill-down with each entry's missing components and queue positions.
 */
function GateCard({
  blocked,
  locked,
  onOpen,
}: {
  blocked: number
  locked: number
  onOpen: () => void
}) {
  const parts = [blocked > 0 ? `${blocked} blocked kanji` : '', locked > 0 ? `${locked} words waiting` : ''].filter(
    Boolean,
  )
  return (
    <button
      type="button"
      data-testid="dashboard-gate"
      onClick={onOpen}
      className="flex min-h-11 items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-left shadow-sm transition active:scale-[0.98] dark:border-amber-800 dark:bg-amber-950/40"
    >
      <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{parts.join(' · ')}</span>
      <span className="text-xs text-amber-600 dark:text-amber-400">see what unlocks them →</span>
    </button>
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
        ); vocabulary meanings and readings from{' '}
        <a className="underline" href="https://www.edrdg.org/jmdict/j_jmdict.html" target="_blank" rel="noreferrer">JMdict</a>{' '}
        via <a className="underline" href="https://github.com/scriptin/jmdict-simplified" target="_blank" rel="noreferrer">jmdict-simplified</a>{' '}
        (EDRDG licence); radicals, keywords, mnemonics and the frequency ranking by{' '}
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
