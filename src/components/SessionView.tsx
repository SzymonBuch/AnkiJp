import { useEffect, useState } from 'react'
import { getAllCards, getAllDrawings, getCard, getSettings, markIgnored, markKnown, type Settings } from '../lib/db'
import { lockedVocabRows } from '../lib/gating'
import { getKanji } from '../lib/kanji'
import { getRadical } from '../lib/radicals'
import { getVocab } from '../lib/vocab'
import { bareId, cardId, typeOf, type ContentType, type Rating, type SrsCard } from '../lib/srs'
import {
  useStudySession,
  type SessionKind,
  type SessionProgress,
} from '../lib/useStudySession'
import { KanjiDetail } from './KanjiDetail'
import { RadicalCard } from './RadicalCard'
import { StudyCard } from './StudyCard'
import { VocabCard } from './VocabCard'

interface SessionViewProps {
  kind: SessionKind
  type?: ContentType
  title: string
  onExit: () => void
}

export function SessionView({ kind, type = 'kanji', title, onExit }: SessionViewProps) {
  const session = useStudySession(kind, type)
  const { status, revealed, rate, reveal } = session
  const [drawings, setDrawings] = useState<Map<string, string>>(new Map())
  const [settings, setSettings] = useState<Settings | null>(null)
  /** Kanji detail opened from a radical's "used in" grid. */
  const [selected, setSelected] = useState<SrsCard | null>(null)
  /**
   * Words whose kanji are not all studied yet — shown when a vocab session
   * runs dry, so "All caught up" never reads like "there is nothing left".
   */
  const [lockedVocab, setLockedVocab] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAllDrawings(), getSettings()]).then(([drawingList, loadedSettings]) => {
      if (cancelled) return
      setDrawings(new Map(drawingList.map((d) => [d.id, d.dataUrl])))
      setSettings(loadedSettings)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (type !== 'vocab') return
    let cancelled = false
    getAllCards().then((cards) => {
      if (!cancelled) setLockedVocab(lockedVocabRows(cards).length)
    })
    return () => {
      cancelled = true
    }
  }, [type, status])

  useEffect(() => {
    const shortcuts: Record<string, Rating> = {
      '1': 'again',
      '2': 'hard',
      '3': 'good',
      '4': 'easy',
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || status !== 'ready') return
      if (selected !== null) return
      if (!revealed) {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault()
          reveal()
        }
        return
      }
      const rating = shortcuts[event.key]
      if (rating) rate(rating)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, revealed, rate, reveal, selected])

  const toggleSelectedKnown = async (known: boolean) => {
    if (!selected) return
    setSelected((await markKnown(selected.id, known)) ?? null)
  }

  const toggleSelectedIgnored = async (ignored: boolean) => {
    if (!selected) return
    setSelected((await markIgnored(selected.id, ignored)) ?? null)
  }

  const current = session.current

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            {status === 'ready' && (
              <span data-testid="session-progress" className="tabular-nums">
                {session.remaining} left
              </span>
            )}
            {(status === 'loading' || status === 'ready') && (
              <button
                type="button"
                onClick={session.finish}
                className="min-h-11 rounded-lg border border-slate-300 px-3 font-medium text-slate-600 transition active:scale-95 dark:border-slate-600 dark:text-slate-300"
              >
                End session
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-4">
        {status === 'loading' && <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading…</p>}
        {status === 'ready' && current && (
          <>
            {typeOf(current.id) === 'radical' ? (
              <RadicalCard
                entry={getRadical(bareId(current.id))}
                card={current}
                revealed={revealed}
                onReveal={reveal}
                onRate={rate}
                onSelectKanji={(kanji) => {
                  getCard(cardId('kanji', kanji)).then((card) => card && setSelected(card))
                }}
              />
            ) : typeOf(current.id) === 'vocab' ? (
              <VocabCard
                entry={getVocab(bareId(current.id))}
                card={current}
                revealed={revealed}
                onReveal={reveal}
                onRate={rate}
                onSelectKanji={(kanji) => {
                  getCard(cardId('kanji', kanji)).then((card) => card && setSelected(card))
                }}
                onIgnore={session.canIgnore ? session.ignore : undefined}
              />
            ) : (
              <StudyCard
                entry={getKanji(bareId(current.id))}
                card={current}
                revealed={revealed}
                drawing={drawings.get(current.id) ?? null}
                onReveal={reveal}
                onRate={rate}
                onIgnore={session.canIgnore ? session.ignore : undefined}
              />
            )}
          </>
        )}
        {(status === 'done' || status === 'empty') && (
          <>
            {type === 'vocab' && status === 'empty' && lockedVocab > 0 && (
              <p className="mx-auto mb-4 max-w-md rounded-xl border border-sky-300 bg-sky-50 p-3 text-center text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                <span className="font-bold tabular-nums">{lockedVocab}</span> more words will
                unlock as you study their kanji — see the Deck for the roadmap.
              </p>
            )}
            <Summary
              empty={status === 'empty'}
              progress={session.progress}
              onExit={onExit}
            />
          </>
        )}
      </main>

      {selected && settings && (
        <KanjiDetail
          entry={getKanji(bareId(selected.id))}
          card={selected}
          settings={settings}
          onToggleKnown={toggleSelectedKnown}
          onToggleIgnored={toggleSelectedIgnored}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function Summary({
  empty,
  progress,
  onExit,
}: {
  empty: boolean
  progress: SessionProgress
  onExit: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      {empty ? (
        <>
          <h2 className="text-2xl font-semibold">All caught up!</h2>
          <p className="text-slate-600 dark:text-slate-300">No cards to study right now.</p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-semibold">Session complete</h2>
          <p className="text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{progress.newCards}</span> new ·{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{progress.reviewCards}</span>{' '}
            reviews · <span className="font-semibold text-slate-900 dark:text-slate-100">{progress.total}</span> total
          </p>
        </>
      )}
      <button
        type="button"
        onClick={onExit}
        className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95 dark:bg-slate-100 dark:text-slate-900"
      >
        Done
      </button>
    </div>
  )
}
