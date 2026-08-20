import type { QuizMode } from '../lib/quiz'

const MODES: { mode: QuizMode; title: string; description: string; glyph: string }[] = [
  { mode: 'reading', title: 'Reading', description: 'Pick the reading of a kanji', glyph: '読' },
  { mode: 'meaning', title: 'Meaning', description: 'Pick the meaning of a kanji', glyph: '意' },
  { mode: 'reverse', title: 'Reverse', description: 'Pick the kanji for a reading', glyph: '逆' },
]

interface QuizSetupProps {
  poolCount: number
  onStart: (mode: QuizMode) => void
}

export function QuizSetup({ poolCount, onStart }: QuizSetupProps) {
  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold">Choose a quiz</h2>
        <p className="mt-2 text-slate-600">
          <span className="font-semibold text-slate-900">{poolCount}</span> known kanji in your pool
          {' — '}
          <span className="text-slate-500">interval at/over the known threshold</span>
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {MODES.map(({ mode, title, description, glyph }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onStart(mode)}
            className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-95"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-2xl text-white">
              {glyph}
            </span>
            <span>
              <span className="block text-lg font-semibold leading-tight">{title}</span>
              <span className="block text-sm text-slate-500">{description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}