import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  clearDrawings,
  getAllCards,
  getAllDrawings,
  getLogs,
  getSettings,
  getSummary,
  resetProgress,
  setSettings,
  type Settings,
} from '../lib/db'
import { EXOTIC_GLYPHS, describeCodePoint, isGlyphRenderable } from '../lib/glyphs'
import { getRadical } from '../lib/radicals'
import { computeStats } from '../lib/stats'
import { getThemeMode, setThemeMode, type ThemeMode } from '../lib/theme'

interface SettingsScreenProps {
  onExit: () => void
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export function SettingsScreen({ onExit }: SettingsScreenProps) {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS)
  const [message, setMessage] = useState('')
  const [theme, setTheme] = useState<ThemeMode>(() => getThemeMode())

  useEffect(() => {
    getSettings().then((settings) => {
      setSaved(settings)
      setDraft(settings)
    })
  }, [])

  const updateNumber = (
    key: 'newPerDay' | 'newPerDayRadical' | 'newPerDayVocab' | 'reviewLimit' | 'knownThresholdDays',
    raw: string,
  ) => {
    const value = Math.max(1, Math.floor(Number(raw) || DEFAULT_SETTINGS[key]))
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    const next = await setSettings(draft)
    setSaved(next)
    setMessage('Settings saved.')
  }

  const exportStats = async () => {
    const [settings, logs, cards, summary, drawings] = await Promise.all([
      getSettings(),
      getLogs(),
      getAllCards(),
      getSummary('kanji'),
      getAllDrawings(),
    ])
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 3,
      settings,
      summary,
      stats: computeStats(logs),
      cards,
      logs,
      drawings,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'ankijp-stats.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const reset = async () => {
    await resetProgress()
    const settings = await getSettings()
    setSaved(settings)
    setDraft(settings)
    setMessage('Progress reset. Cards have been reseeded.')
  }

  const clearAllDrawings = async () => {
    await clearDrawings()
    setMessage('All drawings cleared.')
  }

  const changeTheme = (mode: ThemeMode) => {
    setTheme(mode)
    setThemeMode(mode)
  }

  return (
    <div className="flex min-h-svh flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <h1 className="text-lg font-semibold">Settings</h1>
          <button
            type="button"
            onClick={onExit}
            className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:text-slate-300"
          >
            Exit
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-4">
        {!saved ? (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Daily limits
              </h2>
              <NumberField
                label="New kanji per day"
                hint="How many new kanji are introduced each day."
                value={draft.newPerDay}
                onChange={(raw) => updateNumber('newPerDay', raw)}
              />
              <NumberField
                label="New radicals per day"
                hint="Radical cards are quick — the default is deliberately higher than for kanji."
                value={draft.newPerDayRadical}
                onChange={(raw) => updateNumber('newPerDayRadical', raw)}
              />
              <NumberField
                label="New words per day"
                hint="How many new words are introduced each day — words unlock as their kanji are studied."
                value={draft.newPerDayVocab}
                onChange={(raw) => updateNumber('newPerDayVocab', raw)}
              />
              <NumberField
                label="Review limit per day"
                hint="Cap on due reviews answered per day."
                value={draft.reviewLimit}
                onChange={(raw) => updateNumber('reviewLimit', raw)}
              />
              <NumberField
                label="Known interval (days)"
                hint="A review card becomes 'known' once its interval reaches this — the quiz pool threshold."
                value={draft.knownThresholdDays}
                onChange={(raw) => updateNumber('knownThresholdDays', raw)}
              />
              <button
                type="button"
                onClick={save}
                className="w-full rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
              >
                Save settings
              </button>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Theme
              </h2>
              <div className="flex gap-2">
                {THEME_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeTheme(value)}
                    aria-pressed={theme === value}
                    className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-medium transition active:scale-95 ${
                      theme === value
                        ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                        : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Exotic glyph checklist
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Radical code points that common CJK fonts often miss. Verify each renders as a
                character (not an empty box) on every device you use.
              </p>
              <div className="grid grid-cols-7 gap-2">
                {EXOTIC_GLYPHS.map((glyph) => {
                  const ok = isGlyphRenderable(glyph)
                  const keyword = safeRadicalKeyword(glyph)
                  return (
                    <div
                      key={glyph}
                      title={`${describeCodePoint(glyph)}${keyword ? ` — ${keyword}` : ''}`}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 ${
                        ok
                          ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                          : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
                      }`}
                    >
                      <span className="text-2xl leading-none">{glyph}</span>
                      <span className="font-mono text-[9px] text-slate-400 dark:text-slate-500">
                        {describeCodePoint(glyph)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Data</h2>
              <button
                type="button"
                onClick={exportStats}
                className="w-full rounded-xl border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 shadow-sm transition active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                Export statistics (JSON)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Delete all drawings? This cannot be undone.')) {
                    clearAllDrawings().catch(() => setMessage('Failed to clear drawings.'))
                  }
                }}
                className="w-full rounded-xl border border-red-200 bg-red-50 px-6 py-3 font-medium text-red-700 shadow-sm transition active:scale-95 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400"
              >
                Clear drawings
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Reset all SRS progress and review history? This cannot be undone.')) {
                    reset().catch(() => setMessage('Reset failed.'))
                  }
                }}
                className="w-full rounded-xl border border-red-200 bg-red-50 px-6 py-3 font-medium text-red-700 shadow-sm transition active:scale-95 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400"
              >
                Reset progress
              </button>
            </section>

            {message && <p className="text-center text-sm text-slate-600 dark:text-slate-300">{message}</p>}
          </div>
        )}
      </main>
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: number
  onChange: (raw: string) => void
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
      <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-500"
      />
    </label>
  )
}

/** Keyword for the checklist tooltips; null when the glyph is not a radical. */
function safeRadicalKeyword(glyph: string): string | null {
  try {
    return getRadical(glyph).keyword
  } catch {
    return null
  }
}
