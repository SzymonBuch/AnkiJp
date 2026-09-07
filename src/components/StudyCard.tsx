import type { KanjiEntry } from '../lib/kanji'
import { hasRadical } from '../lib/radicals'
import type { Rating, SrsCard } from '../lib/srs'
import { jpdbKanjiUrl } from '../lib/externalLinks'
import { Furigana } from './Furigana'
import { JpdbLink } from './JpdbLink'
import { RatingButtons } from './RatingButtons'
import { TypeBadge } from './TypeBadge'

interface StudyCardProps {
  entry: KanjiEntry
  card?: SrsCard | null
  revealed: boolean
  drawing?: string | null
  onReveal: () => void
  onRate: (rating: Rating) => void
  /** Radicals have no Ignore (decision #10); kanji sessions always do. */
  onIgnore?: () => void
  onSelectRadical?: (glyph: string) => void
}

export function StudyCard({ entry, card, revealed, drawing, onReveal, onRate, onIgnore, onSelectRadical }: StudyCardProps) {
  if (!revealed) {
    return (
      <div className="flex flex-col items-center gap-10 py-12">
        <div className="flex flex-col items-center gap-3">
          <TypeBadge type="kanji" />
          <div className="select-none text-[9rem] font-semibold leading-none sm:text-[11rem]">
            {entry.kanji}
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
        <div className="flex flex-col items-center gap-2">
          <TypeBadge type="kanji" />
          <div className="select-none text-7xl font-semibold leading-none">{entry.kanji}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">{entry.meaning}</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {[entry.on.join(', '), entry.kun.join(', ')].filter(Boolean).join(' ・ ')}
          </div>
          <div className="mt-3">
            <JpdbLink href={jpdbKanjiUrl(entry.kanji)} ariaLabel={`Open ${entry.kanji} in jpdb`} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Radicals
        </h3>
        <div className="flex flex-wrap gap-2">
          {entry.radicals.map((radical, index) => (
            hasRadical(radical.glyph) && onSelectRadical ? (
              <button
                key={index}
                type="button"
                onClick={() => onSelectRadical(radical.glyph)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500"
              >
                <span className="mr-1.5 text-lg leading-none">{radical.glyph}</span>
                {radical.keyword}
              </button>
            ) : (
              <span
              key={index}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <span className="mr-1.5 text-lg leading-none">{radical.glyph}</span>
              {radical.keyword}
              </span>
            )
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Readings
        </h3>
        <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          {entry.on.length > 0 && (
            <p className="text-sm">
              <span className="mr-2 inline-block w-10 font-semibold text-slate-500 dark:text-slate-400">On</span>
              {entry.on.join(', ')}
            </p>
          )}
          {entry.kun.length > 0 && (
            <p className="text-sm">
              <span className="mr-2 inline-block w-10 font-semibold text-slate-500 dark:text-slate-400">Kun</span>
              {entry.kun.join(', ')}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Examples
        </h3>
        <ol className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          {entry.sentences.slice(0, 3).map((sentence, index) => (
            <li key={index}>
              <div className="text-lg leading-relaxed">
                <Furigana html={sentence.furigana} highlight={entry.kanji} />
              </div>
              <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{sentence.en}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
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
      </div>

      {drawing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            My drawing
          </h3>
          <img
            src={drawing}
            alt={`Hand-drawn mnemonic for ${entry.kanji}`}
            className="h-40 w-40 rounded-lg border border-slate-200 dark:border-slate-700"
          />
        </div>
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
      Ignore this kanji
    </button>
  )
}
