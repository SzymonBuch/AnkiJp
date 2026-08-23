import { useState } from 'react'
import './index.css'
import { DashboardScreen } from './screens/DashboardScreen'
import { DeckScreen } from './screens/DeckScreen'
import { QuizScreen } from './screens/QuizScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StatsScreen } from './screens/StatsScreen'
import { StudyScreen } from './screens/StudyScreen'
import type { Screen, DeckFocus } from './lib/nav'
import type { SessionType } from './lib/mixed'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  // Mixed sessions are the app's default; single types stay selectable.
  const [contentType, setContentType] = useState<SessionType>('mixed')
  const [deckFocus, setDeckFocus] = useState<DeckFocus | null>(null)
  const goHome = () => setScreen('home')
  const navigate = (
    next: Screen,
    type: SessionType = 'mixed',
    focus: DeckFocus | null = null,
  ) => {
    setContentType(type)
    setDeckFocus(focus)
    setScreen(next)
  }

  if (screen === 'study') return <StudyScreen type={contentType} onExit={goHome} />
  if (screen === 'review') return <ReviewScreen type={contentType} onExit={goHome} />
  if (screen === 'quiz') return <QuizScreen type={contentType} onExit={goHome} />
  if (screen === 'deck') return <DeckScreen onExit={goHome} focus={deckFocus} />
  if (screen === 'stats') return <StatsScreen onExit={goHome} />
  if (screen === 'settings') return <SettingsScreen onExit={goHome} />

  return <DashboardScreen onNavigate={navigate} />
}

export default App
