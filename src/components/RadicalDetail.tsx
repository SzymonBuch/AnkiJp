import type { ReactNode } from 'react'
import type { Settings } from '../lib/db'
import { getKanjiUsing, type RadicalEntry } from '../lib/radicals'
import type { SrsCard } from '../lib/srs'
import { RadicalGlyph } from './RadicalGlyph'

export interface RadicalDetailProps {
  entry: RadicalEntry
  card: SrsCard
  settings: Settings
  onToggleKnown: (known: boolean) => void
  /** Open the full kanji detail for one of the containing kanji. */
  onSelectKanji: (kanji: string) => void
  onClose: () => void
}

const STATE_LABEL: Record<SrsCard['state'], string> = {
  new: 'New',
  learning: 'Learning',
  review: 'Review',
  relearning: 'Relearning',
}

/**
 * Radical detail in the Deck. Deliberately no Ignore action here (decision
 * #10): banning a component would lock its kanji forever — only "Mark as
 * known" is offered.
 */
export function RadicalDetail({ entry, card, settings, onToggleKnown, onSelectKanji, onClose }: RadicalDetailProps) {
  const usedIn = getKanjiUsing(entry.glyph)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-100/95 backdrop-blur-sm dark:bg-slate-950/95">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col p-4">
        <div className="flex items-start justify-between gap-4 rounded-t-2xl">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            ← Back to deck
          </button>
          {!card.ignored && (
            <button
              type="button"
              onClick={() => onToggleKnown(!card.known)}
              className={`min-h-11 rounded-lg px-3 font-semibold transition active:scale-95 ${
                card.known
                  ? 'bg-green-600 text-white shadow-md'
                  : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {card.known ? '✓ Known' : 'Mark as known'}
            </button>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <RadicalGlyph glyph={entry.glyph} className="text-7xl font-semibold leading-none" />
            <div className="flex-1">
              <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">{entry.keyword}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Used in {usedIn.length} kanji · #{card.pos + 1} in study order
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <StatusPill color="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{STATE_LABEL[card.state]}</StatusPill>
            {card.state === 'review' && (
              <StatusPill color="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Interval {card.interval}d</StatusPill>
            )}
            <StatusPill color="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Ease {card.ease}%</StatusPill>
            <StatusPill color="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Reps {card.reps}</StatusPill>
            {card.lapses > 0 && <StatusPill color="bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">Lapses {card.lapses}</StatusPill>}
            {card.known || card.interval >= settings.knownThresholdDays ? (
              <StatusPill color="bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400">Known {card.known ? '(manual)' : '(interval)'}</StatusPill>
            ) : null}
          </div>

          <section className="mt-5">
            <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Kanji using this radical
            </h3>
            <div className="grid grid-cols-8 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-10 dark:border-slate-700 dark:bg-slate-800">
              {usedIn.map(({ kanji }) => (
                <button
                  key={kanji}
                  type="button"
                  onClick={() => onSelectKanji(kanji)}
                  aria-label={`Open details for ${kanji}`}
                  className="flex aspect-square min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-2xl font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 active:scale-90 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
                >
                  {kanji}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${color}`}>{children}</span>
  )
}
