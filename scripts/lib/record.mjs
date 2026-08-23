// Kanji record assembly shared by build-data.mjs (kyōiku base) and
// extend-deck.mjs (grade-0 extension), keeping both paths byte-identical
// in shape and fallback behavior.

const MIN_SENTENCES = 2;
const MAX_SENTENCES = 3;

/**
 * jpdb examples first, then tatoeba fallback, then scraped vocab phrases —
 * until at least MIN_SENTENCES with a hard cap of MAX_SENTENCES.
 */
export function mergeSentences(jpdbSentences, tatoeba, vocab) {
  const merged = [];
  for (const s of jpdbSentences) {
    if (merged.length < MAX_SENTENCES) merged.push(s);
  }
  for (const s of tatoeba ?? []) {
    if (merged.length >= MIN_SENTENCES) break;
    merged.push(s);
  }
  for (const s of vocab ?? []) {
    if (merged.length >= MIN_SENTENCES) break;
    merged.push(s);
  }
  return merged;
}

/** jpdb mnemonic wins; AI-filled one second; empty "ai" placeholder last. */
export function pickMnemonic(kanji, jpdbMnemonic, ai) {
  const aiMnemonic = ai?.[kanji]?.mnemonic?.trim();
  if (jpdbMnemonic.trim()) return { mnemonic: jpdbMnemonic.trim(), source: "jpdb" };
  if (aiMnemonic) return { mnemonic: aiMnemonic, source: "ai" };
  return { mnemonic: "", source: "ai" };
}

export function buildKanjiRecord({ kyoikuEntry, scrapeEntry, aiEntry, tatoebaSentences }) {
  const jp = scrapeEntry ?? {};
  const meaning = jp.keyword?.trim() || kyoikuEntry.meanings[0] || "";
  const mnemonic = pickMnemonic(kyoikuEntry.kanji, jp.mnemonic ?? "", aiEntry ? { [kyoikuEntry.kanji]: aiEntry } : null);
  return {
    kanji: kyoikuEntry.kanji,
    grade: kyoikuEntry.grade,
    on: kyoikuEntry.on,
    kun: kyoikuEntry.kun,
    meaning,
    meanings: kyoikuEntry.meanings,
    radicals: jp.radicals ?? [{ glyph: kyoikuEntry.kanji, keyword: meaning }],
    sentences: mergeSentences(jp.sentences ?? [], tatoebaSentences ?? [], jp.vocab ?? []),
    mnemonic: mnemonic.mnemonic,
    mnemonicSource: mnemonic.source,
  };
}
