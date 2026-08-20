import { useState } from 'react'
import './index.css'
import { QuizScreen } from './screens/QuizScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { StudyScreen } from './screens/StudyScreen'

type Screen = 'home' | 'study' | 'review' | 'quiz'

function Attribution() {
  return (
    <details className="mt-2 text-center text-xs text-slate-400">
      <summary className="cursor-pointer select-none">Data sources &amp; attribution</summary>
      <p className="mt-1">
        Kanji data by{' '}
        <a className="underline" href="https://kanjiapi.dev" target="_blank" rel="noreferrer">kanjiapi.dev</a>{' '}
        (from KANJIDIC/EDRDG); radicals, keywords and mnemonics by{' '}
        <a className="underline" href="https://jpdb.io" target="_blank" rel="noreferrer">jpdb</a>;
        example sentences by{' '}
        <a className="underline" href="https://tatoeba.org" target="_blank" rel="noreferrer">Tatoeba</a>{' '}
        (CC BY 2.0). See <code>ATTRIBUTIONS.md</code> for full details and licenses.
      </p>
    </details>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const goHome = () => setScreen('home')

  if (screen === 'study') return <StudyScreen onExit={goHome} />
  if (screen === 'review') return <ReviewScreen onExit={goHome} />
  if (screen === 'quiz') return <QuizScreen onExit={goHome} />

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-slate-100 p-6 text-slate-900">
      <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-[#be1428] text-6xl font-bold text-white shadow-lg">
        安
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-semibold">AnkiJp</h1>
        <p className="mt-2 text-slate-600">
          Learn all 1,006 joyo kanji with Anki-style SRS and quizzes.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={() => setScreen('study')}
          className="rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95"
        >
          Study new cards
        </button>
        <button
          type="button"
          onClick={() => setScreen('review')}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 shadow-sm transition active:scale-95"
        >
          Review due cards
        </button>
        <button
          type="button"
          onClick={() => setScreen('quiz')}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 shadow-sm transition active:scale-95"
        >
          Quiz known kanji
        </button>
      </div>
      <Attribution />
    </div>
  )
}

export default App
