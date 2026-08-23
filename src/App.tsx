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
import type { ContentType } from './lib/srs'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [contentType, setContentType] = useState<ContentType>('kanji')
  const goHome = () => setScreen('home')
  const navigate = (next: Screen, type: ContentType = 'kanji') => {
    setContentType(type)
    setScreen(next)
  }

  if (screen === 'study') return <StudyScreen type={contentType} onExit={goHome} />
  if (screen === 'review') return <ReviewScreen type={contentType} onExit={goHome} />
  if (screen === 'quiz') return <QuizScreen type={contentType} onExit={goHome} />
  if (screen === 'deck') return <DeckScreen onExit={goHome} />
  if (screen === 'stats') return <StatsScreen onExit={goHome} />
  if (screen === 'settings') return <SettingsScreen onExit={goHome} />

  return <DashboardScreen onNavigate={navigate} />
}

export default App
