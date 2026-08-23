import {
  EXTENSION_API_CACHE_PATH,
  EXTENSIONS_PATH,
  JPDB_SCRAPE_PATH,
  KANJI_DATA_PATH,
  VOCAB_SELECTION_PATH,
  createRateLimiter,
  fetchJson,
  mapLimit,
  readJsonFile,
  writeJsonFile,
  katakanaToHiragana,
  normalizeKunReading,
} from "./lib/common.mjs";
import { scrapeMissing } from "./lib/jpdb-scrape.mjs";
import { loadTokenizer } from "./lib/kuromoji.mjs";
import { buildKanjiFallbacks } from "./lib/tatoeba.mjs";
import { buildKanjiRecord } from "./lib/record.mjs";

const KANJIAPI_CONCURRENCY = 8;
const KANJIAPI_RATE_LIMIT_MS = 60;

async function main() {
  const selection = readJsonFile(VOCAB_SELECTION_PATH, null);
  if (!selection?.words?.length) {
    throw new Error("vocab-selection.json missing — run select-vocab.mjs first.");
  }
  const deck = readJsonFile(KANJI_DATA_PATH, []);
  if (deck.length < 1006) {
    throw new Error(`kanji.json has ${deck.length} entries — expected at least the 1006 kyōiku.`);
  }

  // Usefulness ranking (#15): word count in the selected top-2000, ties broken
  // by the earliest containing word's source rank.
  const wordCount = new Map();
  const firstRank = new Map();
  for (const word of selection.words) {
    for (const glyph of word.kanji) {
      wordCount.set(glyph, (wordCount.get(glyph) ?? 0) + 1);
      if (!firstRank.has(glyph) || word.sourceRank < firstRank.get(glyph)) {
        firstRank.set(glyph, word.sourceRank);
      }
    }
  }

  const knownGlyphs = new Set(deck.map((d) => d.kanji));
  const extensionGlyphs = [...wordCount.keys()].filter((g) => !knownGlyphs.has(g));
  console.log(
    `extension: ${extensionGlyphs.length} new kanji ` +
      `(vocab uses ${wordCount.size} unique, deck has ${knownGlyphs.size})`,
  );
  if (!extensionGlyphs.length) {
    console.log("Deck already covers every vocabulary kanji — nothing to do.");
    return;
  }

  // Readings/meanings/stroke counts from kanjiapi.dev (same source as the
  // kyōiku base), resumable per glyph.
  const apiCache = readJsonFile(EXTENSION_API_CACHE_PATH, {});
  const apiPending = extensionGlyphs.filter((g) => !(g in apiCache));
  if (apiPending.length) {
    console.log(`Fetching ${apiPending.length} kanji details from kanjiapi.dev...`);
  }
  let apiDone = 0;
  const problems = [];
  const limiter = createRateLimiter(KANJIAPI_RATE_LIMIT_MS);
  await mapLimit(apiPending, KANJIAPI_CONCURRENCY, async (glyph) => {
    await limiter();
    try {
      const d = await fetchJson(`https://kanjiapi.dev/v1/kanji/${encodeURIComponent(glyph)}`);
      apiCache[glyph] = {
        on: (d.on_readings ?? []).map(katakanaToHiragana),
        kun: (d.kun_readings ?? []).map(normalizeKunReading),
        meanings: d.meanings ?? [],
        strokeCount: d.stroke_count ?? null,
        jlpt: d.jlpt ?? null,
        unicode: d.unicode ?? null,
      };
    } catch (err) {
      apiCache[glyph] = null;
      problems.push(`${glyph}: kanjiapi.dev ${err.message}`);
    }
    apiDone += 1;
    if (apiDone % 25 === 0 || apiDone === apiPending.length) {
      writeJsonFile(EXTENSION_API_CACHE_PATH, apiCache);
      console.log(`kanjiapi progress ${apiDone}/${apiPending.length}`);
    }
  });

  // jpdb content (keyword/radicals/mnemonic/examples) via the shared scraper
  // and page cache; failures land in problems like everywhere else.
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  problems.push(
    ...(await scrapeMissing(extensionGlyphs, scraped, {
      label: "for the grade-0 extension",
      onSave: () => writeJsonFile(JPDB_SCRAPE_PATH, scraped),
    })),
  );
  writeJsonFile(JPDB_SCRAPE_PATH, scraped);

  // Tatoeba fallback for glyphs whose jpdb examples fall short of two
  // sentences. Inline here so applied records are final; the corpus download
  // only happens when this is actually needed.
  const tokenizer = await loadTokenizer();
  const needingFallback = extensionGlyphs.filter(
    (g) => (scraped[g]?.sentences ?? []).length < 2,
  );
  let fallbacks = {};
  if (needingFallback.length) {
    console.log(`${needingFallback.length} extension kanji need tatoeba fallback sentences`);
    fallbacks = await buildKanjiFallbacks(needingFallback, tokenizer);
  }

  const missingApi = extensionGlyphs.filter((g) => apiCache[g] === null);
  if (missingApi.length) {
    throw new Error(
      `no kanjiapi.dev data for ${missingApi.length} glyph(s): ${missingApi.join(", ")} — ` +
        "cannot build readings/meanings; extend the source or drop these words",
    );
  }

  const records = extensionGlyphs.map((glyph) => {
    const api = apiCache[glyph];
    return buildKanjiRecord({
      kyoikuEntry: {
        kanji: glyph,
        grade: 0,
        on: api.on,
        kun: api.kun,
        meanings: api.meanings.length ? api.meanings : ["?"],
      },
      scrapeEntry: scraped[glyph],
      tatoebaSentences: fallbacks[glyph] ?? [],
    });
  });
  records.sort(
    (a, b) =>
      (wordCount.get(b.kanji) ?? 0) - (wordCount.get(a.kanji) ?? 0) ||
      (firstRank.get(a.kanji) ?? Infinity) - (firstRank.get(b.kanji) ?? Infinity) ||
      a.kanji.codePointAt(0) - b.kanji.codePointAt(0),
  );

  const extensions = {
    meta: {
      generatedFrom: "vocab-selection.json + kanjiapi.dev + jpdb.io scrape",
      usefulness: Object.fromEntries(
        records.map((r) => [r.kanji, wordCount.get(r.kanji)]),
      ),
    },
    records,
  };
  writeJsonFile(EXTENSIONS_PATH, extensions);

  // Apply: append to the committed deck (kyōiku block untouched). Reruns are
  // a no-op once every glyph is present.
  const merged = [...deck];
  for (const record of records) merged.push(record);
  writeJsonFile(KANJI_DATA_PATH, merged, true);

  console.log(`\nApplied ${records.length} grade-0 kanji to ${KANJI_DATA_PATH}`);
  console.log(`deck size now: ${merged.length}`);
  if (problems.length) {
    console.warn(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 50)) console.warn("  - " + p);
    if (problems.length > 50) console.warn(`  ... and ${problems.length - 50} more`);
  } else {
    console.log("No network problems.");
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
