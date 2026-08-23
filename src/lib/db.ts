import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import {
  createCard,
  cardId,
  typeOf,
  bareId,
  DAY_MS,
  rateCard,
  type CardState,
  type ContentType,
  type KnownSnapshot,
  type Rating,
  type SrsCard,
} from './srs'
import { KANJI_DATA, getKanji } from './kanji'
import { RADICALS_DATA } from './radicals'
import { VOCAB_DATA } from './vocab'
import { DEFAULT_QUIZ_CONFIG, type QuizConfig } from './quiz'
import { buildGateContext, isComponentSeen, isKanjiUnlocked, isVocabUnlocked } from './gating'

export const DB_NAME = 'ankijp'
export const DB_VERSION = 3
const SETTINGS_KEY = 'settings'
const SEED_STAMP_KEY = 'seed-stamp'

export interface Settings {
  /** Daily budget of new kanji cards. */
  newPerDay: number
  /** Daily budgets of the lighter card types — deliberately higher than kanji's. */
  newPerDayRadical: number
  newPerDayVocab: number
  reviewLimit: number
  knownThresholdDays: number
  quiz: QuizConfig
}

/**
 * Marks which content ranges have already been seeded (stored in the settings
 * store). Lets future seeds top up existing databases instead of being blocked
 * by the old "cards exist" early return.
 */
export interface SeedStamp {
  seeded: ContentType[]
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 20,
  newPerDayRadical: 60,
  newPerDayVocab: 40,
  reviewLimit: 200,
  knownThresholdDays: 21,
  quiz: DEFAULT_QUIZ_CONFIG,
}

/** Per-type daily budgets for new cards; the review limit stays global. */
const NEW_PER_DAY: Record<ContentType, 'newPerDay' | 'newPerDayRadical' | 'newPerDayVocab'> = {
  kanji: 'newPerDay',
  radical: 'newPerDayRadical',
  vocab: 'newPerDayVocab',
}

export interface ReviewLog {
  id?: number
  /** Namespaced id of the answered card (the autoincrement key owns `id`). */
  cardId: string
  rating: Rating
  prevState: CardState
  newState: CardState
  interval: number
  ease: number
  due: number
  timestamp: number
}

/** User-drawn mnemonic sketch for a card (F3 drawing pad). */
export interface Drawing {
  id: string
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
    value: Settings | SeedStamp
  }
  drawings: {
    key: string
    value: Drawing
  }
}

/** Pre-v3 records keyed/labelled by a bare glyph. */
interface LegacyGlyphRecord {
  kanji: string
  [key: string]: unknown
}

let dbPromise: Promise<IDBPDatabase<AnkiJpDB>> | null = null

function getDb(): Promise<IDBPDatabase<AnkiJpDB>> {
  dbPromise ??= openDB<AnkiJpDB>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      const hadCards = db.objectStoreNames.contains('cards')
      const hadLog = db.objectStoreNames.contains('log')
      const hadDrawings = db.objectStoreNames.contains('drawings')

      if (!hadCards) {
        db.createObjectStore('cards', { keyPath: 'id' })
      }
      if (!hadLog) {
        const logStore = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true })
        logStore.createIndex('by-timestamp', 'timestamp')
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings')
      }
      // Reserved for the drawing pad (F3); created alongside the v2 bump.
      if (!hadDrawings) {
        db.createObjectStore('drawings', { keyPath: 'id' })
      }

      if (oldVersion < 2 && hadCards) {
        // v1 → v2: default the fields introduced in v2.
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

      if (oldVersion < 3 && (hadCards || hadLog || hadDrawings)) {
        // v2 → v3: card ids become namespaced (`k:一`). cards/drawings move to
        // keyPath 'id'; IndexedDB cannot rewrite a keyPath in place, so both
        // stores are rebuilt within this upgrade transaction. Log values
        // rename `kanji` → `cardId` with the same prefix — the store's own
        // autoincrement key already occupies `id`.
        const legacyCards = hadCards
          ? ((await tx.objectStore('cards').getAll()) as unknown as LegacyGlyphRecord[])
          : []
        const legacyDrawings = hadDrawings
          ? ((await tx.objectStore('drawings').getAll()) as unknown as LegacyGlyphRecord[])
          : []
        const legacyLogs = hadLog
          ? ((await tx.objectStore('log').getAll()) as unknown as LegacyGlyphRecord[])
          : []

        if (hadCards) db.deleteObjectStore('cards')
        if (hadDrawings) db.deleteObjectStore('drawings')

        if (hadCards) {
          const store = db.createObjectStore('cards', { keyPath: 'id' })
          for (const { kanji, ...rest } of legacyCards) {
            await store.put({ ...rest, id: `k:${kanji}` } as SrsCard)
          }
        }
        if (hadDrawings) {
          const store = db.createObjectStore('drawings', { keyPath: 'id' })
          for (const { kanji, ...rest } of legacyDrawings) {
            await store.put({ ...rest, id: `k:${kanji}` } as Drawing)
          }
        }
        if (hadLog) {
          const store = tx.objectStore('log')
          for (const { kanji, ...rest } of legacyLogs) {
            await store.put({ ...rest, cardId: `k:${kanji}` } as ReviewLog)
          }
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

async function readSeedStamp(db: IDBPDatabase<AnkiJpDB>): Promise<Set<ContentType>> {
  const raw = (await db.get('settings', SEED_STAMP_KEY)) as SeedStamp | undefined
  return new Set(raw?.seeded ?? [])
}

/** Current seed stamp — which content ranges have been seeded into this database. */
export async function getSeedStamp(): Promise<SeedStamp> {
  return { seeded: [...await readSeedStamp(await getDb())] }
}

async function stampSeeded(db: IDBPDatabase<AnkiJpDB>, type: ContentType): Promise<void> {
  const seeded = await readSeedStamp(db)
  if (seeded.has(type)) return
  const next = { seeded: [...seeded, type] } satisfies SeedStamp
  await db.put('settings', next, SEED_STAMP_KEY)
}

/**
 * Seed missing content ranges from bundled data. Idempotent, driven by the
 * seed stamp so future ranges can top up databases that already have cards.
 * Databases predating stamps carry cards without a stamp: they are adopted
 * (marked as seeded) instead of reseeded over live progress.
 */
export async function ensureSeeded(): Promise<void> {
  const db = await getDb()
  const seeded = await readSeedStamp(db)
  if (!seeded.has('kanji')) {
    if ((await db.count('cards')) === 0) {
      const now = Date.now()
      const tx = db.transaction('cards', 'readwrite')
      KANJI_DATA.forEach((entry, pos) => {
        tx.store.put(createCard(cardId('kanji', entry.kanji), pos, now))
      })
      await tx.done
    }
    await stampSeeded(db, 'kanji')
  }
  if (!seeded.has('radical')) {
    await seedRadicals()
    await stampSeeded(db, 'radical')
  }
  // Vocabulary is never stamped: its materialization is continuous, driven by
  // gating and the daily budget (every queue/summary/pool build lands here).
  await materializeVocab(Date.now())
}

/**
 * Lazy vocab seeding (Etap 4): walk the ranked vocabulary and materialize one
 * card per word whose kanji have all been seen (#8 — no exceptions; pure-kana
 * words pass trivially, #12). The daily budget caps the *inventory* of
 * outstanding new word cards: every rebuild tops it back up, so answering the
 * last kanji of a word makes that word jump in at the very next queue build,
 * while introductions themselves stay capped by the fresh-queue slice.
 * Idempotent: an existing card — whatever its state — is never recreated;
 * `pos` is the word's rank in the top-2000 (decision #15).
 */
async function materializeVocab(now: number): Promise<void> {
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  let room = settings.newPerDayVocab
  const existing = new Set<string>()
  for (const card of cards) {
    if (typeOf(card.id) !== 'vocab') continue
    existing.add(card.id)
    if (!card.ignored && card.state === 'new') room--
  }
  if (room <= 0) return
  const ctx = buildGateContext(cards)
  const fresh: SrsCard[] = []
  for (const [pos, entry] of VOCAB_DATA.entries()) {
    if (fresh.length >= room) break
    if (existing.has(cardId('vocab', entry.id))) continue
    if (!isVocabUnlocked(entry, ctx)) continue
    fresh.push(createCard(cardId('vocab', entry.id), pos, now))
  }
  await bulkPutCards(fresh)
}

/**
 * Materialize every radical card (decision #18: the components of the final
 * deck), then apply migration rule B (decision #11): components of all seen
 * kanji start as known through the shared `isComponentSeen` predicate. Runs
 * once per database; fresh installs have no seen kanji, so nothing is skipped.
 */
async function seedRadicals(): Promise<void> {
  const now = Date.now()
  const ctx = buildGateContext(await getAllCards())
  const { knownThresholdDays } = await getSettings()
  const cards: SrsCard[] = RADICALS_DATA.map((entry, pos) => {
    let card = createCard(cardId('radical', entry.glyph), pos, now)
    if (isComponentSeen(entry.glyph, ctx)) card = applyKnown(card, knownThresholdDays, now)
    return card
  })
  await bulkPutCards(cards)
}

export async function getCard(id: string): Promise<SrsCard | undefined> {
  return (await getDb()).get('cards', id)
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

export async function getDrawing(id: string): Promise<Drawing | undefined> {
  return (await getDb()).get('drawings', id)
}

export async function putDrawing(drawing: Drawing): Promise<void> {
  await (await getDb()).put('drawings', drawing)
}

export async function deleteDrawing(id: string): Promise<void> {
  await (await getDb()).delete('drawings', id)
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
  // The settings store also hosts the seed stamp; narrow to the settings record.
  const saved = (await db.get('settings', SETTINGS_KEY)) as Settings | undefined
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

/**
 * Today's counts from the log. With `type`, both counters cover only that
 * content type (via the id prefix); without it, all types are aggregated.
 */
export async function getDailyCounts(now = Date.now(), type?: ContentType): Promise<DailyCounts> {
  const start = startOfDay(now)
  const range = IDBKeyRange.bound(start, now)
  const logs = await (await getDb()).getAllFromIndex('log', 'by-timestamp', range)
  let newToday = 0
  let reviewsToday = 0
  for (const log of logs) {
    if (type !== undefined && typeOf(log.cardId) !== type) continue
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

/**
 * Build the session queue for one content type. The daily new-card budget is
 * per type (kanji `newPerDay`, radicals/vocab their own settings); the review
 * limit stays global across types. New kanji are gated: a kanji only enters
 * the fresh queue once all of its components have been seen (#3, via the same
 * predicate as migration rule B).
 */
export async function getSessionQueue(
  type: ContentType = 'kanji',
  now = Date.now(),
): Promise<SessionQueue> {
  await ensureSeeded()
  const [settings, cards, counts, globalCounts] = await Promise.all([
    getSettings(),
    getAllCards(),
    getDailyCounts(now, type),
    getDailyCounts(now),
  ])
  const endOfToday = startOfDay(now) + DAY_MS
  const ofType = cards.filter((c) => typeOf(c.id) === type && !c.ignored)
  const gateCtx = type === 'kanji' ? buildGateContext(cards) : null

  const learning = ofType
    .filter((c) => c.state === 'learning' || c.state === 'relearning')
    .filter((c) => c.due <= now)
    .sort((a, b) => a.due - b.due)

  const review = ofType
    .filter((c) => c.state === 'review' && c.due <= endOfToday)
    .sort((a, b) => a.due - b.due)
    .slice(0, Math.max(0, settings.reviewLimit - globalCounts.reviewsToday))

  const freshLimitKey = NEW_PER_DAY[type]
  const fresh = ofType
    .filter((c) => c.state === 'new')
    .sort((a, b) => a.pos - b.pos)
    .filter((c) => gateCtx === null || isKanjiUnlocked(getKanji(bareId(c.id)), gateCtx))
    .slice(0, Math.max(0, settings[freshLimitKey] - counts.newToday))

  return { learning, review, fresh }
}

/**
 * Rate a card and persist the new state together with a log entry.
 * Answering a card that was never materialized is an error — no ghost cards.
 * When a kanji crosses the known threshold, its identity radical `r:X` is
 * auto-marked known (decision #9) so the same fact is never reviewed twice.
 */
export async function answerCard(
  id: string,
  rating: Rating,
  now = Date.now(),
): Promise<SrsCard> {
  await ensureSeeded()
  const card = await getCard(id)
  if (!card) throw new Error(`Cannot answer unknown card: ${id}`)
  const updated = rateCard(card, rating, now)
  await putCard(updated)
  await addLog({
    cardId: id,
    rating,
    prevState: card.state,
    newState: updated.state,
    interval: updated.interval,
    ease: updated.ease,
    due: updated.due,
    timestamp: now,
  })
  if (typeOf(id) === 'kanji') {
    const { knownThresholdDays } = await getSettings()
    const crossed =
      !isKnownState(card, knownThresholdDays) && isKnownState(updated, knownThresholdDays)
    if (crossed) await propagateKnownToIdentityRadical(bareId(id), knownThresholdDays, now)
  }
  return updated
}

export async function resetProgress(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['cards', 'log', 'settings'], 'readwrite')
  await Promise.all([
    tx.objectStore('cards').clear(),
    tx.objectStore('log').clear(),
    // Clear the seed stamp too so ensureSeeded reseeds every range.
    tx.objectStore('settings').delete(SEED_STAMP_KEY),
  ])
  await tx.done
  await ensureSeeded()
}

/**
 * Manually flag a card as "known" (no log entry).
 * `true`: snapshot the current SRS state, then jump to review at/over the known
 * threshold. Re-marking an already-known card never overwrites the snapshot.
 * `false`: restore the snapshotted state (legacy cards without one just lose the flag).
 * Marking a kanji known also marks its identity radical `r:X` (decision #9);
 * un-marking never reverses that.
 */
export async function markKnown(
  id: string,
  known: boolean,
  now = Date.now(),
): Promise<SrsCard | undefined> {
  const card = await getCard(id)
  if (!card) return undefined
  const { knownThresholdDays } = await getSettings()
  const updated = known ? applyKnown(card, knownThresholdDays, now) : undoKnown(card)
  await putCard(updated)
  if (known && typeOf(id) === 'kanji') {
    await propagateKnownToIdentityRadical(bareId(id), knownThresholdDays, now)
  }
  return updated
}

/** A card counts as known when flagged or when its interval reached the threshold. */
function isKnownState(card: SrsCard, thresholdDays: number): boolean {
  return card.known || card.interval >= thresholdDays
}

/**
 * Decision #9: when kanji `X` becomes known, `r:X` becomes known too — once,
 * without a reverse transition on un-knowing. No-op when the radical card does
 * not exist (kanji that are nobody's component) or is already known.
 */
async function propagateKnownToIdentityRadical(
  glyph: string,
  thresholdDays: number,
  now: number,
): Promise<void> {
  const radicalId = cardId('radical', glyph)
  const radical = await getCard(radicalId)
  if (!radical || radical.known) return
  await putCard(applyKnown(radical, thresholdDays, now))
}

function applyKnown(card: SrsCard, thresholdDays: number, now: number): SrsCard {
  if (card.known && card.knownPrev) return { ...card }
  const snapshot: KnownSnapshot = {
    state: card.state,
    step: card.step,
    ease: card.ease,
    interval: card.interval,
    due: card.due,
    reps: card.reps,
    lapses: card.lapses,
  }
  const interval = Math.max(card.interval, thresholdDays)
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
export async function getSummary(
  type: ContentType = 'kanji',
  now = Date.now(),
): Promise<Summary> {
  await ensureSeeded()
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  const endOfToday = startOfDay(now) + DAY_MS
  const summary: Summary = { fresh: 0, learning: 0, due: 0, known: 0, future: 0 }
  for (const card of cards) {
    if (card.ignored || typeOf(card.id) !== type) continue
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
  /** Cards that are "known": interval at/over the threshold or manually marked. */
  ids: string[]
  thresholdDays: number
}

/**
 * Ban ("Ignore") or un-ban a card (no log entry).
 * `true`: an ignored card leaves every queue, pool and summary; if it was
 * marked known, the flag is undone first (restoring the snapshotted state).
 * `false`: the card returns to its normal state-based behavior.
 * Radicals cannot be ignored (decision #10): banning a component would lock
 * its kanji forever — only "Mark as known" is offered for them.
 */
export async function markIgnored(
  id: string,
  ignored: boolean,
): Promise<SrsCard | undefined> {
  if (typeOf(id) === 'radical') throw new Error(`Radicals cannot be ignored: ${id}`)
  const card = await getCard(id)
  if (!card) return undefined
  const updated = ignored ? { ...undoKnown(card), ignored: true } : { ...card, ignored: false }
  await putCard(updated)
  return updated
}

/**
 * Cards eligible for quiz pools of one content type — only "known" cards
 * (interval >= threshold or manually marked). Read-only: never modifies
 * cards or logs.
 */
export async function getKnownPool(type: ContentType = 'kanji'): Promise<KnownPool> {
  await ensureSeeded()
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  return {
    ids: cards
      .filter(
        (c) =>
          typeOf(c.id) === type &&
          !c.ignored &&
          (c.known || c.interval >= settings.knownThresholdDays),
      )
      .sort((a, b) => a.pos - b.pos)
      .map((c) => c.id),
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
 * Card pools for quiz setup of one content type. Read-only: never modifies
 * cards or logs. The kanji-specific parts of the quiz pipeline (grades,
 * `getKanji`, cloze) live in the quiz layer. Ignored cards are excluded; each
 * pool is sorted by study position. Returns cards (not ids) so filters can
 * use `due`/`lapses`/`ease`.
 */
export async function getQuizPools(type: ContentType = 'kanji'): Promise<QuizPools> {
  await ensureSeeded()
  const [settings, cards] = await Promise.all([getSettings(), getAllCards()])
  const pools: QuizPools = { known: [], progress: [], new: [] }
  for (const card of cards) {
    if (card.ignored || typeOf(card.id) !== type) continue
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