import { useCallback, useEffect, useRef, useState } from 'react'
import { answerCard, getSessionQueue, markIgnored } from './db'
import { typeOf, type ContentType, type Rating, type SrsCard } from './srs'

export type SessionKind = 'study' | 'review'
export type SessionStatus = 'loading' | 'ready' | 'done' | 'empty'

export interface SessionProgress {
  total: number
  newCards: number
  reviewCards: number
}

export interface StudySession {
  status: SessionStatus
  current: SrsCard | null
  remaining: number
  progress: SessionProgress
  revealed: boolean
  reveal: () => void
  rate: (rating: Rating) => void
  /** Ban the current card; radicals have no Ignore (decision #10). */
  canIgnore: boolean
  ignore: () => void
  finish: () => void
}

/**
 * Shared state for a Study (new cards) or Review (due cards) session over one
 * content type. The queue is rebuilt from the DB after every answer, so
 * learning/relearning steps that have elapsed are pulled back into the same
 * session and gating re-evaluates mid-session (studied components unlock
 * kanji on the next rebuild).
 */
export function useStudySession(kind: SessionKind, type: ContentType = 'kanji'): StudySession {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [cards, setCards] = useState<SrsCard[]>([])
  const [progress, setProgress] = useState<SessionProgress>({
    total: 0,
    newCards: 0,
    reviewCards: 0,
  })
  const [revealed, setRevealed] = useState(false)
  const busy = useRef(false)

  const loadQueue = useCallback(async (): Promise<SrsCard[]> => {
    const queue = await getSessionQueue(type)
    if (kind === 'study') {
      return [...queue.learning.filter((c) => c.state === 'learning'), ...queue.fresh]
    }
    return [...queue.learning.filter((c) => c.state === 'relearning'), ...queue.review]
  }, [kind, type])

  useEffect(() => {
    let cancelled = false
    loadQueue().then((queue) => {
      if (cancelled) return
      if (queue.length === 0) setStatus('empty')
      else {
        setCards(queue)
        setStatus('ready')
      }
    })
    return () => {
      cancelled = true
    }
  }, [loadQueue])

  const reveal = useCallback(() => setRevealed(true), [])
  const finish = useCallback(() => setStatus('done'), [])

  const rate = useCallback(
    async (rating: Rating) => {
      if (busy.current || status !== 'ready') return
      const current = cards[0]
      if (!current) return
      busy.current = true
      try {
        setProgress((p) => ({
          total: p.total + 1,
          newCards: p.newCards + (current.state === 'new' ? 1 : 0),
          reviewCards: p.reviewCards + (current.state === 'review' ? 1 : 0),
        }))
        await answerCard(current.id, rating)
        const next = await loadQueue()
        setRevealed(false)
        if (next.length === 0) setStatus('done')
        else setCards(next)
      } finally {
        busy.current = false
      }
    },
    [cards, loadQueue, status],
  )

  /**
   * Ban the current card ("Ignore") and move on. Not an answer: no log entry
   * and no progress change — the card just leaves the queue. Radicals are
   * never ignorable (decision #10); `canIgnore` keeps the UI in sync.
   */
  const ignore = useCallback(
    async () => {
      if (busy.current || status !== 'ready') return
      const current = cards[0]
      if (!current || typeOf(current.id) === 'radical') return
      busy.current = true
      try {
        await markIgnored(current.id, true)
        const next = await loadQueue()
        setRevealed(false)
        if (next.length === 0) setStatus('done')
        else setCards(next)
      } finally {
        busy.current = false
      }
    },
    [cards, loadQueue, status],
  )

  const current = cards[0] ?? null

  return {
    status,
    current,
    remaining: cards.length,
    progress,
    revealed,
    reveal,
    rate,
    canIgnore: current !== null && typeOf(current.id) !== 'radical',
    ignore,
    finish,
  }
}
