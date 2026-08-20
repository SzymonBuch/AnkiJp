import { SessionView } from '../components/SessionView'

export function ReviewScreen({ onExit }: { onExit: () => void }) {
  return <SessionView kind="review" title="Review" onExit={onExit} />
}
