import { SessionView } from '../components/SessionView'
import type { ContentType } from '../lib/srs'

const TITLES: Record<ContentType, string> = {
  kanji: 'Review',
  radical: 'Review radicals',
  vocab: 'Review words',
}

export function ReviewScreen({ type = 'kanji', onExit }: { type?: ContentType; onExit: () => void }) {
  return (
    <SessionView
      kind="review"
      type={type}
      title={TITLES[type]}
      onExit={onExit}
    />
  )
}
