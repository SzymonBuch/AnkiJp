import { useCallback, useEffect, useRef, useState } from 'react'
import { answerCard, getSessionQueue } from './db'
import type { Rating, SrsCard } from './srs'

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
  finish: () => void
}

/**
 * Shared state for a Study (new cards) or Review (due cards) session.
 * The queue is rebuilt from the DB after every answer, so learning/relearning
 * steps that have elapsed are pulled back into the same session.
 */
export function useStudySession(kind: SessionKind): StudySession {
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
    const queue = await getSessionQueue()
    if (kind === 'study') {
      return [...queue.learning.filter((c) => c.state === 'learning'), ...queue.fresh]
    }
    return [...queue.learning.filter((c) => c.state === 'relearning'), ...queue.review]
  }, [kind])

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
        await answerCard(current.kanji, rating)
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

  return {
    status,
    current: cards[0] ?? null,
    remaining: cards.length,
    progress,
    revealed,
    reveal,
    rate,
    finish,
  }
}
