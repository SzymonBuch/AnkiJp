import type { KanjiEntry } from '../lib/kanji'
import type { Rating } from '../lib/srs'
import { Furigana } from './Furigana'
import { RatingButtons } from './RatingButtons'

interface StudyCardProps {
  entry: KanjiEntry
  revealed: boolean
  drawing?: string | null
  onReveal: () => void
  onRate: (rating: Rating) => void
  onIgnore: () => void
}

export function StudyCard({ entry, revealed, drawing, onReveal, onRate, onIgnore }: StudyCardProps) {
  if (!revealed) {
    return (
      <div className="flex flex-col items-center gap-10 py-12">
        <div className="select-none text-[9rem] font-semibold leading-none sm:text-[11rem]">
          {entry.kanji}
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onReveal}
            className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95"
          >
            Show answer
            <span className="ml-2 text-xs font-normal opacity-60">space / enter</span>
          </button>
          <IgnoreButton onIgnore={onIgnore} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="select-none text-7xl font-semibold leading-none">{entry.kanji}</div>
        <div className="text-right">
          <div className="text-xl font-semibold text-slate-900">{entry.meaning}</div>
          <div className="mt-1 text-sm text-slate-500">
            {[entry.on.join(', '), entry.kun.join(', ')].filter(Boolean).join(' ・ ')}
          </div>
        </div>
      </div>

      <div>
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
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Readings
        </h3>
        <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
          {entry.on.length > 0 && (
            <p className="text-sm">
              <span className="mr-2 inline-block w-10 font-semibold text-slate-500">On</span>
              {entry.on.join(', ')}
            </p>
          )}
          {entry.kun.length > 0 && (
            <p className="text-sm">
              <span className="mr-2 inline-block w-10 font-semibold text-slate-500">Kun</span>
              {entry.kun.join(', ')}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Examples
        </h3>
        <ol className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          {entry.sentences.slice(0, 3).map((sentence, index) => (
            <li key={index}>
              <div className="text-lg leading-relaxed">
                <Furigana html={sentence.furigana} />
              </div>
              <div className="mt-0.5 text-sm text-slate-500">{sentence.en}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
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
      </div>

      {drawing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
            My drawing
          </h3>
          <img
            src={drawing}
            alt={`Hand-drawn mnemonic for ${entry.kanji}`}
            className="h-40 w-40 rounded-lg border border-slate-200"
          />
        </div>
      )}

      <RatingButtons onRate={onRate} />

      <div className="mt-2 flex justify-center">
        <IgnoreButton onIgnore={onIgnore} />
      </div>
    </div>
  )
}

function IgnoreButton({ onIgnore }: { onIgnore: () => void }) {
  return (
    <button
      type="button"
      onClick={onIgnore}
      className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-500 transition active:scale-95"
    >
      Ignore this kanji
    </button>
  )
}
