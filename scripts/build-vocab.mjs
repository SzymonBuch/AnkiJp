import {
  TATOEBA_VOCAB_SENTENCES_PATH,
  VOCAB_DATA_PATH,
  VOCAB_SELECTION_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

/**
 * Assemble src/data/vocab.json from the selection and the Tatoeba example
 * sentences. Entity shape per PLAN.md Etap 3:
 *   { id, entId, reading, furiganaHtml, meaning, meanings[], kanji[], sentences[] }
 * Array order == jpdb ranking order (rank 1 first), so a word's position is
 * its `pos` for seeding (decision #15).
 */
function main() {
  const selection = readJsonFile(VOCAB_SELECTION_PATH, null);
  if (!selection?.words?.length) {
    throw new Error("vocab-selection.json missing — run select-vocab.mjs first.");
  }
  const sentencesByWord = readJsonFile(TATOEBA_VOCAB_SENTENCES_PATH, {});

  const vocab = selection.words.map((w) => ({
    id: w.id,
    entId: w.entId,
    reading: w.reading,
    furiganaHtml: w.furiganaHtml,
    meaning: w.meaning,
    meanings: w.meanings,
    kanji: w.kanji,
    sentences: sentencesByWord[w.id] ?? [],
  }));

  writeJsonFile(VOCAB_DATA_PATH, vocab, true);

  const counts = vocab.map((v) => v.sentences.length);
  console.log(`Wrote ${vocab.length} words to ${VOCAB_DATA_PATH}`);
  console.log(
    JSON.stringify({
      total: vocab.length,
      withSentences: counts.filter((c) => c > 0).length,
      minSentences: Math.min(...counts),
      maxSentences: Math.max(...counts),
      kanaOnly: vocab.filter((v) => v.kanji.length === 0).length,
    }),
  );
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
