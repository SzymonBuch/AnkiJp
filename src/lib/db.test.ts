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
  deleteCard,
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
import { RADICALS_DATA, getRadicalDependencies } from './radicals'
import { VOCAB_DATA } from './vocab'
import { DEFAULT_QUIZ_CONFIG, type QuizConfig } from './quiz'
import { TYPE_RANK } from './mixed'
import { buildGateContext, isKanjiUnlocked } from './gating'
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
  it('seeds one card per kanji and per radical and is idempotent', async () => {
    const cards = await getAllCards()
    expect(cards.filter((c) => typeOf(c.id) === 'kanji')).toHaveLength(KANJI_DATA.length)
    expect(cards.filter((c) => typeOf(c.id) === 'radical')).toHaveLength(RADICALS_DATA.length)
    expect(cards[0].id).toBe('k:一')
    expect(cards[0].state).toBe('new')

    // Vocab materialization is continuous (Etap 4), so totals are compared
    // per run: a second pass must not duplicate anything.
    const total = cards.length
    await ensureSeeded()
    expect(await getAllCards()).toHaveLength(total)
  })

  it('seeds radicals in usage-ranking order with fresh states', async () => {
    const radicalCards = (await getAllCards())
      .filter((c) => typeOf(c.id) === 'radical')
      .sort((a, b) => a.pos - b.pos)
    expect(radicalCards).toHaveLength(RADICALS_DATA.length)
    // pos mirrors the bundled usage ranking (decision #15).
    expect(radicalCards.map((c) => c.id)).toEqual(RADICALS_DATA.map((r) => `r:${r.glyph}`))
    for (const card of radicalCards) {
      expect(card.state).toBe('new')
      expect(card.known).toBe(false)
    }
  })

  it('tops up missing radicals without overwriting existing progress', async () => {
    const target = RADICALS_DATA[0]
    const existing = (await getCard(`r:${target.glyph}`))!
    existing.state = 'review'
    existing.interval = 9
    existing.reps = 4
    await putCard(existing)
    await deleteCard(`r:${RADICALS_DATA[1].glyph}`)

    await ensureSeeded()

    expect(await getCard(existing.id)).toEqual(existing)
    expect(await getCard(`r:${RADICALS_DATA[1].glyph}`)).toMatchObject({ state: 'new' })
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
    // 食べる is in the vocab ranking but stays unmaterialized until 食 is seen.
    await expect(answerCard('w:食べる', 'good', NOW)).rejects.toThrow(/unknown card/i)
    expect(await getCard('w:食べる')).toBeUndefined()
    expect((await getAllCards()).filter((c) => typeOf(c.id) !== 'vocab')).toHaveLength(
      KANJI_DATA.length + RADICALS_DATA.length,
    )
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
  /** A kanji with distinct components, so gating scenarios are controllable. */
  const GATED = KANJI_DATA.find((e) =>
    e.radicals.some((r) => r.glyph !== e.kanji && RADICALS_DATA.some((x) => x.glyph === r.glyph)),
  )!
  const GATED_COMPONENTS = GATED.radicals
    .filter((r) => r.glyph !== GATED.kanji)
    .map((r) => r.glyph)
    .filter((glyph) => RADICALS_DATA.some((x) => x.glyph === glyph))

  it('keeps session queues separate per type with independent new-card budgets', async () => {
    await setSettings({ newPerDay: 5, newPerDayRadical: 3 })

    const kanjiQ = await getSessionQueue('kanji', NOW)
    expect(kanjiQ.fresh).toHaveLength(5)
    for (const card of [...kanjiQ.fresh, ...kanjiQ.learning, ...kanjiQ.review]) {
      expect(card.id.startsWith('k:')).toBe(true)
    }

    // Radicals follow their usage ranking: most-used components first.
    const radicalQ = await getSessionQueue('radical', NOW)
    expect(radicalQ.fresh.map((c) => c.id)).toEqual(
      RADICALS_DATA.slice(0, 3).map((r) => `r:${r.glyph}`),
    )
    for (const card of [...radicalQ.fresh, ...radicalQ.learning, ...radicalQ.review]) {
      expect(card.id.startsWith('r:')).toBe(true)
    }
  })

  it('routes answers into per-type queues, summaries and daily counts', async () => {
    await answerCard('k:一', 'good', NOW)
    await answerCard(`r:${RADICALS_DATA[0].glyph}`, 'good', NOW)
    const later = NOW + MIN_MS

    expect((await getSessionQueue('kanji', later)).learning.map((c) => c.id)).toEqual(['k:一'])
    expect((await getSessionQueue('radical', later)).learning.map((c) => c.id)).toEqual([
      `r:${RADICALS_DATA[0].glyph}`,
    ])

    expect(await getDailyCounts(later, 'kanji')).toEqual({ newToday: 1, reviewsToday: 0 })
    expect(await getDailyCounts(later, 'radical')).toEqual({ newToday: 1, reviewsToday: 0 })
    expect(await getDailyCounts(later)).toEqual({ newToday: 2, reviewsToday: 0 })

    const kanjiSummary = await getSummary('kanji', later)
    expect(kanjiSummary.learning).toBe(1)
    const radicalSummary = await getSummary('radical', later)
    expect(radicalSummary.learning).toBe(1)
    expect(radicalSummary.fresh).toBe(RADICALS_DATA.length - 1)
  })

  it('separates the known pool and keeps non-kanji cards out of kanji quiz pools', async () => {
    const topGlyph = RADICALS_DATA[0].glyph
    await markKnown(`r:${topGlyph}`, true)
    expect(await getKnownPool('radical')).toMatchObject({ ids: [`r:${topGlyph}`] })
    expect(await getKnownPool('kanji')).toMatchObject({ ids: [] })

    const secondGlyph = RADICALS_DATA[1].glyph
    await answerCard(`r:${secondGlyph}`, 'good', NOW)
    const pools = await getQuizPools()
    for (const pool of [pools.known, pools.progress, pools.new]) {
      for (const card of pool) expect(typeOf(card.id)).toBe('kanji')
    }
    expect(pools.new.length).toBeGreaterThan(0)

    // Radical pools exist symmetrically for the radical quiz.
    const radicalPools = await getQuizPools('radical')
    expect(radicalPools.new.map((c) => c.id)).not.toContain(`r:${topGlyph}`)
    expect(radicalPools.known.map((c) => c.id)).toContain(`r:${topGlyph}`)
  })

  describe('gating (decision #3)', () => {
    it('withholds gated kanji from the fresh queue until every component is seen', async () => {
      await setSettings({ newPerDayRadical: 60 })

      // Nothing studied yet: the gated kanji must not be introducible…
      let q = await getSessionQueue('kanji', NOW)
      expect(q.fresh.map((c) => c.id)).not.toContain(cardId('kanji', GATED.kanji))
      // …while the components themselves are queued by usage rank.
      const radicalFresh = (await getSessionQueue('radical', NOW)).fresh.map((c) => bareId(c.id))
      expect(GATED_COMPONENTS.some((glyph) => radicalFresh.includes(glyph))).toBe(true)

      // Study one component: still gated by the rest.
      await answerCard(cardId('radical', GATED_COMPONENTS[0]), 'good', NOW)
      q = await getSessionQueue('kanji', NOW)
      if (GATED_COMPONENTS.length > 1) {
        expect(q.fresh.map((c) => c.id)).not.toContain(cardId('kanji', GATED.kanji))
      }

      // Study the remaining components: the kanji unlocks mid-session.
      for (const glyph of GATED_COMPONENTS.slice(1)) {
        await answerCard(cardId('radical', glyph), 'good', NOW)
      }
      q = await getSessionQueue('kanji', NOW + MIN_MS)
      expect(q.fresh.map((c) => c.id)).toContain(cardId('kanji', GATED.kanji))
    })

    it('does not touch learning/review queues — gating only delays introduction', async () => {
      const card = (await getCard(cardId('kanji', GATED.kanji)))!
      card.state = 'review'
      card.interval = 5
      card.due = NOW - 60_000
      await putCard(card)
      const q = await getSessionQueue('kanji', NOW)
      expect(q.review.map((c) => c.id)).toContain(cardId('kanji', GATED.kanji))
    })
  })

  describe('radical gating', () => {
    it('does not queue a new dependent radical before its direct components', async () => {
      await setSettings({ newPerDayRadical: RADICALS_DATA.length })
      expect((await getSessionQueue('radical', NOW)).fresh.map((c) => c.id)).not.toContain('r:動')
    })

    it('allows an existing learning card despite radical gating', async () => {
      const target = (await getCard('r:動'))!
      target.state = 'learning'
      target.step = 0
      target.due = NOW - 1
      await putCard(target)
      expect((await getSessionQueue('radical', NOW)).learning.map((c) => c.id)).toContain('r:動')
    })

    it('unlocks a dependent radical after its direct components are seen', async () => {
      await setSettings({ newPerDayRadical: RADICALS_DATA.length })
      for (const glyph of getRadicalDependencies('動')) {
        const dependency = (await getCard(`r:${glyph}`))!
        await putCard({ ...dependency, state: 'learning', step: 0, due: NOW })
      }
      expect((await getSessionQueue('radical', NOW)).fresh.map((c) => c.id)).toContain('r:動')
    })
  })

  describe('per-type daily limits (Etap 2 settings)', () => {
    it('uses the radical limit for radical queues without touching the kanji limit', async () => {
      await setSettings({ newPerDayRadical: 2 })
      const q = await getSessionQueue('radical', NOW)
      expect(q.fresh).toHaveLength(2)
    })

    it('recounts the radical budget from today’s log', async () => {
      await setSettings({ newPerDayRadical: 1 })
      await answerCard(`r:${RADICALS_DATA[0].glyph}`, 'good', NOW)
      expect((await getSessionQueue('radical', NOW)).fresh).toHaveLength(0)
    })
  })

  describe('auto-known propagation (decision #9)', () => {
    /** A kanji whose glyph doubles as a component, so `r:X` exists. */
    const HOST = KANJI_DATA.find((e) => RADICALS_DATA.some((r) => r.glyph === e.kanji))!

    it('marks the identity radical known when a kanji crosses the threshold via an answer', async () => {
      // Interval 20 with ease 130 grows past the 21-day threshold on Good.
      const card = (await getCard(cardId('kanji', HOST.kanji)))!
      card.state = 'review'
      card.interval = 20
      card.ease = 130
      card.due = NOW - 60_000
      await putCard(card)

      expect((await getCard(`r:${HOST.kanji}`))!.known).toBe(false)
      await answerCard(cardId('kanji', HOST.kanji), 'good', NOW)
      const radical = (await getCard(`r:${HOST.kanji}`))!
      expect(radical.known).toBe(true)
      expect(radical.state).toBe('review')
      expect(radical.interval).toBe(DEFAULT_SETTINGS.knownThresholdDays)
    })

    it('marks the identity radical known on manual markKnown, without undoing it later', async () => {
      await markKnown(cardId('kanji', HOST.kanji), true, NOW)
      expect((await getCard(`r:${HOST.kanji}`))!.known).toBe(true)

      // Un-knowing the kanji never reverses the radical (#9).
      await markKnown(cardId('kanji', HOST.kanji), false, NOW)
      expect((await getCard(cardId('kanji', HOST.kanji)))!.known).toBe(false)
      expect((await getCard(`r:${HOST.kanji}`))!.known).toBe(true)
    })

    it('tolerates kanji without an identity radical card', async () => {
      const loner = KANJI_DATA.find((e) => !RADICALS_DATA.some((r) => r.glyph === e.kanji))
      if (!loner) return
      const updated = (await markKnown(cardId('kanji', loner.kanji), true, NOW))!
      expect(updated.known).toBe(true)
    })
  })

  describe('no Ignore for radicals (decision #10)', () => {
    it('markIgnored rejects radical ids outright', async () => {
      const id = `r:${RADICALS_DATA[0].glyph}`
      await expect(markIgnored(id, true)).rejects.toThrow(/radical/i)
      expect((await getCard(id))!.ignored).toBe(false)
    })
  })

  describe('lazy vocab materialization (Etap 4)', () => {
    const KANA_ONLY = VOCAB_DATA.filter((e) => e.kanji.length === 0)

    const vocabCards = async () =>
      (await getAllCards()).filter((c) => typeOf(c.id) === 'vocab')

    it('materializes unlocked words in ranking order up to the daily budget', async () => {
      await setSettings({ newPerDayVocab: 2 })
      await resetProgress()

      const q = await getSessionQueue('vocab', NOW)
      expect(q.fresh.map((c) => c.id)).toEqual(KANA_ONLY.slice(0, 2).map((e) => `w:${e.id}`))
      // pos mirrors the top-2000 rank (decision #15).
      for (const card of q.fresh) {
        expect(card.pos).toBe(VOCAB_DATA.findIndex((e) => e.id === bareId(card.id)))
      }
    })

    it('never duplicates an existing card across rebuilds and leaves states untouched', async () => {
      const first = await getSessionQueue('vocab', NOW)
      expect(first.fresh.length).toBeGreaterThan(0)
      await getSummary('vocab', NOW)
      await getKnownPool('vocab')
      await getQuizPools('vocab')
      const ids = (await vocabCards()).map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const card of first.fresh) {
        expect(await getCard(card.id)).toEqual(card)
      }
    })

    it('surfaces a word once its last kanji has been answered', async () => {
      // 思う is the first kanji-bearing word of the ranking (rank 10); the ten
      // words ahead of it are pure-kana and pass trivially (#12).
      const word = VOCAB_DATA.find((e) => e.kanji.length === 1)!
      await setSettings({ newPerDayVocab: 20 })
      await resetProgress()
      expect(await getCard(`w:${word.id}`)).toBeUndefined()

      // Answering its only kanji makes the word eligible, but the new-card
      // inventory is full — nothing materializes until a rebuild has room.
      await answerCard(cardId('kanji', word.kanji[0]), 'good', NOW)
      expect(await getCard(`w:${word.id}`)).toBeUndefined()

      // Studying a word frees an inventory slot; the next rebuild tops up by
      // rank and the freshly unlocked word jumps into the fresh queue.
      await answerCard('w:と', 'good', NOW)
      const q = await getSessionQueue('vocab', NOW + MIN_MS)
      expect(await getCard(`w:${word.id}`)).toMatchObject({
        state: 'new',
        pos: VOCAB_DATA.indexOf(word),
      })
      expect(q.fresh.map((c) => c.id)).toContain(`w:${word.id}`)
    })

    it('keeps multi-kanji words gated until every one of their kanji is seen (#8)', async () => {
      const word = VOCAB_DATA.find((e) => e.kanji.length >= 2)!
      await setSettings({ newPerDayVocab: 5 })
      await resetProgress()

      // One kanji seen is not enough — even a rebuild with inventory room
      // leaves the word unmaterialized.
      await answerCard(cardId('kanji', word.kanji[0]), 'good', NOW)
      await answerCard('w:と', 'good', NOW)
      await getSessionQueue('vocab', NOW + MIN_MS)
      expect(await getCard(`w:${word.id}`)).toBeUndefined()

      // Once every kanji has been seen, the next rebuild materializes it.
      for (const glyph of word.kanji.slice(1)) {
        await answerCard(cardId('kanji', glyph), 'good', NOW)
      }
      await setSettings({ newPerDayVocab: VOCAB_DATA.length })
      await getSessionQueue('vocab', NOW + MIN_MS)
      expect(await getCard(`w:${word.id}`)).toMatchObject({ state: 'new' })
    })

    it('caps introductions per day while keeping a topped-up inventory', async () => {
      await setSettings({ newPerDayVocab: 2 })
      await resetProgress()

      const [a, b] = KANA_ONLY
      const first = await getSessionQueue('vocab', NOW)
      expect(first.fresh.map((c) => c.id)).toEqual([`w:${a.id}`, `w:${b.id}`])

      await answerCard(`w:${a.id}`, 'good', NOW)
      await answerCard(`w:${b.id}`, 'good', NOW)

      // Today's introductions are spent — nothing more is offered today…
      expect((await getSessionQueue('vocab', NOW)).fresh).toHaveLength(0)
      // …but the rebuilds kept the new-card inventory at the limit, and the
      // queue reopens with it the next day.
      const pending = (await vocabCards()).filter((c) => c.state === 'new')
      expect(pending.map((c) => c.id).sort()).toEqual(
        KANA_ONLY.slice(2, 4).map((e) => `w:${e.id}`).sort(),
      )
      const tomorrow = NOW + DAY_MS
      expect((await getSessionQueue('vocab', tomorrow)).fresh.map((c) => c.id)).toEqual(
        KANA_ONLY.slice(2, 4).map((e) => `w:${e.id}`),
      )
    })

    it('feeds summaries and quiz pools like any other content type', async () => {
      // Settle: a limit covering the whole ranking materializes every unlocked
      // word at once, so later rebuilds have nothing left to add.
      await setSettings({ newPerDayVocab: VOCAB_DATA.length })
      await resetProgress()

      const cards = (await vocabCards()).sort((a, b) => a.pos - b.pos)
      expect(cards.map((c) => c.id)).toEqual(KANA_ONLY.map((e) => `w:${e.id}`))

      const summary = await getSummary('vocab', NOW)
      expect(summary.fresh).toBe(KANA_ONLY.length)

      const pools = await getQuizPools('vocab')
      expect(pools.new.map((c) => c.id)).toEqual(cards.map((c) => c.id))
      for (const card of [...pools.known, ...pools.progress, ...pools.new]) {
        expect(typeOf(card.id)).toBe('vocab')
      }

      const target = cards[0]
      await markKnown(target.id, true, NOW)
      const after = await getQuizPools('vocab')
      expect(after.known.map((c) => c.id)).toContain(target.id)
      expect(after.new.map((c) => c.id)).not.toContain(target.id)
      expect((await getKnownPool('vocab')).ids).toContain(target.id)
      const summaryAfter = await getSummary('vocab', NOW)
      expect(summaryAfter.known).toBe(1)
      expect(summaryAfter.fresh).toBe(KANA_ONLY.length - 1)
    })
  })
})

describe('settings', () => {
  it('applies defaults and merges partial updates', async () => {
    expect(await getSettings()).toEqual({
      newPerDay: 20,
      newPerDayRadical: 60,
      newPerDayVocab: 40,
      reviewLimit: 200,
      knownThresholdDays: 21,
      quiz: DEFAULT_QUIZ_CONFIG,
    })
    await setSettings({ newPerDay: 5 })
    expect(await getSettings()).toEqual({
      newPerDay: 5,
      newPerDayRadical: 60,
      newPerDayVocab: 40,
      reviewLimit: 200,
      knownThresholdDays: 21,
      quiz: DEFAULT_QUIZ_CONFIG,
    })
  })

  it('defaults the new radical/vocab limits for saves written before they existed', async () => {
    closeDb()
    const raw = await openRawConnection()
    try {
      await rawPut(raw, 'settings', { newPerDay: 7, reviewLimit: 99, knownThresholdDays: 14 }, 'settings')
    } finally {
      raw.close()
    }
    closeDb()

    const settings = await getSettings()
    expect(settings).toMatchObject({ newPerDayRadical: 60, newPerDayVocab: 40 })
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
    const before = (await getAllCards()).filter((c) => typeOf(c.id) !== 'vocab')
    await getQuizPools()
    await getQuizPools()
    expect(await getLogs()).toHaveLength(1)
    expect((await getAllCards()).filter((c) => typeOf(c.id) !== 'vocab')).toEqual(before)
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
    expect((await getAllCards()).filter((c) => typeOf(c.id) !== 'vocab')).toHaveLength(
      KANJI_DATA.length + RADICALS_DATA.length,
    )
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

  it('keeps kanji and radical drawings independent', async () => {
    const radical = { id: 'r:一', dataUrl: 'data:image/png;base64,RRR', updatedAt: NOW }
    await putDrawing(A)
    await putDrawing(radical)
    expect(await getDrawing(A.id)).toEqual(A)
    expect(await getDrawing(radical.id)).toEqual(radical)
    await deleteDrawing(radical.id)
    expect(await getDrawing(A.id)).toEqual(A)
    expect(await getDrawing(radical.id)).toBeUndefined()
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
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji', 'radical'] })
    const cards = await getAllCards()
    expect(cards.filter((c) => typeOf(c.id) === 'kanji')).toHaveLength(2)
    // The radical range is topped up on first run after the upgrade…
    expect(cards.filter((c) => typeOf(c.id) === 'radical')).toHaveLength(RADICALS_DATA.length)
    expect(await getCard('k:一')).toMatchObject({ state: 'learning' })

    // The adoption survives a simulated reload.
    closeDb()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji', 'radical'] })
    const after = await getAllCards()
    expect(after.filter((c) => typeOf(c.id) === 'kanji')).toHaveLength(2)
    expect(after.filter((c) => typeOf(c.id) === 'radical')).toHaveLength(RADICALS_DATA.length)
  })

  it('applies migration rule B while seeding radicals (#11): components of seen kanji start known', async () => {
    closeDb()
    await deleteDatabase()
    const legacy = await openLegacyV2()
    try {
      // 三 decomposes into 一 + 二 — real components with their own cards.
      await rawPut(legacy, 'cards', {
        kanji: '三',
        pos: 2,
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
    } finally {
      legacy.close()
    }

    await ensureSeeded()

    // Both components were seeded straight into the known state via applyKnown.
    for (const glyph of ['一', '二']) {
      const radical = (await getCard(`r:${glyph}`))!
      expect(radical.known).toBe(true)
      expect(radical.state).toBe('review')
      expect(radical.interval).toBe(DEFAULT_SETTINGS.knownThresholdDays)
      expect(radical.due).toBeGreaterThan(NOW)
      expect(radical.knownPrev).toMatchObject({ state: 'new' })
      // No log entries for migrated radicals.
      expect(await getLogs()).toHaveLength(0)
    }

    // An unrelated, never-seen component stays fresh.
    const untouched = (await getCard('r:口'))!
    expect(untouched.known).toBe(false)
    expect(untouched.state).toBe('new')

    // And the gated kanji is already in rotation right away — its components
    // are all seen, so nothing blocks re-introducing or continuing it.
    const q = await getSessionQueue('kanji', NOW)
    expect(q.fresh.map((c) => c.id)).not.toContain('k:三')
    const later = await getSessionQueue('kanji', NOW + MIN_MS)
    expect(later.learning.map((c) => c.id)).toContain('k:三')

    closeDb()
    // Re-seeding never duplicates or resets the adopted radicals.
    expect((await getAllCards()).filter((c) => typeOf(c.id) === 'radical')).toHaveLength(
      RADICALS_DATA.length,
    )
  })
})

describe('seed stamp', () => {
  it('is written by ensureSeeded and survives a reload', async () => {
    await ensureSeeded()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji', 'radical'] })
    closeDb()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji', 'radical'] })
  })

  it('resetProgress clears the stamp so every range reseeds', async () => {
    await answerCard('k:一', 'easy', NOW)
    await resetProgress()
    expect(await getSeedStamp()).toEqual({ seeded: ['kanji', 'radical'] })
    expect(await getCard('k:一')).toMatchObject({ state: 'new', reps: 0, known: false })
    // Reset wipes the rule-B state too: radicals come back fresh.
    expect((await getCard('r:口'))).toMatchObject({ state: 'new', known: false })
    expect(await getLogs()).toHaveLength(0)
    expect((await getAllCards()).filter((c) => typeOf(c.id) !== 'vocab')).toHaveLength(
      KANJI_DATA.length + RADICALS_DATA.length,
    )
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
    expect((await getAllCards()).filter((c) => typeOf(c.id) !== 'vocab')).toHaveLength(
      KANJI_DATA.length + RADICALS_DATA.length,
    )
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

describe('mixed sessions (Etap 5)', () => {
  /** A kanji with distinct real components, so gating scenarios are controllable. */
  const GATED = KANJI_DATA.find((e) =>
    e.radicals.some((r) => r.glyph !== e.kanji && RADICALS_DATA.some((x) => x.glyph === r.glyph)),
  )!
  /** Its components that have radical cards. */
  const GATED_COMPONENTS = GATED.radicals
    .filter((r) => r.glyph !== GATED.kanji)
    .map((r) => r.glyph)
    .filter((glyph) => RADICALS_DATA.some((x) => x.glyph === glyph))

  it('orders fresh cards into topological bands: radicals, then unlocked kanji, then words', async () => {
    // Introduce the gated kanji's components one by one (distinct timestamps).
    for (const [index, glyph] of GATED_COMPONENTS.entries()) {
      await answerCard(cardId('radical', glyph), 'good', NOW - (index + 1) * MIN_MS)
    }

    const q = await getSessionQueue('mixed', NOW)
    const ids = q.fresh.map((c) => c.id)
    const bands = ids.map((id) => TYPE_RANK[typeOf(id)])
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).toBeGreaterThanOrEqual(bands[i - 1])
    }
    expect(new Set(bands)).toEqual(new Set([0, 1, 2]))

    // Freshness heuristic: the just-unlocked kanji leads its band, ahead of
    // the always-unlocked self-fallback kanji (freshness 0).
    const gatedIndex = ids.indexOf(cardId('kanji', GATED.kanji))
    expect(gatedIndex).toBeGreaterThan(-1)
    expect(bands[gatedIndex]).toBe(1)
    const selfOnly = KANJI_DATA.filter(
      (e) => e.radicals.length >= 1 && e.radicals.every((r) => r.glyph === e.kanji),
    )
    for (const entry of selfOnly) {
      const index = ids.indexOf(cardId('kanji', entry.kanji))
      if (index >= 0) expect(gatedIndex).toBeLessThan(index)
    }
  })

  it('follows a freshly studied kanji with its own word at the head of the vocab band', async () => {
    const word = VOCAB_DATA.find((e) => e.kanji.length === 1)!
    // Raise the vocab inventory first: the default budget filled up during
    // the beforeEach reset, and a full inventory blocks materialization.
    await setSettings({ newPerDayVocab: VOCAB_DATA.length })
    // Introduce the word's only kanji without gating constraints: a seen
    // card plus a matching log entry is exactly what the freshness heuristic
    // and `isVocabUnlocked` read.
    const id = cardId('kanji', word.kanji[0])
    await putCard({ ...(await getCard(id))!, state: 'learning', step: 0, due: NOW + MIN_MS })
    await addLog({
      cardId: id,
      rating: 'good',
      prevState: 'new',
      newState: 'learning',
      interval: 0,
      ease: STARTING_EASE,
      due: NOW + MIN_MS,
      timestamp: NOW - MIN_MS,
    })

    const q = await getSessionQueue('mixed', NOW)
    const ids = q.fresh.map((c) => c.id)
    const vocabStart = ids.findIndex((cid) => typeOf(cid) === 'vocab')
    expect(vocabStart).toBeGreaterThan(-1)
    // The word materialized on the rebuild and precedes the pure-kana words.
    expect(ids.slice(vocabStart)).toContain(`w:${word.id}`)
    expect(ids[vocabStart]).toBe(`w:${word.id}`)
  })

  it('aggregates fresh queues while respecting each per-type daily limit', async () => {
    await setSettings({ newPerDayRadical: 2, newPerDay: 1, newPerDayVocab: 3 })

    // Unlock one extra kanji without spending any budget: materialize the
    // gated kanji's components as already seen (no log entries).
    for (const glyph of GATED_COMPONENTS) {
      const component = (await getCard(cardId('radical', glyph)))!
      await putCard({ ...component, state: 'learning', step: 0, due: NOW + MIN_MS })
    }

    const q = await getSessionQueue('mixed', NOW)
    const countBy = (t: 'kanji' | 'radical' | 'vocab') =>
      q.fresh.filter((c) => typeOf(c.id) === t).length
    expect(countBy('radical')).toBe(2)
    expect(countBy('vocab')).toBe(3)
    // Kanji budget of 1 goes to the first unlocked kanji in study order.
    const ctx = buildGateContext(await getAllCards())
    const unlocked = KANJI_DATA.filter((e) => isKanjiUnlocked(e, ctx)).map((e) => e.kanji)
    expect(countBy('kanji')).toBe(1)
    expect(q.fresh.map((c) => c.id)).toContain(cardId('kanji', unlocked[0]))
    expect(await getDailyCounts(NOW)).toEqual({ newToday: 0, reviewsToday: 0 })
  })

  it('merges due review cards across types by date under the global review limit', async () => {
    await setSettings({ reviewLimit: 2 })
    const markDue = async (id: string, due: number) => {
      const card = (await getCard(id))!
      await putCard({ ...card, state: 'review', interval: 30, due })
    }
    // A vocab card fabricated directly (bypasses lazy materialization).
    const word = VOCAB_DATA[0]
    const vocabCard = createCard(`w:${word.id}`, VOCAB_DATA.indexOf(word), NOW)
    await putCard({ ...vocabCard, state: 'review', interval: 30, due: NOW - 90_000 })
    await markDue(cardId('kanji', KANJI_DATA[4].kanji), NOW - 60_000)
    await markDue(`r:${RADICALS_DATA[3].glyph}`, NOW - 30_000)

    // Order follows the due date alone — the radical is due last and the
    // global cap drops it even though radicals come first while studying.
    const q = await getSessionQueue('mixed', NOW)
    expect(q.review.map((c) => c.id)).toEqual([
      `w:${word.id}`,
      cardId('kanji', KANJI_DATA[4].kanji),
    ])
  })

  it('merges elapsed learning steps across types ordered by due time', async () => {
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW - 2 * MIN_MS)
    await answerCard(`r:${RADICALS_DATA[0].glyph}`, 'good', NOW - MIN_MS)

    const study = await getSessionQueue('mixed', NOW)
    expect(study.learning.map((c) => c.id)).toEqual([
      cardId('kanji', KANJI_DATA[0].kanji),
      `r:${RADICALS_DATA[0].glyph}`,
    ])
    // Review sessions pick elapsed steps up symmetrically: answering the kanji
    // reschedules it beyond `now`, while the radical stays queued by date.
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'again', NOW)
    const review = await getSessionQueue('mixed', NOW)
    expect(review.learning.map((c) => c.id)).toEqual([`r:${RADICALS_DATA[0].glyph}`])
  })

  it('sums summaries over all content types', async () => {
    await answerCard(cardId('radical', RADICALS_DATA[0].glyph), 'good', NOW)
    await answerCard(cardId('kanji', KANJI_DATA[0].kanji), 'good', NOW)

    const mixed = await getSummary('mixed', NOW)
    const parts = await Promise.all([
      getSummary('radical', NOW),
      getSummary('kanji', NOW),
      getSummary('vocab', NOW),
    ])
    const keys = ['fresh', 'learning', 'due', 'known', 'future'] as const
    for (const key of keys) {
      expect(mixed[key]).toBe(parts.reduce((sum, part) => sum + part[key], 0))
    }
    expect(mixed.learning).toBe(2)
    expect(mixed.fresh).toBeGreaterThan(parts[1].fresh)
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
