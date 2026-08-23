import type { VocabEntry } from '../lib/vocab'
import type { Rating, SrsCard } from '../lib/srs'
import { Furigana } from './Furigana'
import { RatingButtons } from './RatingButtons'
import { TypeBadge } from './TypeBadge'

interface VocabCardProps {
  entry: VocabEntry
  card?: SrsCard | null
  revealed: boolean
  onReveal: () => void
  onRate: (rating: Rating) => void
  /** Open the full kanji detail for one of the word's kanji. */
  onSelectKanji: (kanji: string) => void
  onIgnore?: () => void
}

/**
 * Session card for a word (decision #5: one-way, word → meaning + reading).
 * Sentences render exactly like the kanji Examples section, only when present.
 */
export function VocabCard({
  entry,
  card,
  revealed,
  onReveal,
  onRate,
  onSelectKanji,
  onIgnore,
}: VocabCardProps) {
  if (!revealed) {
    return (
      <div className="flex flex-col items-center gap-10 py-12">
        <div className="flex flex-col items-center gap-3">
          <TypeBadge type="vocab" />
          <div className="select-none text-6xl font-semibold leading-snug sm:text-7xl">
            <Furigana html={entry.furiganaHtml} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onReveal}
            className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
          >
            Show answer
            <span className="ml-2 text-xs font-normal opacity-60">space / enter</span>
          </button>
          {onIgnore && <IgnoreButton onIgnore={onIgnore} />}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col items-center gap-2">
          <TypeBadge type="vocab" />
          <div className="select-none text-5xl font-semibold leading-snug sm:text-6xl">
            <Furigana html={entry.furiganaHtml} />
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-xl font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-slate-100">
            {entry.meaning}
          </div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{entry.reading}</div>
        </div>
      </div>

      {entry.kanji.length > 0 && (
        <section>
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
                className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-white text-3xl font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 active:scale-90 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
              >
                {kanji}
              </button>
            ))}
          </div>
        </section>
      )}

      {entry.sentences.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Examples
          </h3>
          <ol className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            {entry.sentences.slice(0, 3).map((sentence, index) => (
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

      <RatingButtons card={card} onRate={onRate} />

      {onIgnore && (
        <div className="mt-2 flex justify-center">
          <IgnoreButton onIgnore={onIgnore} />
        </div>
      )}
    </div>
  )
}

function IgnoreButton({ onIgnore }: { onIgnore: () => void }) {
  return (
    <button
      type="button"
      onClick={onIgnore}
      className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-500 transition active:scale-95 dark:border-slate-600 dark:text-slate-400"
    >
      Ignore this word
    </button>
  )
}
