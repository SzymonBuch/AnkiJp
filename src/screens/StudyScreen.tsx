import { SessionView } from '../components/SessionView'
import type { ContentType } from '../lib/srs'

const TITLES: Record<ContentType, string> = {
  kanji: 'Study',
  radical: 'Study radicals',
  vocab: 'Study words',
}

export function StudyScreen({ type = 'kanji', onExit }: { type?: ContentType; onExit: () => void }) {
  return (
    <SessionView
      kind="study"
      type={type}
      title={TITLES[type]}
      onExit={onExit}
    />
  )
}
