import { SessionView } from '../components/SessionView'

export function StudyScreen({ onExit }: { onExit: () => void }) {
  return <SessionView kind="study" title="Study" onExit={onExit} />
}
