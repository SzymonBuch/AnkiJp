import { SessionView } from '../components/SessionView'
import type { ContentType } from '../lib/srs'

export function ReviewScreen({ type = 'kanji', onExit }: { type?: ContentType; onExit: () => void }) {
  return (
    <SessionView
      kind="review"
      type={type}
      title={type === 'radical' ? 'Review radicals' : 'Review'}
      onExit={onExit}
    />
  )
}
