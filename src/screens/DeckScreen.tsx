import { useEffect, useMemo, useState } from 'react'
import { DrawingPad } from '../components/DrawingPad'
import { KanjiDetail } from '../components/KanjiDetail'
import {
  deleteDrawing,
  getAllCards,
  getAllDrawings,
  getCard,
  getSettings,
  markIgnored,
  markKnown,
  putDrawing,
  type Settings,
} from '../lib/db'
import { DAY_MS, type SrsCard } from '../lib/srs'
import { getKanji } from '../lib/kanji'

type Filter = 'all' | 'new' | 'learning' | 'due' | 'known' | 'ignored'
type CardStatus = Exclude<Filter, 'all'> | 'scheduled'

interface Row {
  card: SrsCard
  status: CardStatus
}

interface DeckScreenProps {
  onExit: () => void
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'learning', label: 'Learning' },
  { value: 'due', label: 'Due' },
  { value: 'known', label: 'Known' },
  { value: 'ignored', label: 'Ignored' },
]

const CELL_COLOR: Record<CardStatus, string> = {
  new: 'text-slate-400 dark:text-slate-500',
  learning: 'text-amber-600 dark:text-amber-400',
  due: 'text-red-600 dark:text-red-400',
  scheduled: 'text-slate-900 dark:text-slate-100',
  known: 'text-green-700 dark:text-green-400',
  ignored: 'text-slate-500 dark:text-slate-400',
}

export function DeckScreen({ onExit }: DeckScreenProps) {
  const [cards, setCards] = useState<SrsCard[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SrsCard | null>(null)
  const [drawings, setDrawings] = useState<Record<string, string>>({})
  const [padOpen, setPadOpen] = useState(false)
  const [now, setNow] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAllCards(), getSettings(), getAllDrawings()]).then(
      ([cardData, settingsData, drawingData]) => {
        if (cancelled) return
        setCards(cardData)
        setSettings(settingsData)
        setDrawings(Object.fromEntries(drawingData.map((d) => [d.kanji, d.dataUrl])))
        setNow(Date.now())
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<Row[]>(() => {
    if (!settings || now === 0) return []
    const endOfToday = startOfDay(now) + DAY_MS
    return cards
      .filter((card) => (filter === 'ignored' ? card.ignored : !card.ignored))
      .map((card) => ({ card, status: cardStatus(card, settings, endOfToday) }))
  }, [cards, settings, now, filter])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (!needle) return true
      const entry = getKanji(row.card.kanji)
      return (
        row.card.kanji.includes(needle) ||
        entry.meaning.toLowerCase().includes(needle) ||
        entry.kun.some((k) => k.toLowerCase().includes(needle)) ||
        entry.on.some((o) => o.toLowerCase().includes(needle))
      )
    })
  }, [rows, filter, query])

  const toggleCard = async (
    kanji: string,
    mutate: (kanji: string) => Promise<SrsCard | undefined>,
  ) => {
    await mutate(kanji)
    const updated = (await getCard(kanji)) ?? null
    setSelected(updated)
    setCards((prev) => prev.map((c) => (c.kanji === kanji ? (updated ?? c) : c)))
  }

  const toggleKnown = (kanji: string, known: boolean) =>
    toggleCard(kanji, (k) => markKnown(k, known))

  const toggleIgnored = (kanji: string, ignored: boolean) =>
    toggleCard(kanji, (k) => markIgnored(k, ignored))

  const saveDrawing = async (dataUrl: string) => {
    if (!selected) return
    await putDrawing({ kanji: selected.kanji, dataUrl, updatedAt: Date.now() })
    setDrawings((prev) => ({ ...prev, [selected.kanji]: dataUrl }))
    setPadOpen(false)
  }

  const removeDrawing = async () => {
    if (!selected) return
    await deleteDrawing(selected.kanji)
    setDrawings((prev) => {
      const next = { ...prev }
      delete next[selected.kanji]
      return next
    })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Deck</h1>
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <span className="tabular-nums" data-testid="deck-count">
                {visible.length} / {rows.length}
              </span>
              <button
                type="button"
                onClick={onExit}
                className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:text-slate-300"
              >
                Exit
              </button>
            </div>
          </div>

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search kanji, meaning or reading…"
            aria-label="Search kanji"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500"
          />

          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`min-h-11 rounded-full px-4 text-sm font-medium transition active:scale-95 ${
                  filter === value
                    ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-4">
        {cards.length === 0 ? (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400">No kanji match this filter.</p>
        ) : (
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 md:grid-cols-10 lg:grid-cols-12">
            {visible.map(({ card, status }) => (
              <button
                key={card.kanji}
                type="button"
                onClick={() => setSelected(card)}
                aria-label={`${card.kanji} — ${status}`}
                className={`flex aspect-square min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-2xl font-semibold shadow-sm transition active:scale-90 sm:text-3xl dark:border-slate-700 dark:bg-slate-900 ${CELL_COLOR[status]}`}
              >
                {card.kanji}
              </button>
            ))}
          </div>
        )}
      </main>

      {selected && settings && (
        <KanjiDetail
          entry={getKanji(selected.kanji)}
          card={selected}
          settings={settings}
          drawing={drawings[selected.kanji] ?? null}
          onToggleKnown={(known) => toggleKnown(selected.kanji, known)}
          onToggleIgnored={(ignored) => toggleIgnored(selected.kanji, ignored)}
          onDraw={() => setPadOpen(true)}
          onDeleteDrawing={removeDrawing}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && padOpen && (
        <DrawingPad
          kanji={selected.kanji}
          initial={drawings[selected.kanji] ?? null}
          onSave={saveDrawing}
          onClose={() => setPadOpen(false)}
        />
      )}
    </div>
  )
}

function cardStatus(
  card: SrsCard,
  settings: Settings,
  endOfToday: number,
): CardStatus {
  if (card.ignored) return 'ignored'
  if (card.known || (card.state === 'review' && card.interval >= settings.knownThresholdDays)) {
    return 'known'
  }
  if (card.state === 'new') return 'new'
  if (card.state === 'learning' || card.state === 'relearning') return 'learning'
  return card.due <= endOfToday ? 'due' : 'scheduled'
}

function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}