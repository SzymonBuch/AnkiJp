import { getKanjiUsing, getRadical, getRadicalDependencies, type RadicalEntry } from '../lib/radicals'
import type { Rating, SrsCard } from '../lib/srs'
import { jpdbKanjiUrl } from '../lib/externalLinks'
import { RadicalGlyph } from './RadicalGlyph'
import { JpdbLink } from './JpdbLink'
import { RatingButtons } from './RatingButtons'
import { TypeBadge } from './TypeBadge'

interface RadicalCardProps {
  entry: RadicalEntry
  card?: SrsCard | null
  revealed: boolean
  drawing?: string | null
  onReveal: () => void
  onRate: (rating: Rating) => void
  /** Open the full kanji detail for one of the containing kanji. */
  onSelectKanji: (kanji: string) => void
  onSelectRadical: (glyph: string) => void
}

/**
 * Session card for a radical (decision #5 analogue: glyph → keyword).
 * Radicals have no Ignore action (decision #10) — only ratings.
 */
export function RadicalCard({ entry, card, revealed, drawing, onReveal, onRate, onSelectKanji, onSelectRadical }: RadicalCardProps) {
  if (!revealed) {
    return (
      <div className="flex flex-col items-center gap-10 py-12">
        <div className="flex flex-col items-center gap-3">
          <TypeBadge type="radical" />
          <RadicalGlyph glyph={entry.glyph} className="text-[9rem] font-semibold leading-none sm:text-[11rem]" />
        </div>
        <button
          type="button"
          onClick={onReveal}
          className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
        >
          Show answer
          <span className="ml-2 text-xs font-normal opacity-60">space / enter</span>
        </button>
      </div>
    )
  }

  const usedIn = getKanjiUsing(entry.glyph)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col items-center gap-2">
          <TypeBadge type="radical" />
          <RadicalGlyph glyph={entry.glyph} className="text-7xl font-semibold leading-none" />
        </div>
        <div className="self-center text-right">
          <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{entry.keyword}</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Used in {usedIn.length} kanji
          </div>
          <div className="mt-3">
            <JpdbLink href={jpdbKanjiUrl(entry.glyph)} ariaLabel={`Open ${entry.glyph} in jpdb`} />
          </div>
        </div>
      </div>

      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mnemonic</h3>
          <MnemonicSource source={entry.mnemonicSource} />
        </div>
        {entry.mnemonic ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">{entry.mnemonic}</p>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white p-4 italic text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">Mnemonic coming soon.</p>
        )}
      </section>

      {getRadicalDependencies(entry.glyph).length > 0 && (
        <section>
          <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Components</h3>
          <div className="flex flex-wrap gap-2">
            {getRadicalDependencies(entry.glyph).map((glyph) => (
              <button
                key={glyph}
                type="button"
                onClick={() => onSelectRadical(glyph)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
              >
                <span className="mr-1.5 text-lg leading-none">{glyph}</span>
                {getRadical(glyph).keyword}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Kanji using this radical
        </h3>
        <div className="grid grid-cols-8 gap-1.5 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-10 dark:border-slate-700 dark:bg-slate-900">
          {usedIn.map(({ kanji }) => (
            <button
              key={kanji}
              type="button"
              onClick={() => onSelectKanji(kanji)}
              aria-label={`Open details for ${kanji}`}
              className="flex aspect-square min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-2xl font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 active:scale-90 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500"
            >
              {kanji}
            </button>
          ))}
        </div>
      </section>

      {drawing && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">My drawing</h3>
          <img src={drawing} alt={`Hand-drawn mnemonic for radical ${entry.glyph}`} className="h-40 w-40 rounded-lg border border-slate-200 dark:border-slate-700" />
        </section>
      )}

      <RatingButtons card={card} onRate={onRate} />
    </div>
  )
}

function MnemonicSource({ source }: { source: RadicalEntry['mnemonicSource'] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${source === 'jpdb' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
      {source === 'jpdb' ? 'jpdb' : 'AI-generated'}
    </span>
  )
}
