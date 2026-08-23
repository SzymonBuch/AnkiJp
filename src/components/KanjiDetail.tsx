import type { ReactNode } from 'react'
import type { Settings } from '../lib/db'
import type { KanjiEntry } from '../lib/kanji'
import type { SrsCard } from '../lib/srs'
import { Furigana } from './Furigana'

export interface KanjiDetailProps {
  entry: KanjiEntry
  card: SrsCard
  settings: Settings
  /** `undefined` hides the whole drawing section (session overlays are read-only). */
  drawing?: string | null
  onToggleKnown: (known: boolean) => void
  onToggleIgnored: (ignored: boolean) => void
  onDraw?: () => void
  onDeleteDrawing?: () => void
  onClose: () => void
}

const STATE_LABEL: Record<SrsCard['state'], string> = {
  new: 'New',
  learning: 'Learning',
  review: 'Review',
  relearning: 'Relearning',
}

/** Full card details: every meaning and every example sentence plus SRS state. */
export function KanjiDetail({ entry, card, settings, drawing, onToggleKnown, onToggleIgnored, onDraw, onDeleteDrawing, onClose }: KanjiDetailProps) {
  const meanings = entry.meanings.length > 0 && entry.meanings[0] !== entry.meaning
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
            <div className="select-none text-7xl font-semibold leading-none">{entry.kanji}</div>
            <div className="flex-1">
              <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">{entry.meaning}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {[entry.on.join(', '), entry.kun.join(', ')].filter(Boolean).join(' ・ ')}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Grade {entry.grade}
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
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              {meanings.join('; ')}
            </p>
          </section>

          <section className="mt-5">
            <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Radicals
            </h3>
            <div className="flex flex-wrap gap-2">
              {entry.radicals.map((radical, index) => (
                <span
                  key={index}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <span className="mr-1.5 text-lg leading-none">{radical.glyph}</span>
                  {radical.keyword}
                </span>
              ))}
            </div>
          </section>

          {entry.sentences.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Example sentences ({entry.sentences.length})
              </h3>
              <ol className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                {entry.sentences.map((sentence, index) => (
                  <li key={index}>
                    <div className="text-lg leading-relaxed">
                      <Furigana html={sentence.furigana} highlight={entry.kanji} />
                    </div>
                    <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{sentence.en}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mnemonic</h3>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  entry.mnemonicSource === 'jpdb'
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                }`}
              >
                {entry.mnemonicSource === 'jpdb' ? 'jpdb' : 'AI-generated'}
              </span>
            </div>
            {entry.mnemonic ? (
              <p className="text-slate-700 dark:text-slate-300">{entry.mnemonic}</p>
            ) : (
              <p className="italic text-slate-400 dark:text-slate-500">Mnemonic coming soon.</p>
            )}
          </section>

          {drawing !== undefined && (
            <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                My drawing
              </h3>
              {drawing ? (
                <img
                  src={drawing}
                  alt={`Hand-drawn mnemonic for ${entry.kanji}`}
                  className="h-32 w-32 rounded-lg border border-slate-200 dark:border-slate-700"
                />
              ) : (
                <p className="italic text-slate-400 dark:text-slate-500">No drawing yet.</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onDraw}
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {drawing ? 'Edit drawing' : 'Draw'}
                </button>
                {drawing && onDeleteDrawing && (
                  <button
                    type="button"
                    onClick={onDeleteDrawing}
                    className="min-h-11 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition active:scale-95 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400"
                  >
                    Delete
                  </button>
                )}
              </div>
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