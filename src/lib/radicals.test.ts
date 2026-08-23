import { describe, expect, it } from 'vitest'
import { EXOTIC_GLYPHS, describeCodePoint } from './glyphs'
import { KANJI_DATA } from './kanji'
import { RADICALS_DATA, getKanjiUsing, getRadical } from './radicals'

describe('RADICALS_DATA', () => {
  it('has unique glyphs with keywords (decision #18: the components of the final deck)', () => {
    expect(RADICALS_DATA.length).toBeGreaterThan(0)
    expect(new Set(RADICALS_DATA.map((r) => r.glyph)).size).toBe(RADICALS_DATA.length)
    for (const radical of RADICALS_DATA) {
      expect(radical.keyword.trim().length).toBeGreaterThan(0)
      expect(Number.isInteger(radical.usedIn)).toBe(true)
    }
  })

  it('is sorted by usage frequency, descending (decision #15 study order)', () => {
    for (let i = 1; i < RADICALS_DATA.length; i++) {
      expect(RADICALS_DATA[i - 1].usedIn).toBeGreaterThanOrEqual(RADICALS_DATA[i].usedIn)
    }
  })

  it('covers every non-self component of every deck kanji (rule #19 mirror)', () => {
    const byGlyph = new Set(RADICALS_DATA.map((r) => r.glyph))
    for (const entry of KANJI_DATA) {
      for (const { glyph } of entry.radicals) {
        if (glyph === entry.kanji) continue
        expect(byGlyph.has(glyph)).toBe(true)
      }
    }
  })

  it('includes every exotic code point from the Etap 2 checklist', () => {
    const byGlyph = new Set(RADICALS_DATA.map((r) => r.glyph))
    for (const glyph of EXOTIC_GLYPHS) {
      expect(byGlyph.has(glyph)).toBe(true)
    }
  })
})

describe('getRadical', () => {
  it('returns entries and throws for unknown glyphs', () => {
    expect(getRadical(RADICALS_DATA[0].glyph).keyword.length).toBeGreaterThan(0)
    expect(() => getRadical('〄')).toThrow(/unknown radical/i)
  })
})

describe('getKanjiUsing (in-memory reverse index, Etap 1)', () => {
  it('lists exactly the kanji whose decomposition contains the component, in deck order', () => {
    for (const radical of [RADICALS_DATA[0], RADICALS_DATA[7]]) {
      const expected = KANJI_DATA.filter((entry) =>
        entry.radicals.some((r) => r.glyph === radical.glyph && r.glyph !== entry.kanji),
      ).map((entry) => entry.kanji)
      expect(getKanjiUsing(radical.glyph).map((entry) => entry.kanji)).toEqual(expected)
    }
  })

  it('ignores single-element kanji stored as self-fallback placeholders', () => {
    // A kanji whose only "component" is itself, appearing as nobody else's
    // component either: the placeholder must not create an index entry.
    const loner = KANJI_DATA.find(
      (e) =>
        e.radicals.length === 1 &&
        e.radicals[0].glyph === e.kanji &&
        !KANJI_DATA.some(
          (other) => other !== e && other.radicals.some((r) => r.glyph === e.kanji),
        ),
    )
    if (!loner) return
    expect(getKanjiUsing(loner.kanji)).toEqual([])
  })

  it('agrees with the occurrence-count ranking data (unique per kanji)', () => {
    for (const radical of RADICALS_DATA) {
      const users = getKanjiUsing(radical.glyph)
      // jpdb may repeat a component inside one kanji; the index lists it once.
      expect(new Set(users.map((e) => e.kanji)).size).toBe(users.length)
      const occurrences = KANJI_DATA.filter((entry) =>
        entry.radicals.some((r) => r.glyph === radical.glyph && r.glyph !== entry.kanji),
      ).length
      expect(users.length).toBe(occurrences)
    }
  })
})

describe('exotic glyph checklist helpers', () => {
  it('formats code points as U+XXXX', () => {
    expect(describeCodePoint('⺊')).toBe('U+2E8A')
    expect(describeCodePoint('㇀')).toBe('U+31C0')
  })
})
