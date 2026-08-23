import type { ReactNode } from 'react'
import type { Settings } from '../lib/db'
import type { VocabEntry } from '../lib/vocab'
import type { SrsCard } from '../lib/srs'
import { Furigana } from './Furigana'

export interface VocabDetailProps {
  entry: VocabEntry
  card: SrsCard
  settings: Settings
  onToggleKnown: (known: boolean) => void
  onToggleIgnored: (ignored: boolean) => void
  /** Open the full kanji detail for one of the word's kanji. */
  onSelectKanji: (kanji: string) => void
  onClose: () => void
}

const STATE_LABEL: Record<SrsCard['state'], string> = {
  new: 'New',
  learning: 'Learning',
  review: 'Review',
  relearning: 'Relearning',
}

/** Full card details for a word: every gloss, reading, sentences and SRS state. */
export function VocabDetail({
  entry,
  card,
  settings,
  onToggleKnown,
  onToggleIgnored,
  onSelectKanji,
  onClose,
}: VocabDetailProps) {
  const meanings =
    entry.meanings.length > 0 && entry.meanings[0] !== entry.meaning
      ? entry.meanings
      : [entry.meaning]

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
          <div className="flex gap-2">
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
            <button
              type="button"
              onClick={() => onToggleIgnored(!card.ignored)}
              className={`min-h-11 rounded-lg px-3 font-semibold transition active:scale-95 ${
                card.ignored
                  ? 'bg-slate-400 text-slate-900 shadow-md dark:bg-slate-500 dark:text-slate-50'
                  : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {card.ignored ? '✓ Ignored' : 'Ignore'}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="select-none text-5xl font-semibold leading-snug sm:text-6xl">
              <Furigana html={entry.furiganaHtml} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-slate-100">
                {entry.meaning}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{entry.reading}</div>
              <div className="mt-1 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                #{card.pos + 1} in top-2000
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
              Meanings
            </h3>
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm [overflow-wrap:anywhere] dark:border-slate-700 dark:bg-slate-800">
              {meanings.join('; ')}
            </p>
          </section>

          {entry.kanji.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Kanji in this word
              </h3>
              <div className="flex flex-wrap gap-2">
                {entry.kanji.map((kanji) => (
                  <button
                    key={kanji}
                    type="button"
                    onClick={() => onSelectKanji(kanji)}
                    aria-label={`Open details for ${kanji}`}
                    className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-2xl font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 active:scale-90 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500"
                  >
                    {kanji}
                  </button>
                ))}
              </div>
            </section>
          )}

          {entry.sentences.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Example sentences ({entry.sentences.length})
              </h3>
              <ol className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                {entry.sentences.map((sentence, index) => (
                  <li key={index}>
                    <div className="text-lg leading-relaxed">
                      <Furigana html={sentence.furigana} highlight={entry.id} />
                    </div>
                    <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{sentence.en}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}
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
