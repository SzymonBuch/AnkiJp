import { useState } from 'react'
import './index.css'
import { DashboardScreen } from './screens/DashboardScreen'
import { DeckScreen } from './screens/DeckScreen'
import { QuizScreen } from './screens/QuizScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StatsScreen } from './screens/StatsScreen'
import { StudyScreen } from './screens/StudyScreen'
import type { Screen } from './lib/nav'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const goHome = () => setScreen('home')

  if (screen === 'study') return <StudyScreen onExit={goHome} />
  if (screen === 'review') return <ReviewScreen onExit={goHome} />
  if (screen === 'quiz') return <QuizScreen onExit={goHome} />
  if (screen === 'deck') return <DeckScreen onExit={goHome} />
  if (screen === 'stats') return <StatsScreen onExit={goHome} />
  if (screen === 'settings') return <SettingsScreen onExit={goHome} />

  return <DashboardScreen onNavigate={setScreen} />
}

export default App