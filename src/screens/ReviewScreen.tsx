import { SessionView } from '../components/SessionView'
import type { SessionType } from '../lib/mixed'

const TITLES: Record<SessionType, string> = {
  mixed: 'Review',
  kanji: 'Review kanji',
  radical: 'Review radicals',
  vocab: 'Review words',
}

export function ReviewScreen({ type = 'mixed', onExit }: { type?: SessionType; onExit: () => void }) {
  return (
    <SessionView
      kind="review"
      type={type}
      title={TITLES[type]}
      onExit={onExit}
    />
  )
}
