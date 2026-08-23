import { SessionView } from '../components/SessionView'
import type { SessionType } from '../lib/mixed'

const TITLES: Record<SessionType, string> = {
  mixed: 'Study',
  kanji: 'Study kanji',
  radical: 'Study radicals',
  vocab: 'Study words',
}

export function StudyScreen({ type = 'mixed', onExit }: { type?: SessionType; onExit: () => void }) {
  return (
    <SessionView
      kind="study"
      type={type}
      title={TITLES[type]}
      onExit={onExit}
    />
  )
}
