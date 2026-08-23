import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_SETTINGS,
  addLog,
  answerCard,
  clearDrawings,
  closeDb,
  deleteDrawing,
  ensureSeeded,
  getAllCards,
  getAllDrawings,
  getCard,
  getDailyCounts,
  getDrawing,
  getKnownPool,
  getLogs,
  getQuizPools,
  getSeedStamp,
  getSessionQueue,
  getSettings,
  getSummary,
  markIgnored,
  markKnown,
  putCard,
  putDrawing,
  resetProgress,
  setSettings,
} from './db'
import { KANJI_DATA } from './kanji'
import { DEFAULT_QUIZ_CONFIG, type QuizConfig } from './quiz'
import {
  DAY_MS,
  MIN_MS,
  STARTING_EASE,
  bareId,
  cardId,
  createCard,
  rateCard,
  typeOf,
} from './srs'

const NOW = new Date('2026-08-20T12:00:00Z').getTime()

beforeEach(async () => {
  closeDb()
  await resetProgress()
  await setSettings(DEFAULT_SETTINGS)
})

describe('seeding', () => {
  it('seeds one card per kanji and is idempotent', async () => {
    const cards = await getAllCards()
    expect(cards).toHaveLength(KANJI_DATA.length)
    expect(cards[0].id).toBe('k:一')
    expect(cards[0].state).toBe('new')

    await ensureSeeded()
    expect(await getAllCards()).toHaveLength(KANJI_DATA.length)
  })
})

describe('answerCard', () => {
  it('persists the new state and writes a log entry', async () => {
    const updated = await answerCard('k:一', 'good', NOW)
    expect(updated.state).toBe('learning')
    expect(updated.step).toBe(0)
    expect(updated.due).toBe(NOW + MIN_MS)

    const stored = await getCard('k:一')
    expect(stored).toEqual(updated)

    const logs = await getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      cardId: 'k:一',
      rating: 'good',
      prevState: 'new',
      newState: 'learning',
      timestamp: NOW,
    })
  })

  it('keeps updating the same card across ratings', async () => {
    await answerCard('k:一', 'good', NOW)
    const q = await getSessionQueue('kanji', NOW + MIN_MS)
    expect(q.learning.map((c) => c.id)).toContain('k:一')

    await answerCard('k:一', 'again', NOW + MIN_MS)
    const card = await getCard('k:一')
    expect(card!.state).toBe('learning')
    expect(card!.step).toBe(0)
    expect((await getLogs()).length).toBe(2)
  })

  it('rejects answers for never-materialized cards instead of creating ghosts', async () => {
    await expect(answerCard('w:食べる', 'good', NOW)).rejects.toThrow(/unknown card/i)
    expect(await getAllCards()).toHaveLength(KANJI_DATA.length)
    expect(await getLogs()).toHaveLength(0)
  })
})

describe('session queue', () => {
  it('starts with an empty queue and the daily new-card allowance', async () => {
    const q = await getSessionQueue('kanji', NOW)
    expect(q.fresh).toHaveLength(20)
    expect(bareId(q.fresh[0].id)).toBe('一')
    expect(q.review).toHaveLength(0)
    expect(q.learning).toHaveLength(0)
  })

  it('returns learning cards during the same session once each step elapses', async () => {
    const id = cardId('kanji', KANJI_DATA[3].kanji)
    await answerCard(id, 'good', NOW)
    expect((await getSessionQueue('kanji', NOW)).learning.map((c) => c.id)).not.toContain(id)
    expect((await getSessionQueue('kanji', NOW + MIN_MS)).learning.map((c) => c.id)).toContain(id)

    await answerCard(id, 'good', NOW + MIN_MS)
    expect(
      (await getSessionQueue('kanji', NOW + 2 * MIN_MS)).learning.map((c) => c.id),
    ).not.toContain(id)
    expect(
      (await getSessionQueue('kanji', NOW + MIN_MS + 10 * MIN_MS)).learning.map((c) => c.id),
    ).toContain(id)
  })

  it('does not exceed the daily new-card limit', async () => {
    await setSettings({ newPerDay: 2 })
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)
    await answerCard(cardId('kanji', KANJI_DATA[1].kanji), 'good', NOW)
    expect((await getSessionQueue('kanji', NOW)).fresh).toHaveLength(0)
    expect(await getDailyCounts(NOW)).toEqual({ newToday: 2, reviewsToday: 0 })
  })

  it('includes review cards due today and respects the review limit', async () => {
    const [a, b] = [KANJI_DATA[10], KANJI_DATA[11]]
    const ca = await getCard(cardId('kanji', a.kanji))
    const cb = await getCard(cardId('kanji', b.kanji))
    ca!.state = 'review'
    ca!.interval = 30
    ca!.due = NOW - 60_000
    cb!.state = 'review'
    cb!.interval = 30
    cb!.due = NOW - 30_000
    await putCard(ca!)
    await putCard(cb!)

    const q = await getSessionQueue('kanji', NOW)
    expect(q.review.map((c) => c.id).sort()).toEqual([ca!.id, cb!.id].sort())

    await setSettings({ reviewLimit: 1 })
    const limited = await getSessionQueue('kanji', NOW)
    expect(limited.review).toHaveLength(1)
  })

  it('does not include future review cards', async () => {
    const id = cardId('kanji', KANJI_DATA[5].kanji)
    const card = await getCard(id)
    card!.state = 'review'
    card!.interval = 30
    card!.due = NOW + DAY_MS
    await putCard(card!)
    expect((await getSessionQueue('kanji', NOW)).review.map((c) => c.id)).not.toContain(id)
  })

  it('recounts the daily new limit from the log', async () => {
    await setSettings({ newPerDay: 1 })
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)
    const q = await getSessionQueue('kanji', NOW)
    expect(q.fresh).toHaveLength(0)
  })
})

describe('content types', () => {
  /** Synthetic radical cards — no radical deck exists until its own stage seeds one. */
  beforeEach(async () => {
    await putCard(createCard('r:氵', 0, NOW))
    await putCard(createCard('r:木', 1, NOW))
  })

  it('keeps session queues separate per type with independent new-card budgets', async () => {
    await setSettings({ newPerDay: 1 })

    const kanjiQ = await getSessionQueue('kanji', NOW)
    expect(kanjiQ.fresh).toHaveLength(1)
    for (const card of [...kanjiQ.fresh, ...kanjiQ.learning, ...kanjiQ.review]) {
      expect(card.id.startsWith('k:')).toBe(true)
    }

    const radicalQ = await getSessionQueue('radical', NOW)
    expect(radicalQ.fresh.map((c) => c.id)).toEqual(['r:氵'])
    for (const card of [...radicalQ.fresh, ...radicalQ.learning, ...radicalQ.review]) {
      expect(card.id.startsWith('r:')).toBe(true)
    }
  })

  it('routes answers into per-type queues, summaries and daily counts', async () => {
    await answerCard('k:一', 'good', NOW)
    await answerCard('r:氵', 'good', NOW)
    const later = NOW + MIN_MS

    expect((await getSessionQueue('kanji', later)).learning.map((c) => c.id)).toEqual(['k:一'])
    expect((await getSessionQueue('radical', later)).learning.map((c) => c.id)).toEqual(['r:氵'])

    expect(await getDailyCounts(later, 'kanji')).toEqual({ newToday: 1, reviewsToday: 0 })
    expect(await getDailyCounts(later, 'radical')).toEqual({ newToday: 1, reviewsToday: 0 })
    expect(await getDailyCounts(later)).toEqual({ newToday: 2, reviewsToday: 0 })

    const kanjiSummary = await getSummary('kanji', later)
    expect(kanjiSummary.learning).toBe(1)
    expect(kanjiSummary.fresh).toBe(KANJI_DATA.length - 1)
    const radicalSummary = await getSummary('radical', later)
    expect(radicalSummary).toMatchObject({ learning: 1, fresh: 1 })
  })

  it('separates the known pool and keeps non-kanji cards out of quiz pools', async () => {
    await markKnown('r:氵', true)
    expect(await getKnownPool('radical')).toMatchObject({ ids: ['r:氵'] })
    expect(await getKnownPool('kanji')).toMatchObject({ ids: [] })

    await answerCard('r:木', 'good', NOW)
    const pools = await getQuizPools()
    for (const pool of [pools.known, pools.progress, pools.new]) {
      for (const card of pool) expect(typeOf(card.id)).toBe('kanji')
    }
    expect(pools.new.length).toBeGreaterThan(0)
  })
})

describe('settings', () => {
  it('applies defaults and merges partial updates', async () => {
    expect(await getSettings()).toEqual({
      newPerDay: 20,
      reviewLimit: 200,
      knownThresholdDays: 21,
      quiz: DEFAULT_QUIZ_CONFIG,
    })
    await setSettings({ newPerDay: 5 })
    expect(await getSettings()).toEqual({
      newPerDay: 5,
      reviewLimit: 200,
      knownThresholdDays: 21,
      quiz: DEFAULT_QUIZ_CONFIG,
    })
  })
})

describe('quiz settings', () => {
  it('roundtrips a custom quiz config', async () => {
    const quiz: QuizConfig = {
      sources: ['progress', 'new'],
      grades: [3, 4],
      count: 25,
      extraNew: 5,
      dueOnly: true,
      problematicOnly: true,
    }
    await setSettings({ quiz })
    expect((await getSettings()).quiz).toEqual(quiz)
  })

  it('deep-merges DEFAULT_QUIZ_CONFIG into a legacy save written before the field existed', async () => {
    closeDb()
    const raw = await openRawConnection()
    try {
      await rawPut(raw, 'settings', { newPerDay: 7, reviewLimit: 99, knownThresholdDays: 14 }, 'settings')
    } finally {
      raw.close()
    }
    closeDb()

    const settings = await getSettings()
    expect(settings.quiz).toEqual(DEFAULT_QUIZ_CONFIG)
    expect(settings).toMatchObject({ newPerDay: 7, reviewLimit: 99, knownThresholdDays: 14 })
  })
})

describe('quiz pools', () => {
  it('classifies new / progress / known cards, excludes ignored and sorts by pos', async () => {
    // pos 0: learning (progress)
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)
    // pos 1: graduated review below the threshold (progress)
    const below = (await getCard(cardId('kanji', KANJI_DATA[1].kanji)))!
    below.state = 'review'
    below.interval = 5
    below.due = NOW + 3 * DAY_MS
    await putCard(below)
    // pos 2: manually marked known
    await markKnown(cardId('kanji', KANJI_DATA[2].kanji), true, NOW)
    // pos 3: review at the threshold (known without the flag)
    const matured = (await getCard(cardId('kanji', KANJI_DATA[3].kanji)))!
    matured.state = 'review'
    matured.interval = DEFAULT_SETTINGS.knownThresholdDays
    matured.due = NOW + 30 * DAY_MS
    await putCard(matured)
    // pos 4: ignored — must vanish everywhere
    await markIgnored(cardId('kanji', KANJI_DATA[4].kanji), true)

    const pools = await getQuizPools()
    expect(pools.progress.map((c) => c.id)).toEqual([
      cardId('kanji', KANJI_DATA[0].kanji),
      cardId('kanji', KANJI_DATA[1].kanji),
    ])
    expect(pools.known.map((c) => c.id)).toEqual([
      cardId('kanji', KANJI_DATA[2].kanji),
      cardId('kanji', KANJI_DATA[3].kanji),
    ])
    expect(pools.new[0].id).toBe(cardId('kanji', KANJI_DATA[5].kanji))
    for (const pool of [pools.known, pools.progress, pools.new]) {
      const positions = pool.map((c) => c.pos)
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
      for (const card of pool) expect(card.ignored).toBe(false)
    }
    expect(pools.new.map((c) => c.id)).not.toContain(cardId('kanji', KANJI_DATA[4].kanji))
  })

  it('is read-only: repeated calls never change cards or write logs', async () => {
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)
    await getQuizPools()
    await getQuizPools()
    expect(await getLogs()).toHaveLength(1)
    expect(await getAllCards()).toHaveLength(KANJI_DATA.length)
  })
})

describe('summary', () => {
  it('counts fresh/learning/due/known', async () => {
    await setSettings({ knownThresholdDays: 21 })
    expect(await getSummary('kanji', NOW)).toMatchObject({
      fresh: KANJI_DATA.length,
      learning: 0,
      due: 0,
      known: 0,
    })

    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)

    const known = KANJI_DATA[25]
    const card = await getCard(cardId('kanji', known.kanji))
    card!.state = 'review'
    card!.interval = 21
    card!.due = NOW + 30 * DAY_MS
    await putCard(card!)

    const summary = await getSummary('kanji', NOW)
    expect(summary.fresh).toBe(KANJI_DATA.length - 2)
    expect(summary.learning).toBe(1)
    expect(summary.known).toBe(1)
    expect(summary.due).toBe(0)
  })

  it('counts future reviews: graduated, not due today, below the known threshold', async () => {
    await setSettings({ knownThresholdDays: 21 })

    // In the pipeline: graduated, due beyond today, interval below the threshold.
    const future = (await getCard(cardId('kanji', KANJI_DATA[0].kanji)))!
    future.state = 'review'
    future.interval = 5
    future.due = NOW + 3 * DAY_MS
    await putCard(future)

    // Due today -> counts as due, not future.
    const due = (await getCard(cardId('kanji', KANJI_DATA[1].kanji)))!
    due.state = 'review'
    due.interval = 5
    due.due = NOW - 60_000
    await putCard(due)

    // At/over the threshold -> counts as known, not future.
    const matured = (await getCard(cardId('kanji', KANJI_DATA[2].kanji)))!
    matured.state = 'review'
    matured.interval = 21
    matured.due = NOW + 30 * DAY_MS
    await putCard(matured)

    // Manually marked known -> never future.
    const marked = (await getCard(cardId('kanji', KANJI_DATA[3].kanji)))!
    marked.state = 'review'
    marked.interval = 5
    marked.due = NOW + 30 * DAY_MS
    marked.known = true
    await putCard(marked)

    expect(await getSummary('kanji', NOW)).toMatchObject({
      fresh: KANJI_DATA.length - 4,
      learning: 0,
      due: 1,
      known: 2,
      future: 1,
    })
  })
})

describe('known pool', () => {
  it('starts empty and only includes review cards at/over the threshold or manually marked', async () => {
    expect((await getKnownPool('kanji')).ids).toEqual([])

    const atThreshold = await getCard(cardId('kanji', KANJI_DATA[0].kanji))
    atThreshold!.state = 'review'
    atThreshold!.interval = 21
    atThreshold!.due = NOW + 30 * DAY_MS
    await putCard(atThreshold!)

    const belowThreshold = await getCard(cardId('kanji', KANJI_DATA[1].kanji))
    belowThreshold!.state = 'review'
    belowThreshold!.interval = 5
    belowThreshold!.due = NOW - 60_000
    await putCard(belowThreshold!)

    await markKnown(cardId('kanji', KANJI_DATA[2].kanji), true)

    expect((await getKnownPool('kanji')).ids).toEqual([
      cardId('kanji', KANJI_DATA[0].kanji),
      cardId('kanji', KANJI_DATA[2].kanji),
    ])
  })

  it('respects the configurable known threshold from settings', async () => {
    const card = await getCard(cardId('kanji', KANJI_DATA[3].kanji))
    card!.state = 'review'
    card!.interval = 21
    card!.due = NOW + 30 * DAY_MS
    await putCard(card!)

    expect((await getKnownPool('kanji')).ids).toContain(cardId('kanji', KANJI_DATA[3].kanji))
    await setSettings({ knownThresholdDays: 30 })
    expect((await getKnownPool('kanji')).ids).not.toContain(cardId('kanji', KANJI_DATA[3].kanji))
  })

  it('markKnown jumps the card to review at/over the threshold and writes no log', async () => {
    const card = (await getCard('k:一'))!
    card.state = 'learning'
    card.step = 1
    card.due = NOW + MIN_MS
    await putCard(card)

    const updated = (await markKnown('k:一', true, NOW))!
    expect(updated).toMatchObject({
      known: true,
      state: 'review',
      step: -1,
      interval: DEFAULT_SETTINGS.knownThresholdDays,
      due: NOW + DEFAULT_SETTINGS.knownThresholdDays * DAY_MS,
    })
    expect(updated.knownPrev).toEqual({
      state: 'learning',
      step: 1,
      ease: STARTING_EASE,
      interval: 0,
      due: NOW + MIN_MS,
      reps: 0,
      lapses: 0,
    })
    expect(await getLogs()).toHaveLength(0)
  })

  it('re-marking a known card keeps the original snapshot', async () => {
    const card = (await getCard('k:一'))!
    card.state = 'learning'
    card.step = 1
    card.due = NOW + MIN_MS
    await putCard(card)

    const first = (await markKnown('k:一', true, NOW))!
    const again = (await markKnown('k:一', true, NOW))!
    expect(again).toEqual(first)
  })

  it('un-marking restores the exact previous SRS state', async () => {
    const card = (await getCard('k:一'))!
    card.state = 'learning'
    card.step = 1
    card.due = NOW + MIN_MS
    await putCard(card)

    await markKnown('k:一', true, NOW)
    const restored = (await markKnown('k:一', false, NOW))!
    expect(restored).toEqual({ ...card, knownPrev: null })
    expect(restored.state).toBe('learning')
    expect(restored.step).toBe(1)
    expect(await getLogs()).toHaveLength(0)

    expect((await getSessionQueue('kanji', NOW + MIN_MS)).learning.map((c) => c.id)).toContain('k:一')
  })

  it('a marked-known card leaves the session queues and counts as known, not fresh', async () => {
    await markKnown('k:一', true, NOW)

    const q = await getSessionQueue('kanji', NOW)
    expect(q.fresh.map((c) => c.id)).not.toContain('k:一')
    expect(q.review.map((c) => c.id)).not.toContain('k:一')
    expect((await getKnownPool('kanji')).ids).toContain('k:一')

    const summary = await getSummary('kanji', NOW)
    expect(summary.fresh).toBe(KANJI_DATA.length - 1)
    expect(summary.known).toBe(1)
  })

  it('is read-only: repeated calls never change cards or write logs', async () => {
    await getKnownPool('kanji')
    await getKnownPool('kanji')
    expect(await getLogs()).toHaveLength(0)
    expect(await getAllCards()).toHaveLength(KANJI_DATA.length)
    expect(await getCard(cardId('kanji', KANJI_DATA[0].kanji))).toMatchObject({
      state: 'new',
      reps: 0,
      known: false,
    })
  })
})

describe('markIgnored', () => {
  it('excludes the card from queues, pool and summary until un-ignored', async () => {
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)

    const ignored = (await markIgnored(cardId('kanji', KANJI_DATA[0].kanji), true))!
    expect(ignored.ignored).toBe(true)
    expect(await getLogs()).toHaveLength(1)

    expect(
      (await getSessionQueue('kanji', NOW + MIN_MS)).learning.map((c) => c.id),
    ).not.toContain(cardId('kanji', KANJI_DATA[0].kanji))

    await markIgnored(cardId('kanji', KANJI_DATA[1].kanji), true)
    expect((await getSessionQueue('kanji', NOW)).fresh.map((c) => c.id)).not.toContain(
      cardId('kanji', KANJI_DATA[1].kanji),
    )

    const review = (await getCard(cardId('kanji', KANJI_DATA[2].kanji)))!
    review.state = 'review'
    review.interval = 5
    review.due = NOW - 60_000
    await putCard(review)
    await markIgnored(cardId('kanji', KANJI_DATA[2].kanji), true)
    expect((await getSessionQueue('kanji', NOW)).review.map((c) => c.id)).not.toContain(
      cardId('kanji', KANJI_DATA[2].kanji),
    )

    expect(await getKnownPool('kanji')).toEqual({
      ids: [],
      thresholdDays: DEFAULT_SETTINGS.knownThresholdDays,
    })

    expect(await getSummary('kanji', NOW)).toEqual({
      fresh: KANJI_DATA.length - 3,
      learning: 0,
      due: 0,
      known: 0,
      future: 0,
    })

    await markIgnored(cardId('kanji', KANJI_DATA[0].kanji), false)
    expect(
      (await getSessionQueue('kanji', NOW + MIN_MS)).learning.map((c) => c.id),
    ).toContain(cardId('kanji', KANJI_DATA[0].kanji))
  })

  it('ignoring a known card clears known and restores the previous SRS state', async () => {
    const card = (await getCard('k:一'))!
    card.state = 'learning'
    card.step = 1
    card.due = NOW + MIN_MS
    await putCard(card)

    await markKnown('k:一', true, NOW)
    const ignored = (await markIgnored('k:一', true))!
    expect(ignored).toMatchObject({
      ignored: true,
      known: false,
      state: 'learning',
      step: 1,
    })
    expect(ignored.knownPrev).toBeNull()
    expect(await getLogs()).toHaveLength(0)
    expect((await getKnownPool('kanji')).ids).not.toContain('k:一')

    const restored = (await markIgnored('k:一', false))!
    expect(restored).toEqual({ ...card, knownPrev: null })
    expect((await getSessionQueue('kanji', NOW + MIN_MS)).learning.map((c) => c.id)).toContain('k:一')
  })
})

describe('drawings', () => {
  const A = { id: 'k:一', dataUrl: 'data:image/png;base64,AAA', updatedAt: NOW }
  const B = { id: 'k:二', dataUrl: 'data:image/png;base64,BBB', updatedAt: NOW }

  it('puts, gets, updates, lists and deletes drawings', async () => {
    expect(await getDrawing('k:一')).toBeUndefined()
    expect(await getAllDrawings()).toEqual([])

    await putDrawing(A)
    await putDrawing(B)
    expect(await getDrawing('k:一')).toEqual(A)
    expect(await getAllDrawings()).toHaveLength(2)

    const updated = { ...A, dataUrl: 'data:image/png;base64,CCC', updatedAt: NOW + 1 }
    await putDrawing(updated)
    expect(await getDrawing('k:一')).toEqual(updated)
    expect(await getAllDrawings()).toHaveLength(2)

    await deleteDrawing('k:一')
    expect(await getDrawing('k:一')).toBeUndefined()
    expect(await getAllDrawings()).toEqual([B])

    await clearDrawings()
    expect(await getAllDrawings()).toEqual([])
  })

  it('survives closeDb and reopening the database', async () => {
    await putDrawing(A)
    closeDb()
    expect(await getDrawing('k:一')).toEqual(A)
    expect(await getAllDrawings()).toEqual([A])
  })

  it('resetProgress keeps drawings (they are personal notes, not SRS state)', async () => {
    await putDrawing(A)
    await answerCard('k:一', 'good', NOW)
    await resetProgress()
    expect(await getDrawing('k:一')).toEqual(A)
    expect(await getCard('k:一')).toMatchObject({ state: 'new' })
  })
})

describe('v1 → v3 migration', () => {
  it('defaults the v2 fields while renaming keys to namespaced ids', async () => {
    closeDb()
    await deleteDatabase()
    const legacy = await openLegacyV1()
    await rawPut(legacy, 'cards', {
      kanji: '一',
      pos: 0,
      known: false,
      state: 'new',
      step: -1,
      ease: STARTING_EASE,
      interval: 0,
      due: NOW,
      reps: 0,
      lapses: 0,
    })
    legacy.close()

    const card = await getCard('k:一')
    expect(card!.id).toBe('k:一')
    expect(card!.ignored).toBe(false)
    expect(card!.knownPrev).toBeNull()
    expect('kanji' in card!).toBe(false)
  })
})

describe('v2 → v3 migration', () => {
  function openLegacyV2(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('cards', { keyPath: 'kanji' })
        const logStore = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true })
        logStore.createIndex('by-timestamp', 'timestamp')
        db.createObjectStore('settings')
        db.createObjectStore('drawings', { keyPath: 'kanji' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function seedLegacyV2Data(): Promise<void> {
    const legacy = await openLegacyV2()
    try {
      await rawPut(legacy, 'cards', {
        kanji: '一',
        pos: 0,
        known: false,
        ignored: false,
        knownPrev: null,
        state: 'learning',
        step: 0,
        ease: STARTING_EASE,
        interval: 0,
        due: NOW + MIN_MS,
        reps: 1,
        lapses: 0,
      })
      await rawPut(legacy, 'cards', {
        kanji: '二',
        pos: 1,
        known: true,
        ignored: false,
        knownPrev: null,
        state: 'review',
        step: -1,
        ease: STARTING_EASE,
        interval: 21,
        due: NOW + DAY_MS,
        reps: 6,
        lapses: 0,
      })
      await rawPut(legacy, 'drawings', {
        kanji: '二',
        dataUrl: 'data:image/png;base64,BBB',
        updatedAt: NOW,
      })
      await rawPut(legacy, 'log', {
        kanji: '二',
        rating: 'good',
        prevState: 'new',
        newState: 'learning',
        interval: 0,
        ease: STARTING_EASE,
        due: NOW,
        timestamp: NOW - 2000,
      })
      await rawPut(legacy, 'log', {
        kanji: '二',
        rating: 'good',
        prevState: 'learning',
        newState: 'review',
        interval: 4,
        ease: STARTING_EASE,
        due: NOW + 4 * DAY_MS,
        timestamp: NOW - 1000,
      })
    } finally {
      legacy.close()
    }
  }

  it('rebuilds stores under namespaced ids and renames log kanji → cardId (#16)', async () => {
    expect(DB_VERSION).toBe(3)
    closeDb()
    await deleteDatabase()
    await seedLegacyV2Data()

    // Opening through the app layer triggers the upgrade.
    const learning = await getCard('k:一')
    expect(learning).toMatchObject({
      id: 'k:一',
      pos: 0,
      state: 'learning',
      step: 0,
      due: NOW + MIN_MS,
      reps: 1,
    })
    expect('kanji' in learning!).toBe(false)

    const review = await getCard('k:二')
    expect(review).toMatchObject({ id: 'k:二', state: 'review', interval: 21, known: true })

    expect(await getDrawing('k:二')).toEqual({
      id: 'k:二',
      dataUrl: 'data:image/png;base64,BBB',
      updatedAt: NOW,
    })

    const logs = await getLogs()
    expect(logs.map((l) => l.cardId)).toEqual(['k:二', 'k:二'])
    for (const log of logs) expect('kanji' in log).toBe(false)

    // The autoincrement sequence continues after the rewritten rows.
    await addLog({
      cardId: 'k:一',
      rating: 'good',
      prevState: 'new',
      newState: 'learning',
      interval: 0,
      ease: STARTING_EASE,
      due: NOW + MIN_MS,
      timestamp: NOW,
    })
    expect((await getLogs()).map((l) => l.id)).toEqual([1, 2, 3])
  })

  it('adopts pre-stamp databases: stamps kanji as seeded without reseeding over progress', async () => {
    closeDb()
    await deleteDatabase()
    await seedLegacyV2Data()

    await ensureSeeded()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji'] })
    expect(await getAllCards()).toHaveLength(2)
    expect(await getCard('k:一')).toMatchObject({ state: 'learning' })

    // The adoption survives a simulated reload.
    closeDb()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji'] })
    expect(await getAllCards()).toHaveLength(2)
  })
})

describe('seed stamp', () => {
  it('is written by ensureSeeded and survives a reload', async () => {
    await ensureSeeded()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji'] })
    closeDb()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji'] })
  })

  it('resetProgress clears the stamp so every range reseeds', async () => {
    await answerCard('k:一', 'easy', NOW)
    await resetProgress()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji'] })
    expect(await getCard('k:一')).toMatchObject({ state: 'new', reps: 0, known: false })
    expect(await getLogs()).toHaveLength(0)
    expect(await getAllCards()).toHaveLength(KANJI_DATA.length)
  })
})

describe('persistence across reload', () => {
  it('survives closing the connection and reopening on a fresh load', async () => {
    await answerCard('k:一', 'good', NOW)
    await setSettings({ newPerDay: 5 })
    closeDb()

    const raw = await openRawConnection()
    try {
      const stored = (await rawGet(raw, 'cards', 'k:一')) as { state: string; reps: number }
      expect(stored.state).toBe('learning')
      expect(stored.reps).toBe(1)
    } finally {
      raw.close()
    }

    closeDb()
    expect(await getSettings()).toMatchObject({ newPerDay: 5 })
    expect(await getCard('k:一')).toMatchObject({ state: 'learning' })
  })
})

describe('resetProgress', () => {
  it('clears cards and log, then reseeds', async () => {
    await answerCard('k:一', 'easy', NOW)
    await markKnown('k:一', true)
    await resetProgress()
    expect(await getCard('k:一')).toMatchObject({ state: 'new', reps: 0, known: false })
    expect(await getLogs()).toHaveLength(0)
    expect(await getAllCards()).toHaveLength(KANJI_DATA.length)
  })
})

describe('session round-trip', () => {
  it('persists cards rated through the raw srs module like the UI would', async () => {
    const first = KANJI_DATA[0]
    const second = KANJI_DATA[1]

    const card = (await getCard(cardId('kanji', first.kanji)))!
    await putCard(rateCard(card, 'good', NOW))
    await answerCard(cardId('kanji', second.kanji), 'good', NOW)

    const q = await getSessionQueue('kanji', NOW + 10 * MIN_MS + 1)
    expect(q.learning.map((c) => c.id).sort()).toEqual(
      [cardId('kanji', first.kanji), cardId('kanji', second.kanji)].sort(),
    )
  })
})

function openRawConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve(undefined)
    req.onerror = () => reject(req.error)
  })
}

function openLegacyV1(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('cards', { keyPath: 'kanji' })
      const logStore = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true })
      logStore.createIndex('by-timestamp', 'timestamp')
      db.createObjectStore('settings')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function rawPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    if (key === undefined) os.put(value)
    else os.put(value, key)
    tx.oncomplete = () => resolve(undefined)
    tx.onerror = () => reject(tx.error)
  })
}

function rawGet(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
