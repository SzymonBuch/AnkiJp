import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { createCard, DAY_MS, rateCard, type CardState, type KnownSnapshot, type Rating, type SrsCard } from './srs'
import { KANJI_DATA } from './kanji'
import { DEFAULT_QUIZ_CONFIG, type QuizConfig } from './quiz'

export const DB_NAME = 'ankijp'
export const DB_VERSION = 2
const SETTINGS_KEY = 'settings'

export interface Settings {
  newPerDay: number
  reviewLimit: number
  knownThresholdDays: number
  quiz: QuizConfig
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 20,
  reviewLimit: 200,
  knownThresholdDays: 21,
  quiz: DEFAULT_QUIZ_CONFIG,
}

export interface ReviewLog {
  id?: number
  kanji: string
  rating: Rating
  prevState: CardState
  newState: CardState
  interval: number
  ease: number
  due: number
  timestamp: number
}

/** User-drawn mnemonic sketch for a kanji (F3 drawing pad). */
export interface Drawing {
  kanji: string
  dataUrl: string
  updatedAt: number
}

interface AnkiJpDB extends DBSchema {
  cards: {
    key: string
    value: SrsCard
  }
  log: {
    key: number
    value: ReviewLog
    indexes: { 'by-timestamp': number }
  }
  settings: {
    key: string
    value: Settings
  }
  drawings: {
    key: string
    value: Drawing
  }
}

let dbPromise: Promise<IDBPDatabase<AnkiJpDB>> | null = null

function getDb(): Promise<IDBPDatabase<AnkiJpDB>> {
  dbPromise ??= openDB<AnkiJpDB>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('cards')) {
        db.createObjectStore('cards', { keyPath: 'kanji' })
      }
      if (!db.objectStoreNames.contains('log')) {
        const logStore = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true })
        logStore.createIndex('by-timestamp', 'timestamp')
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings')
      }
      // Reserved for the drawing pad (F3); created in the same version bump.
      if (!db.objectStoreNames.contains('drawings')) {
        db.createObjectStore('drawings', { keyPath: 'kanji' })
      }
      if (oldVersion < 2) {
        const store = tx.objectStore('cards')
        for (const card of await store.getAll()) {
          const legacy = card as Partial<SrsCard>
          await store.put({
            ...card,
            ignored: legacy.ignored ?? false,
            knownPrev: legacy.knownPrev ?? null,
          })
        }
      }
    },
  })
  return dbPromise
}

/** Close the cached connection (used by tests to simulate a page reload). */
export function closeDb(): void {
  const promise = dbPromise
  dbPromise = null
  promise?.then((db) => db.close()).catch(() => undefined)
}

/** Seed the cards store from bundled data on first run. Idempotent. */
export async function ensureSeeded(): Promise<void> {
  const db = await getDb()
  const count = await db.count('cards')
  if (count > 0) return
  const now = Date.now()
  const tx = db.transaction('cards', 'readwrite')
  KANJI_DATA.forEach((entry, pos) => {
    tx.store.put(createCard(entry.kanji, pos, now))
  })
  await tx.done
}

export async function getCard(kanji: string): Promise<SrsCard | undefined> {
  return (await getDb()).get('cards', kanji)
}

export async function getAllCards(): Promise<SrsCard[]> {
  return (await getDb()).getAll('cards')
}

export async function putCard(card: SrsCard): Promise<void> {
  await (await getDb()).put('cards', card)
}

export async function bulkPutCards(cards: SrsCard[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('cards', 'readwrite')
  await Promise.all(cards.map((card) => tx.store.put(card)))
  await tx.done
}

export async function getDrawing(kanji: string): Promise<Drawing | undefined> {
  return (await getDb()).get('drawings', kanji)
}

export async function putDrawing(drawing: Drawing): Promise<void> {
  await (await getDb()).put('drawings', drawing)
}

export async function deleteDrawing(kanji: string): Promise<void> {
  await (await getDb()).delete('drawings', kanji)
}

export async function getAllDrawings(): Promise<Drawing[]> {
  return (await getDb()).getAll('drawings')
}

export async function clearDrawings(): Promise<void> {
  await (await getDb()).clear('drawings')
}

export async function addLog(entry: Omit<ReviewLog, 'id'>): Promise<void> {
  await (await getDb()).add('log', entry)
}

export async function getLogs(): Promise<ReviewLog[]> {
  const db = await getDb()
  return db.getAllFromIndex('log', 'by-timestamp')
}

export async function getSettings(): Promise<Settings> {
  const db = await getDb()
  const saved = await db.get('settings', SETTINGS_KEY)
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    quiz: { ...DEFAULT_SETTINGS.quiz, ...saved?.quiz },
  }
}

export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const db = await getDb()
  const next = { ...(await getSettings()), ...partial }
  await db.put('settings', next, SETTINGS_KEY)
  return next
}

export interface DailyCounts {
  /** New cards introduced today (first answer, prev state 'new'). */
  newToday: number
  /** Review cards answered today (prev state 'review'). */
  reviewsToday: number
}

export async function getDailyCounts(now = Date.now()): Promise<DailyCounts> {
  const start = startOfDay(now)
  const range = IDBKeyRange.bound(start, now)
  const logs = await (await getDb()).getAllFromIndex('log', 'by-timestamp', range)
  let newToday = 0
  let reviewsToday = 0
  for (const log of logs) {
    if (log.prevState === 'new') newToday++
    else if (log.prevState === 'review') reviewsToday++
  }
  return { newToday, reviewsToday }
}

export interface SessionQueue {
  /** Cards in learning/relearning steps whose step has elapsed (same-session). */
  learning: SrsCard[]
  /** Review cards due by the end of today. */
  review: SrsCard[]
  /** New cards to introduce today, up to the daily limit. */
  fresh: SrsCard[]
}

export async function getSessionQueue(now = Date.now()): Promise<SessionQueue> {
  await ensureSeeded()
  const [settings, cards, counts] = await Promise.all([
    getSettings(),
    getAllCards(),
    getDailyCounts(now),
  ])
  const endOfToday = startOfDay(now) + DAY_MS

  const learning = cards
    .filter((c) => (c.state === 'learning' || c.state === 'relearning') && c.due <= now && !c.ignored)
    .sort((a, b) => a.due - b.due)

  const review = cards
    .filter((c) => c.state === 'review' && c.due <= endOfToday && !c.ignored)
    .sort((a, b) => a.due - b.due)
    .slice(0, Math.max(0, settings.reviewLimit - counts.reviewsToday))

  const fresh = cards
    .filter((c) => c.state === 'new' && !c.ignored)
    .sort((a, b) => a.pos - b.pos)
    .slice(0, Math.max(0, settings.newPerDay - counts.newToday))

  return { learning, review, fresh }
}

/** Rate a card and persist the new state together with a log entry. */
export async function answerCard(
  kanji: string,
  rating: Rating,
  now = Date.now(),
): Promise<SrsCard> {
  await ensureSeeded()
  const card = (await getCard(kanji)) ?? createCard(kanji, 0, now)
  const updated = rateCard(card, rating, now)
  await putCard(updated)
  await addLog({
    kanji,
    rating,
    prevState: card.state,
    newState: updated.state,
    interval: updated.interval,
    ease: updated.ease,
    due: updated.due,
    timestamp: now,
  })
  return updated
}

export async function resetProgress(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['cards', 'log'], 'readwrite')
  await Promise.all([tx.objectStore('cards').clear(), tx.objectStore('log').clear()])
  await tx.done
  await ensureSeeded()
}

/**
 * Manually flag a card as "known" (no log entry).
 * `true`: snapshot the current SRS state, then jump to review at/over the known
 * threshold. Re-marking an already-known card never overwrites the snapshot.
 * `false`: restore the snapshotted state (legacy cards without one just lose the flag).
 */
export async function markKnown(
  kanji: string,
  known: boolean,
  now = Date.now(),
): Promise<SrsCard | undefined> {
  const card = await getCard(kanji)
  if (!card) return undefined
  const updated = known ? await applyKnown(card, now) : undoKnown(card)
  await putCard(updated)
  return updated
}

async function applyKnown(card: SrsCard, now: number): Promise<SrsCard> {
  if (card.known && card.knownPrev) return { ...card }
  const { knownThresholdDays } = await getSettings()
  const snapshot: KnownSnapshot = {
    state: card.state,
    step: card.step,
    ease: card.ease,
    interval: card.interval,
    due: card.due,
    reps: card.reps,
    lapses: card.lapses,
  }
  const interval = Math.max(card.interval, knownThresholdDays)
  return {
    ...card,
    known: true,
    knownPrev: snapshot,
    state: 'review',
    step: -1,
    interval,
    due: now + interval * DAY_MS,
  }
}

function undoKnown(card: SrsCard): SrsCard {
  if (!card.knownPrev) return { ...card, known: false }
  return { ...card, ...card.knownPrev, known: false, knownPrev: null }
}

export interface Summary {
  fresh: number
  learning: number
  due: number
  known: number
  /** Graduated review cards not due today, still below the known threshold. */
  future: number
}

/** Lightweight counters for dashboards; `known` = review cards at/over the known threshold. */
export async function getSummary(now = Date.now()): Promise<Summary> {
  await ensureSeeded()
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  const endOfToday = startOfDay(now) + DAY_MS
  const summary: Summary = { fresh: 0, learning: 0, due: 0, known: 0, future: 0 }
  for (const card of cards) {
    if (card.ignored) continue
    if (card.state === 'new') summary.fresh++
    else if (card.state === 'learning' || card.state === 'relearning') summary.learning++
    else {
      if (card.due <= endOfToday) summary.due++
      if (card.known || card.interval >= settings.knownThresholdDays) summary.known++
      else if (card.due > endOfToday) summary.future++
    }
  }
  return summary
}

export interface KnownPool {
  /** Kanji that are "known": interval at/over the threshold or manually marked. */
  kanji: string[]
  thresholdDays: number
}

/**
 * Ban ("Ignore") or un-ban a kanji (no log entry).
 * `true`: an ignored card leaves every queue, pool and summary; if it was
 * marked known, the flag is undone first (restoring the snapshotted state).
 * `false`: the card returns to its normal state-based behavior.
 */
export async function markIgnored(
  kanji: string,
  ignored: boolean,
): Promise<SrsCard | undefined> {
  const card = await getCard(kanji)
  if (!card) return undefined
  const updated = ignored ? { ...undoKnown(card), ignored: true } : { ...card, ignored: false }
  await putCard(updated)
  return updated
}

/**
 * Kanji eligible for quiz pools — only "known" kanji (interval >= threshold
 * or manually marked). Read-only: never modifies cards or logs.
 */
export async function getKnownPool(): Promise<KnownPool> {
  await ensureSeeded()
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  return {
    kanji: cards
      .filter((c) => (c.known || c.interval >= settings.knownThresholdDays) && !c.ignored)
      .sort((a, b) => a.pos - b.pos)
      .map((c) => c.kanji),
    thresholdDays: settings.knownThresholdDays,
  }
}

export interface QuizPools {
  /** Known: flagged as known or interval at/over the known threshold. */
  known: SrsCard[]
  /** In progress: learning/relearning/review, not known, below the threshold. */
  progress: SrsCard[]
  /** Never studied. */
  new: SrsCard[]
}

/**
 * Card pools for quiz setup. Read-only: never modifies cards or logs.
 * Ignored cards are excluded; each pool is sorted by seed position. Returns
 * cards (not kanji) so filters can use `due`/`lapses`/`ease`.
 */
export async function getQuizPools(): Promise<QuizPools> {
  await ensureSeeded()
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  const pools: QuizPools = { known: [], progress: [], new: [] }
  for (const card of cards) {
    if (card.ignored) continue
    if (card.known || card.interval >= settings.knownThresholdDays) pools.known.push(card)
    else if (card.state === 'new') pools.new.push(card)
    else pools.progress.push(card)
  }
  const byPos = (a: SrsCard, b: SrsCard) => a.pos - b.pos
  pools.known.sort(byPos)
  pools.progress.sort(byPos)
  pools.new.sort(byPos)
  return pools
}

function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}