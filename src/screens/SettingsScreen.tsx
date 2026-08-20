import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  getAllCards,
  getLogs,
  getSettings,
  getSummary,
  resetProgress,
  setSettings,
  type Settings,
} from '../lib/db'
import { computeStats } from '../lib/stats'

interface SettingsScreenProps {
  onExit: () => void
}

export function SettingsScreen({ onExit }: SettingsScreenProps) {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS)
  const [message, setMessage] = useState('')

  useEffect(() => {
    getSettings().then((settings) => {
      setSaved(settings)
      setDraft(settings)
    })
  }, [])

  const updateNumber = (key: keyof Settings, raw: string) => {
    const value = Math.max(1, Math.floor(Number(raw) || DEFAULT_SETTINGS[key]))
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    const next = await setSettings(draft)
    setSaved(next)
    setMessage('Settings saved.')
  }

  const exportStats = async () => {
    const [settings, logs, cards, summary] = await Promise.all([
      getSettings(),
      getLogs(),
      getAllCards(),
      getSummary(),
    ])
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      settings,
      summary,
      stats: computeStats(logs),
      cards,
      logs,
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

  return (
    <div className="flex min-h-svh flex-col bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <h1 className="text-lg font-semibold">Settings</h1>
          <button
            type="button"
            onClick={onExit}
            className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95"
          >
            Exit
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-4">
        {!saved ? (
          <p className="py-12 text-center text-slate-500">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Daily limits
              </h2>
              <NumberField
                label="New cards per day"
                hint="How many new cards are introduced each day."
                value={draft.newPerDay}
                onChange={(raw) => updateNumber('newPerDay', raw)}
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
                className="w-full rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95"
              >
                Save settings
              </button>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Data</h2>
              <button
                type="button"
                onClick={exportStats}
                className="w-full rounded-xl border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 shadow-sm transition active:scale-95"
              >
                Export statistics (JSON)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Reset all SRS progress and review history? This cannot be undone.')) {
                    reset().catch(() => setMessage('Reset failed.'))
                  }
                }}
                className="w-full rounded-xl border border-red-200 bg-red-50 px-6 py-3 font-medium text-red-700 shadow-sm transition active:scale-95"
              >
                Reset progress
              </button>
            </section>

            {message && <p className="text-center text-sm text-slate-600">{message}</p>}
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
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
      />
    </label>
  )
}