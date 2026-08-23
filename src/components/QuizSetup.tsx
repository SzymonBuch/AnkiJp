import type { SessionType } from '../lib/mixed'
import type { QuizConfig, QuizMode, QuizSource } from '../lib/quiz'
import type { QuizSourceCounts } from '../lib/useQuizSession'

const SOURCES: { source: QuizSource; label: string }[] = [
  { source: 'known', label: 'Known' },
  { source: 'progress', label: 'In progress' },
  { source: 'new', label: 'New' },
]

/** Pool scopes (Etap 5): mixed across the deck by default, or one type. */
const SCOPES: { value: SessionType; label: string }[] = [
  { value: 'mixed', label: 'All' },
  { value: 'kanji', label: 'Kanji' },
  { value: 'radical', label: 'Radicals' },
  { value: 'vocab', label: 'Words' },
]

const GRADES = [1, 2, 3, 4, 5, 6]

const MODES: { mode: QuizMode; title: string; description: string; glyph: string }[] = [
  { mode: 'reading', title: 'Reading', description: 'Pick the reading of a kanji', glyph: '読' },
  { mode: 'meaning', title: 'Meaning', description: 'Pick the meaning of a kanji', glyph: '意' },
  { mode: 'reverse', title: 'Reverse', description: 'Pick the kanji for a reading', glyph: '逆' },
  { mode: 'mixed', title: 'Mixed', description: 'Random mode per question', glyph: '混' },
  { mode: 'cloze', title: 'Cloze', description: 'Fill the kanji in a sentence', glyph: '例' },
]

/** Mixed pool (Etap 5): cloze stays narrowable-to-kanji only. */
const MIXED_MODES: { mode: QuizMode; title: string; description: string; glyph: string }[] = [
  { mode: 'reading', title: 'Reading', description: 'Pick readings (meanings for radicals)', glyph: '読' },
  { mode: 'meaning', title: 'Meaning', description: 'Pick meanings across the deck', glyph: '意' },
  { mode: 'reverse', title: 'Reverse', description: 'Pick the kanji or word (meanings for radicals)', glyph: '逆' },
  { mode: 'mixed', title: 'Mixed', description: 'Random mode per question', glyph: '混' },
]

/** Radical quizzes are meaning-only for now (Etap 2). */
const RADICAL_MODES: { mode: QuizMode; title: string; description: string; glyph: string }[] = [
  { mode: 'meaning', title: 'Meaning', description: 'Pick the keyword of a radical', glyph: '意' },
]

/** Vocab quizzes come in the three card directions plus mixed (Etap 4). */
const VOCAB_MODES: { mode: QuizMode; title: string; description: string; glyph: string }[] = [
  { mode: 'meaning', title: 'Meaning', description: 'Pick the meaning of a word', glyph: '意' },
  { mode: 'reading', title: 'Reading', description: 'Pick the reading of a word', glyph: '読' },
  { mode: 'reverse', title: 'Reverse', description: 'Pick the word for a meaning', glyph: '逆' },
  { mode: 'mixed', title: 'Mixed', description: 'Random mode per question', glyph: '混' },
]

interface QuizSetupProps {
  scope: SessionType
  config: QuizConfig
  counts: QuizSourceCounts
  maxCount: number
  maxExtraNew: number
  clozeEligibleCount: number
  canStart: boolean
  onChange: (patch: Partial<QuizConfig>) => void
  onScopeChange: (scope: SessionType) => void
  onStart: (mode: QuizMode) => void
}

export function QuizSetup({
  scope,
  config,
  counts,
  maxCount,
  maxExtraNew,
  clozeEligibleCount,
  canStart,
  onChange,
  onScopeChange,
  onStart,
}: QuizSetupProps) {
  const count = Math.min(config.count, Math.max(maxCount, 1))
  const extraNew = Math.min(config.extraNew, maxExtraNew)
  const setSize = Math.min(config.count, maxCount) + extraNew
  const modes =
    scope === 'radical'
      ? RADICAL_MODES
      : scope === 'vocab'
        ? VOCAB_MODES
        : scope === 'mixed'
          ? MIXED_MODES
          : MODES

  const toggleSource = (source: QuizSource) => {
    const has = config.sources.includes(source)
    if (has && config.sources.length === 1) return
    onChange({
      sources: has ? config.sources.filter((s) => s !== source) : [...config.sources, source],
    })
  }

  const toggleGrade = (grade: number) => {
    const has = config.grades.includes(grade)
    if (has && config.grades.length === 1) return
    onChange({
      grades: has
        ? config.grades.filter((g) => g !== grade)
        : [...config.grades, grade].sort((a, b) => a - b),
    })
  }

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold">Choose a quiz</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Pick the sources, filters and length — then a mode.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Deck
          </h3>
          <div className="flex flex-wrap gap-2">
            {SCOPES.map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                pressed={scope === value}
                onClick={() => onScopeChange(value)}
              />
            ))}
          </div>
          {scope === 'mixed' && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              All card types together — radicals answer in meaning mode.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Sources
          </h3>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map(({ source, label }) => (
              <Chip
                key={source}
                label={label}
                badge={counts[source]}
                pressed={config.sources.includes(source)}
                onClick={() => toggleSource(source)}
              />
            ))}
          </div>
        </div>

        {scope === 'kanji' && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Grade
            </h3>
            <div className="flex flex-wrap gap-2">
              <Chip
                label="G0"
                pressed={config.grades.includes(0)}
                onClick={() => toggleGrade(0)}
              />
              {GRADES.map((grade) => (
                <Chip
                  key={grade}
                  label={`G${grade}`}
                  pressed={config.grades.includes(grade)}
                  onClick={() => toggleGrade(grade)}
                />
              ))}
            </div>
            {!config.grades.includes(0) && (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                G0 covers the extra kanji that entered the deck through the top-2000 vocabulary.
              </p>
            )}
          </div>
        )}

        {scope === 'kanji' && (
          <div className="flex gap-2">
            <Toggle
              label="Due today only"
              pressed={config.dueOnly}
              onClick={() => onChange({ dueOnly: !config.dueOnly })}
            />
            <Toggle
              label="Problematic"
              pressed={config.problematicOnly}
              onClick={() => onChange({ problematicOnly: !config.problematicOnly })}
            />
          </div>
        )}

        <Stepper
          label="Questions"
          hint={`${maxCount} available`}
          value={count}
          min={1}
          max={Math.max(maxCount, 1)}
          onChange={(value) => onChange({ count: value })}
        />
        {scope === 'kanji' && (
          <Stepper
            label="+ New kanji"
            hint={`${maxExtraNew} available`}
            value={extraNew}
            min={0}
            max={maxExtraNew}
            onChange={(value) => onChange({ extraNew: value })}
          />
        )}

        <p className="text-center text-sm text-slate-600 dark:text-slate-300">
          Set:{' '}
          <span className="font-semibold text-slate-900 dark:text-slate-100">{setSize}</span>{' '}
          questions
        </p>
      </section>

      {!canStart && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {scope === 'radical'
            ? 'No radicals match these sources. Enable more sources — quizable radicals appear as you study them.'
            : scope === 'vocab'
              ? 'No words match these sources. Enable more sources — quizable words appear as you study their kanji.'
              : scope === 'kanji'
                ? 'No kanji matches these sources and filters. Enable more sources, relax the filters, or add new kanji with “+ New kanji”.'
                : 'No cards match these sources yet. Enable more sources — quizable cards appear as you study.'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {modes.map(({ mode, title, description, glyph }) => {
          const disabled = !canStart || (mode === 'cloze' && clozeEligibleCount === 0)
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => onStart(mode)}
              className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-2xl text-white dark:bg-slate-100 dark:text-slate-900">
                {glyph}
              </span>
              <span>
                <span className="block text-lg font-semibold leading-tight">{title}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">{description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Chip({
  label,
  badge,
  pressed,
  onClick,
}: {
  label: string
  badge?: number
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 rounded-xl px-4 text-sm font-medium transition active:scale-95 ${
        pressed
          ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
          : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {label}
      {badge !== undefined && <span className="ml-1.5 opacity-60">{badge}</span>}
    </button>
  )
}

function Toggle({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-medium transition active:scale-95 ${
        pressed
          ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
          : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {label}
    </button>
  )
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const stepButton =
    'flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-semibold text-slate-700 shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
        <span className="block text-xs text-slate-400 dark:text-slate-500">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className={stepButton}
        >
          −
        </button>
        <span className="w-10 text-center text-lg font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className={stepButton}
        >
          +
        </button>
      </div>
    </div>
  )
}
