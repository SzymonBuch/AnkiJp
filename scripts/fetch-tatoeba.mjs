import {
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  TATOEBA_SENTENCES_PATH,
  TATOEBA_VOCAB_SENTENCES_PATH,
  VOCAB_SELECTION_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";
import { loadTokenizer } from "./lib/kuromoji.mjs";
import {
  buildKanjiFallbacks,
  buildVocabWordSentences,
  ensureTatoebaFiles,
} from "./lib/tatoeba.mjs";

const MIN_SENTENCES = 2;

async function main() {
  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  if (!kyoiku.length || kyoiku.length !== 1006) {
    throw new Error("kyoiku.json missing or incomplete — run fetch-kyoiku.mjs first.");
  }
  await ensureTatoebaFiles();
  const tokenizer = await loadTokenizer();

  // Kanji fallbacks: kyōiku glyphs whose jpdb examples fall short. Glyphs
  // missing from the scrape cache are unknown needs — extend-deck covers its
  // own glyphs inline, so only cached ones are targeted here.
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const targetKanji = kyoiku
    .map((k) => k.kanji)
    .filter((glyph) => (scraped[glyph]?.sentences ?? []).length < MIN_SENTENCES);
  console.log(`target kanji needing tatoeba sentences: ${targetKanji.join(", ") || "(none)"}`);

  let byKanji = {};
  if (targetKanji.length) {
    byKanji = await buildKanjiFallbacks(targetKanji, tokenizer);
    writeJsonFile(TATOEBA_SENTENCES_PATH, byKanji);
    console.log(`Wrote ${Object.keys(byKanji).length} kanji to ${TATOEBA_SENTENCES_PATH}`);
  } else {
    console.log("No kanji need the tatoeba fallback.");
  }

  // Vocabulary example sentences: lemma matching with substring fallback.
  const selection = readJsonFile(VOCAB_SELECTION_PATH, null);
  if (!selection?.words?.length) {
    throw new Error("vocab-selection.json missing — run select-vocab.mjs first.");
  }
  console.log(`building example sentences for ${selection.words.length} words...`);
  const byWord = await buildVocabWordSentences(selection.words, tokenizer);
  writeJsonFile(TATOEBA_VOCAB_SENTENCES_PATH, byWord);

  const counts = Object.values(byWord).map((s) => s.length);
  console.log(
    `\nWrote ${Object.keys(byWord).length} words to ${TATOEBA_VOCAB_SENTENCES_PATH} ` +
      `(min ${Math.min(...counts)}, max ${Math.max(...counts)} sentences)`,
  );
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
