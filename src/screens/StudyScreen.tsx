import { SessionView } from '../components/SessionView'
import type { ContentType } from '../lib/srs'

export function StudyScreen({ type = 'kanji', onExit }: { type?: ContentType; onExit: () => void }) {
  return (
    <SessionView
      kind="study"
      type={type}
      title={type === 'radical' ? 'Study radicals' : 'Study'}
      onExit={onExit}
    />
  )
}
