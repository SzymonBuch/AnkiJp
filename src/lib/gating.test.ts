import { describe, expect, it } from 'vitest'
import { buildGateContext, isComponentSeen, isKanjiUnlocked, isVocabUnlocked, missingComponents } from './gating'
import { KANJI_DATA } from './kanji'
import { RADICALS_DATA } from './radicals'
import { VOCAB_DATA } from './vocab'
import { cardId, createCard, type SrsCard } from './srs'

const NOW = 0

function card(id: string, state: SrsCard['state'] = 'new'): SrsCard {
  const created = createCard(id, 0, NOW)
  created.state = state
  return created
}

/** A deck kanji with at least two distinct (non-self) components. */
const MULTI = KANJI_DATA.find(
  (e) => e.radicals.filter((r) => r.glyph !== e.kanji).length >= 2,
)!
const MULTI_COMPONENTS = MULTI.radicals.filter((r) => r.glyph !== MULTI.kanji).map((r) => r.glyph)

/** A single-element kanji: its only "radical" is the self-fallback placeholder. */
const SELF_ONLY = KANJI_DATA.find(
  (e) => e.radicals.length >= 1 && e.radicals.every((r) => r.glyph === e.kanji),
)!
/** A radical glyph that simultaneously exists as a deck kanji (e.g. 口). */
const ALIAS = RADICALS_DATA.find((r) => KANJI_DATA.some((k) => k.kanji === r.glyph))!

describe('buildGateContext', () => {
  it('collects seen ids of every content type and skips brand-new cards', () => {
    const ctx = buildGateContext([
      card(cardId('kanji', MULTI.kanji), 'review'),
      card(cardId('radical', MULTI_COMPONENTS[0]), 'learning'),
      card(cardId('vocab', '食べる'), 'learning'),
      card(cardId('kanji', SELF_ONLY.kanji)),
    ])
    expect(ctx.seenIds.has(cardId('kanji', MULTI.kanji))).toBe(true)
    expect(ctx.seenIds.has(cardId('radical', MULTI_COMPONENTS[0]))).toBe(true)
    expect(ctx.seenIds.has(cardId('kanji', SELF_ONLY.kanji))).toBe(false)
    // Vocab cards never contribute components, but being seen still counts.
    expect(ctx.seenIds.has(cardId('vocab', '食べる'))).toBe(true)
  })

  it('unions the non-self components of seen kanji, excluding self-fallbacks', () => {
    const ctx = buildGateContext([card(cardId('kanji', MULTI.kanji), 'review')])
    for (const glyph of MULTI_COMPONENTS) {
      expect(ctx.componentsOfSeenKanji.has(glyph)).toBe(true)
    }
    const emptyCtx = buildGateContext([card(cardId('kanji', SELF_ONLY.kanji), 'review')])
    expect(emptyCtx.componentsOfSeenKanji.has(SELF_ONLY.kanji)).toBe(false)
  })
})

describe('isComponentSeen (decision #11: shared by migration rule B and gating)', () => {
  it('is false when everything involved is still new', () => {
    const ctx = buildGateContext([
      card(cardId('kanji', MULTI.kanji)),
      card(cardId('radical', MULTI_COMPONENTS[0])),
    ])
    expect(isComponentSeen(MULTI_COMPONENTS[0], ctx)).toBe(false)
  })

  it('is true once the component radical has been studied', () => {
    const ctx = buildGateContext([card(cardId('radical', MULTI_COMPONENTS[0]), 'review')])
    expect(isComponentSeen(MULTI_COMPONENTS[0], ctx)).toBe(true)
  })

  it('is true when the same glyph has been studied as a kanji (alias namespaces)', () => {
    const ctx = buildGateContext([card(cardId('kanji', ALIAS.glyph), 'review')])
    expect(ctx.seenIds.has(cardId('radical', ALIAS.glyph))).toBe(false)
    expect(isComponentSeen(ALIAS.glyph, ctx)).toBe(true)
  })

  it('is true for components of any studied kanji, even without their own cards', () => {
    const ctx = buildGateContext([card(cardId('kanji', MULTI.kanji), 'review')])
    for (const glyph of MULTI_COMPONENTS) {
      expect(isComponentSeen(glyph, ctx)).toBe(true)
    }
  })
})

describe('isKanjiUnlocked (decision #3, self-references ignored per #2)', () => {
  it('starts locked when any real component is unseen', () => {
    const ctx = buildGateContext([])
    expect(isKanjiUnlocked(MULTI, ctx)).toBe(false)
  })

  it('stays locked until every component has been seen', () => {
    const [first, ...rest] = MULTI_COMPONENTS
    const partial = buildGateContext([card(cardId('radical', first), 'review')])
    expect(isKanjiUnlocked(MULTI, partial)).toBe(false)

    const complete = buildGateContext(
      rest.map((glyph) => card(cardId('radical', glyph), 'review')).concat(card(cardId('radical', first), 'review')),
    )
    expect(isKanjiUnlocked(MULTI, complete)).toBe(true)
  })

  it('never gates on the self-fallback placeholder (#2)', () => {
    const ctx = buildGateContext([])
    expect(isKanjiUnlocked(SELF_ONLY, ctx)).toBe(true)
  })

  it('unlocks mid-session through components-of-seen-kanji (queue rebuild semantics)', () => {
    // Studying one kanji makes its components seen, unlocking other kanji
    // that share them — this is how mixed chains work after a rebuild.
    const sibling = KANJI_DATA.find(
      (e) =>
        e.kanji !== MULTI.kanji &&
        e.radicals.some((r) => MULTI_COMPONENTS.includes(r.glyph)),
    )
    if (!sibling) return
    const ctx = buildGateContext([card(cardId('kanji', MULTI.kanji), 'review')])
    const stillMissing = missingComponents(sibling, ctx)
    if (stillMissing.length === 0) expect(isKanjiUnlocked(sibling, ctx)).toBe(true)
    else expect(isKanjiUnlocked(sibling, ctx)).toBe(false)
  })
})

describe('missingComponents (Deck drill-down)', () => {
  it('lists exactly the unseen real components', () => {
    const empty = buildGateContext([])
    expect(missingComponents(MULTI, empty)).toEqual(MULTI_COMPONENTS)

    const seenFirst = buildGateContext([card(cardId('radical', MULTI_COMPONENTS[0]), 'review')])
    expect(missingComponents(MULTI, seenFirst)).toEqual(MULTI_COMPONENTS.slice(1))
  })

  it('never reports the self-fallback', () => {
    const empty = buildGateContext([])
    expect(missingComponents(SELF_ONLY, empty)).toEqual([])
  })
})

describe('isVocabUnlocked (Etap 4: words follow their kanji)', () => {
  const KANA_WORD = VOCAB_DATA.find((e) => e.kanji.length === 0)!
  const MULTI_KANJI_WORD = VOCAB_DATA.find((e) => e.kanji.length >= 2)!

  it('passes trivially for pure-kana words (decision #12)', () => {
    const ctx = buildGateContext([])
    expect(isVocabUnlocked(KANA_WORD, ctx)).toBe(true)
  })

  it('stays locked while any kanji of the word is unseen (#8, no exceptions)', () => {
    const [first, second] = MULTI_KANJI_WORD.kanji
    const partial = buildGateContext([card(cardId('kanji', first), 'review')])
    expect(isVocabUnlocked(MULTI_KANJI_WORD, partial)).toBe(false)

    const complete = buildGateContext(
      MULTI_KANJI_WORD.kanji.map((glyph) => card(cardId('kanji', glyph), 'learning')),
    )
    expect(second).toBeDefined()
    expect(isVocabUnlocked(MULTI_KANJI_WORD, complete)).toBe(true)
  })

  it('requires the kanji card itself — components of other kanji do not count', () => {
    // Seeing glyph X as a component of another kanji makes the component
    // "seen", but the word must wait for the actual card k:X to be studied.
    const target = MULTI_KANJI_WORD.kanji[0]
    const host = KANJI_DATA.find(
      (e) => e.kanji !== target && e.radicals.some((r) => r.glyph === target),
    )
    if (!host) return
    const ctx = buildGateContext([card(cardId('kanji', host.kanji), 'review')])
    expect(ctx.componentsOfSeenKanji.has(target)).toBe(true)
    expect(isVocabUnlocked(MULTI_KANJI_WORD, ctx)).toBe(false)
  })
})
