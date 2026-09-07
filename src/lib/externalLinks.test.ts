import { describe, expect, it } from 'vitest'
import { jpdbKanjiUrl, jpdbVocabSearchUrl } from './externalLinks'

describe('jpdbKanjiUrl', () => {
  it('encodes kanji, components and exotic glyphs', () => {
    expect(jpdbKanjiUrl('A')).toBe('https://jpdb.io/kanji/A')
    expect(jpdbKanjiUrl('一')).toBe('https://jpdb.io/kanji/%E4%B8%80')
    expect(jpdbKanjiUrl('亻')).toBe('https://jpdb.io/kanji/%E4%BA%BB')
    expect(jpdbKanjiUrl('氵')).toBe('https://jpdb.io/kanji/%E6%B0%B5')
    expect(jpdbKanjiUrl('⺊')).toBe('https://jpdb.io/kanji/%E2%BA%8A')
  })
})

describe('jpdbVocabSearchUrl', () => {
  it('encodes kana and words containing kanji', () => {
    expect(jpdbVocabSearchUrl('こと')).toBe(
      'https://jpdb.io/search?q=%E3%81%93%E3%81%A8&lang=english#a',
    )
    expect(jpdbVocabSearchUrl('食べる')).toBe(
      'https://jpdb.io/search?q=%E9%A3%9F%E3%81%B9%E3%82%8B&lang=english#a',
    )
  })

  it('encodes spaces and special characters and preserves search options', () => {
    const url = jpdbVocabSearchUrl('a & b')
    expect(url).toContain('q=a%20%26%20b')
    expect(url).toContain('lang=english')
    expect(url.endsWith('#a')).toBe(true)
  })
})
