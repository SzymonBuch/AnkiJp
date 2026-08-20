import type { ReactNode } from 'react'
import type { Settings } from '../lib/db'
import type { KanjiEntry } from '../lib/kanji'
import type { SrsCard } from '../lib/srs'
import { Furigana } from './Furigana'

export interface KanjiDetailProps {
  entry: KanjiEntry
  card: SrsCard
  settings: Settings
  onToggleKnown: (known: boolean) => void
  onClose: () => void
}

const STATE_LABEL: Record<SrsCard['state'], string> = {
  new: 'New',
  learning: 'Learning',
  review: 'Review',
  relearning: 'Relearning',
}

/** Full card details: every meaning and every example sentence plus SRS state. */
export function KanjiDetail({ entry, card, settings, onToggleKnown, onClose }: KanjiDetailProps) {
  const meanings = entry.meanings.length > 0 && entry.meanings[0] !== entry.meaning
    ? entry.meanings
    : [entry.meaning]

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-100/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col p-4">
        <div className="flex items-start justify-between gap-4 rounded-t-2xl">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-600 transition active:scale-95"
          >
            ← Back to deck
          </button>
          <button
            type="button"
            onClick={() => onToggleKnown(!card.known)}
            className={`min-h-11 rounded-lg px-3 font-semibold transition active:scale-95 ${
              card.known
                ? 'bg-green-600 text-white shadow-md'
                : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            {card.known ? '✓ Known' : 'Mark as known'}
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="select-none text-7xl font-semibold leading-none">{entry.kanji}</div>
            <div className="flex-1">
              <div className="text-xl font-semibold text-slate-900">{entry.meaning}</div>
              <div className="mt-1 text-sm text-slate-500">
                {[entry.on.join(', '), entry.kun.join(', ')].filter(Boolean).join(' ・ ')}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                Grade {entry.grade}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-slate-500">
            <StatusPill color="bg-slate-100 text-slate-700">{STATE_LABEL[card.state]}</StatusPill>
            {card.state === 'review' && (
              <StatusPill color="bg-slate-100 text-slate-700">Interval {card.interval}d</StatusPill>
            )}
            <StatusPill color="bg-slate-100 text-slate-700">Ease {card.ease}%</StatusPill>
            <StatusPill color="bg-slate-100 text-slate-700">Reps {card.reps}</StatusPill>
            {card.lapses > 0 && <StatusPill color="bg-red-50 text-red-600">Lapses {card.lapses}</StatusPill>}
            {card.known || card.interval >= settings.knownThresholdDays ? (
              <StatusPill color="bg-green-50 text-green-700">Known {card.known ? '(manual)' : '(interval)'}</StatusPill>
            ) : null}
          </div>

          <section className="mt-5">
            <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Meanings
            </h3>
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              {meanings.join('; ')}
            </p>
          </section>

          <section className="mt-5">
            <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Radicals
            </h3>
            <div className="flex flex-wrap gap-2">
              {entry.radicals.map((radical, index) => (
                <span
                  key={index}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
                >
                  <span className="mr-1.5 text-lg leading-none">{radical.glyph}</span>
                  {radical.keyword}
                </span>
              ))}
            </div>
          </section>

          {entry.sentences.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Example sentences ({entry.sentences.length})
              </h3>
              <ol className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                {entry.sentences.map((sentence, index) => (
                  <li key={index}>
                    <div className="text-lg leading-relaxed">
                      <Furigana html={sentence.furigana} />
                    </div>
                    <div className="mt-0.5 text-sm text-slate-500">{sentence.en}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Mnemonic</h3>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  entry.mnemonicSource === 'jpdb'
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {entry.mnemonicSource === 'jpdb' ? 'jpdb' : 'AI-generated'}
              </span>
            </div>
            {entry.mnemonic ? (
              <p className="text-slate-700">{entry.mnemonic}</p>
            ) : (
              <p className="italic text-slate-400">Mnemonic coming soon.</p>
            )}
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