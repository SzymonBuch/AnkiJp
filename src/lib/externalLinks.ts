const JPDB_BASE_URL = 'https://jpdb.io'

export function jpdbKanjiUrl(glyph: string): string {
  return `${JPDB_BASE_URL}/kanji/${encodeURIComponent(glyph)}`
}

export function jpdbVocabSearchUrl(word: string): string {
  return `${JPDB_BASE_URL}/search?q=${encodeURIComponent(word)}&lang=english#a`
}
