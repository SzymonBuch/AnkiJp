import { useEffect, useMemo, useState } from 'react'
import { DrawingPad } from '../components/DrawingPad'
import { KanjiDetail } from '../components/KanjiDetail'
import { RadicalDetail } from '../components/RadicalDetail'
import { RadicalGlyph } from '../components/RadicalGlyph'
import { VocabDetail } from '../components/VocabDetail'
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
import { buildGateContext, isKanjiUnlocked, lockedVocabRows, missingComponents, type LockedVocabRow } from '../lib/gating'
import { getKanji } from '../lib/kanji'
import { DAY_MS, bareId, cardId, typeOf, type ContentType, type SrsCard } from '../lib/srs'
import { getRadical } from '../lib/radicals'
import { getVocab } from '../lib/vocab'

type Filter = 'all' | 'new' | 'learning' | 'due' | 'known' | 'ignored'
type CardStatus = Exclude<Filter, 'all'> | 'scheduled'

interface Row {
  card: SrsCard
  status: CardStatus
}

/** One gated kanji together with its still-missing components. */
interface BlockedRow {
  card: SrsCard
  missing: { glyph: string; card: SrsCard | undefined }[]
}

interface DeckScreenProps {
  onExit: () => void
}

/** Vocab joins as its own tab in its own stage. */
const TABS: { type: ContentType; label: string }[] = [
  { type: 'kanji', label: 'Kanji' },
  { type: 'radical', label: 'Radicals' },
  { type: 'vocab', label: 'Words' },
]

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'learning', label: 'Learning' },
  { value: 'due', label: 'Due' },
  { value: 'known', label: 'Known' },
  { value: 'ignored', label: 'Ignored' },
]

/** How many locked words the roadmap lists before collapsing into "+N more". */
const LOCKED_VOCAB_PREVIEW = 15

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
  const [tab, setTab] = useState<ContentType>('kanji')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SrsCard | null>(null)
  const [drawings, setDrawings] = useState<Record<string, string>>({})
  const [padOpen, setPadOpen] = useState(false)
  const [now, setNow] = useState(0)
  const [showBlocked, setShowBlocked] = useState(false)
  const [showLocked, setShowLocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAllCards(), getSettings(), getAllDrawings()]).then(
      ([cardData, settingsData, drawingData]) => {
        if (cancelled) return
        setCards(cardData)
        setSettings(settingsData)
        setDrawings(Object.fromEntries(drawingData.map((d) => [d.id, d.dataUrl])))
        setNow(Date.now())
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  /**
   * Vocab roadmap (Etap 4): ranked words whose kanji are not all studied yet.
   * These have no card in the DB, so without this list they would be invisible
   * — the learner could not tell what is coming or what to study next.
   */
  const lockedVocab = useMemo<LockedVocabRow[]>(
    () => (cards.length === 0 ? [] : lockedVocabRows(cards)),
    [cards],
  )

  /**
   * Kanji still locked by gating (#3): new cards with at least one
   * not-yet-seen component. The drill-down names the culprits and where each
   * sits in the radical study order.
   */
  const blockedRows = useMemo<BlockedRow[]>(() => {
    if (cards.length === 0) return []
    const ctx = buildGateContext(cards)
    return cards
      .filter((card) => typeOf(card.id) === 'kanji' && !card.ignored && card.state === 'new')
      .filter((card) => !isKanjiUnlocked(getKanji(bareId(card.id)), ctx))
      .sort((a, b) => a.pos - b.pos)
      .map((card) => ({
        card,
        missing: missingComponents(getKanji(bareId(card.id)), ctx).map((glyph) => ({
          glyph,
          card: cardsById.get(cardId('radical', glyph)),
        })),
      }))
  }, [cards, cardsById])

  const rows = useMemo<Row[]>(() => {
    if (!settings || now === 0) return []
    const endOfToday = startOfDay(now) + DAY_MS
    return cards
      .filter((card) => typeOf(card.id) === tab)
      .filter((card) => (filter === 'ignored' ? card.ignored : !card.ignored))
      .map((card) => ({ card, status: cardStatus(card, settings, endOfToday) }))
  }, [cards, settings, now, tab, filter])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (!needle) return true
      const id = bareId(row.card.id)
      if (tab === 'radical') {
        return id.includes(needle) || getRadical(id).keyword.toLowerCase().includes(needle)
      }
      if (tab === 'vocab') {
        const entry = getVocab(id)
        return (
          id.includes(needle) ||
          entry.reading.includes(needle) ||
          entry.meaning.toLowerCase().includes(needle) ||
          entry.meanings.some((m) => m.toLowerCase().includes(needle))
        )
      }
      const entry = getKanji(id)
      return (
        id.includes(needle) ||
        entry.meaning.toLowerCase().includes(needle) ||
        entry.kun.some((k) => k.toLowerCase().includes(needle)) ||
        entry.on.some((o) => o.toLowerCase().includes(needle))
      )
    })
  }, [rows, filter, query, tab])

  const toggleCard = async (
    id: string,
    mutate: (id: string) => Promise<SrsCard | undefined>,
  ) => {
    await mutate(id)
    const [updated, allCards] = await Promise.all([getCard(id), getAllCards()])
    setSelected(updated ?? null)
    // Known toggles cascade (auto-known #9, gating), so refresh every row and
    // the blocked counter, not just the card the user touched.
    setCards(allCards)
  }

  const toggleKnown = (id: string, known: boolean) =>
    toggleCard(id, (cardId) => markKnown(cardId, known))

  const toggleIgnored = (id: string, ignored: boolean) =>
    toggleCard(id, (cardId) => markIgnored(cardId, ignored))

  const saveDrawing = async (dataUrl: string) => {
    if (!selected) return
    await putDrawing({ id: selected.id, dataUrl, updatedAt: Date.now() })
    setDrawings((prev) => ({ ...prev, [selected.id]: dataUrl }))
    setPadOpen(false)
  }

  const removeDrawing = async () => {
    if (!selected) return
    await deleteDrawing(selected.id)
    setDrawings((prev) => {
      const next = { ...prev }
      delete next[selected.id]
      return next
    })
  }

  /** From a radical's "used in" grid or a word's missing-kanji chips into the kanji detail. */
  const openKanjiDetail = async (kanji: string) => {
    const card = await getCard(cardId('kanji', kanji))
    if (card) setSelected(card)
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

          <div className="flex gap-2">
            {TABS.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                aria-pressed={tab === type}
                onClick={() => setTab(type)}
                className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold transition active:scale-95 ${
                  tab === type
                    ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'kanji' && blockedRows.length > 0 && (
            <button
              type="button"
              data-testid="blocked-counter"
              onClick={() => setShowBlocked((open) => !open)}
              className={`flex min-h-11 items-center justify-between rounded-xl border px-4 text-sm font-medium transition active:scale-95 ${
                showBlocked
                  ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200'
                  : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
              }`}
            >
              <span>
                <span className="font-bold tabular-nums">{blockedRows.length}</span> blocked —
                components not studied yet
              </span>
              <span aria-hidden="true">{showBlocked ? '▲' : '▼'}</span>
            </button>
          )}

          {tab === 'vocab' && lockedVocab.length > 0 && (
            <button
              type="button"
              data-testid="vocab-locked-counter"
              onClick={() => setShowLocked((open) => !open)}
              aria-expanded={showLocked}
              className={`flex min-h-11 items-center justify-between rounded-xl border px-4 text-sm font-medium transition active:scale-95 ${
                showLocked
                  ? 'border-sky-400 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200'
                  : 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
              }`}
            >
              <span>
                <span className="font-bold tabular-nums">{lockedVocab.length}</span> words waiting —
                their kanji are not studied yet
              </span>
              <span aria-hidden="true">{showLocked ? '▲' : '▼'}</span>
            </button>
          )}

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              tab === 'radical'
                ? 'Search radical glyph or keyword…'
                : tab === 'vocab'
                  ? 'Search word, meaning or reading…'
                  : 'Search kanji, meaning or reading…'
            }
            aria-label={
              tab === 'radical'
                ? 'Search radicals'
                : tab === 'vocab'
                  ? 'Search words'
                  : 'Search kanji'
            }
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
        {showLocked && tab === 'vocab' && lockedVocab.length > 0 && (
          <section
            data-testid="vocab-locked-list"
            className="mb-4 space-y-2 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/40"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">
              Next words and the kanji they are waiting for
            </h2>
            {lockedVocab.slice(0, LOCKED_VOCAB_PREVIEW).map(({ entry, missing }) => (
              <div key={entry.id} className="flex items-start gap-3">
                <span
                  title={entry.meaning}
                  className="min-h-11 shrink-0 rounded-lg border border-sky-300 bg-white px-2 py-1.5 text-lg font-semibold leading-tight [overflow-wrap:anywhere] text-sky-900 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-200"
                >
                  {entry.id}
                </span>
                <span className="flex flex-wrap gap-1.5 pt-1.5">
                  {missing.map((glyph) => (
                    <button
                      key={glyph}
                      type="button"
                      onClick={() => openKanjiDetail(glyph)}
                      aria-label={`Open details for ${glyph}`}
                      title={getKanji(glyph).meaning}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-300 bg-white text-lg font-semibold text-sky-900 transition hover:border-sky-400 active:scale-90 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-200 dark:hover:border-sky-500"
                    >
                      {glyph}
                    </button>
                  ))}
                </span>
              </div>
            ))}
            {lockedVocab.length > LOCKED_VOCAB_PREVIEW && (
              <p className="text-xs text-sky-700/80 dark:text-sky-400/80">
                +{lockedVocab.length - LOCKED_VOCAB_PREVIEW} more — they follow in the top-2000 order.
              </p>
            )}
          </section>
        )}

        {showBlocked && tab === 'kanji' && (
          <section
            data-testid="blocked-list"
            className="mb-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Blocked kanji and their missing components
            </h2>
            {blockedRows.map(({ card, missing }) => (
              <div key={card.id} className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setSelected(card)}
                  aria-label={`Open details for ${bareId(card.id)}`}
                  className="min-h-11 w-11 shrink-0 rounded-lg border border-amber-300 bg-white text-xl font-semibold text-amber-900 transition active:scale-90 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                >
                  {bareId(card.id)}
                </button>
                <span className="flex flex-wrap gap-1.5 pt-1.5">
                  {missing.map(({ glyph, card: radicalCard }) => (
                    <span
                      key={glyph}
                      title={
                        radicalCard
                          ? `${getRadical(glyph).keyword} — #${radicalCard.pos + 1} in study order`
                          : getRadical(glyph).keyword
                      }
                      className="rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                    >
                      {glyph}
                      {radicalCard &&
                        (radicalCard.state === 'new' ? ` · queued #${radicalCard.pos + 1}` : ` · ${radicalCard.state}`)}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        )}

        {cards.length === 0 ? (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400">
            Nothing matches this filter.
          </p>
        ) : (
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 md:grid-cols-10 lg:grid-cols-12">
            {visible.map(({ card, status }) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setSelected(card)}
                aria-label={`${bareId(card.id)} — ${status}`}
                className={`flex aspect-square min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition active:scale-90 dark:border-slate-700 dark:bg-slate-900 ${CELL_COLOR[status]} ${
                  tab === 'vocab'
                    ? 'px-1 text-base font-semibold [overflow-wrap:anywhere] sm:text-lg'
                    : 'text-2xl font-semibold sm:text-3xl'
                }`}
              >
                {typeOf(card.id) === 'radical' ? (
                  <RadicalGlyph glyph={bareId(card.id)} />
                ) : (
                  bareId(card.id)
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      {selected && settings && typeOf(selected.id) === 'radical' && (
        <RadicalDetail
          entry={getRadical(bareId(selected.id))}
          card={selected}
          settings={settings}
          onToggleKnown={(known) => toggleKnown(selected.id, known)}
          onSelectKanji={openKanjiDetail}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && settings && typeOf(selected.id) === 'kanji' && (
        <KanjiDetail
          entry={getKanji(bareId(selected.id))}
          card={selected}
          settings={settings}
          drawing={drawings[selected.id] ?? null}
          onToggleKnown={(known) => toggleKnown(selected.id, known)}
          onToggleIgnored={(ignored) => toggleIgnored(selected.id, ignored)}
          onDraw={() => setPadOpen(true)}
          onDeleteDrawing={removeDrawing}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && settings && typeOf(selected.id) === 'vocab' && (
        <VocabDetail
          entry={getVocab(bareId(selected.id))}
          card={selected}
          settings={settings}
          onToggleKnown={(known) => toggleKnown(selected.id, known)}
          onToggleIgnored={(ignored) => toggleIgnored(selected.id, ignored)}
          onSelectKanji={openKanjiDetail}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && padOpen && (
        <DrawingPad
          kanji={bareId(selected.id)}
          initial={drawings[selected.id] ?? null}
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