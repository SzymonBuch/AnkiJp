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

  // extensions.json is an accumulating snapshot of the whole grade-0 tail,
  // not a single-batch artifact: seed the universe from what is already
  // committed so a fresh clone reproduces it without refetching, then add
  // vocabulary glyphs missing from the deck.
  const previous = readJsonFile(EXTENSIONS_PATH, null);
  const tailByGlyph = new Map(deck.filter((d) => d.grade === 0).map((d) => [d.kanji, d]));
  const prevByGlyph = new Map((previous?.records ?? []).map((r) => [r.kanji, r]));
  const universe = new Set([...wordCount.keys()].filter((g) => !knownGlyphs.has(g)));
  for (const g of tailByGlyph.keys()) universe.add(g);
  const pendingGlyphs = [...universe].filter((g) => !tailByGlyph.has(g) && !prevByGlyph.has(g));
  console.log(
    `extension: ${pendingGlyphs.length} new kanji to fetch ` +
      `(vocab uses ${wordCount.size} unique, deck has ${knownGlyphs.size}, ` +
      `grade-0 tail carries ${tailByGlyph.size})`,
  );

  // Readings/meanings from kanjiapi.dev (same source as the kyōiku base),
  // resumable per glyph. Failures are NOT cached — the next run retries them.
  const apiCache = readJsonFile(EXTENSION_API_CACHE_PATH, {});
  const apiPending = pendingGlyphs.filter((g) => !(g in apiCache));
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
      problems.push(`${glyph}: kanjiapi.dev ${err.message}`);
    }
    apiDone += 1;
    if (apiDone % 25 === 0 || apiDone === apiPending.length) {
      writeJsonFile(EXTENSION_API_CACHE_PATH, apiCache);
      console.log(`kanjiapi progress ${apiDone}/${apiPending.length}`);
    }
  });

  // jpdb content (keyword/radicals/mnemonic/examples) via the shared scraper
  // and page cache; failures land in problems like everywhere else. Only the
  // newly fetched glyphs need scraping — reused records carry their content.
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  problems.push(
    ...(await scrapeMissing(pendingGlyphs, scraped, {
      label: "for the grade-0 extension",
      onSave: () => writeJsonFile(JPDB_SCRAPE_PATH, scraped),
    })),
  );
  writeJsonFile(JPDB_SCRAPE_PATH, scraped);

  // Tatoeba fallback for glyphs whose jpdb examples fall short of two
  // sentences. Inline here so applied records are final; the corpus download
  // only happens when this is actually needed.
  const needingFallback = pendingGlyphs.filter(
    (g) => (scraped[g]?.sentences ?? []).length < 2,
  );
  let fallbacks = {};
  if (needingFallback.length) {
    console.log(`${needingFallback.length} extension kanji need tatoeba fallback sentences`);
    const tokenizer = await loadTokenizer();
    fallbacks = await buildKanjiFallbacks(needingFallback, tokenizer);
  }

  const missingApi = pendingGlyphs.filter((g) => !(g in apiCache));
  if (missingApi.length) {
    throw new Error(
      `no kanjiapi.dev data for ${missingApi.length} glyph(s): ${missingApi.join(", ")} — ` +
        "they were not cached this run; fix connectivity and rerun to retry them",
    );
  }

  const fetchedRecords = new Map(
    pendingGlyphs.map((glyph) => [
      glyph,
      buildKanjiRecord({
        kyoikuEntry: {
          kanji: glyph,
          grade: 0,
          on: apiCache[glyph].on,
          kun: apiCache[glyph].kun,
          meanings: apiCache[glyph].meanings.length ? apiCache[glyph].meanings : ["?"],
        },
        scrapeEntry: scraped[glyph],
        tatoebaSentences: fallbacks[glyph] ?? [],
      }),
    ]),
  );

  // Reuse committed tail records first (they are the shipped truth), then any
  // previously generated ones, and only then freshly built records.
  const records = [...universe]
    .map((glyph) => tailByGlyph.get(glyph) ?? prevByGlyph.get(glyph) ?? fetchedRecords.get(glyph))
    .filter(Boolean);
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
        records.map((r) => [r.kanji, wordCount.get(r.kanji) ?? 0]),
      ),
    },
    records,
  };
  writeJsonFile(EXTENSIONS_PATH, extensions);

  // Apply: rebuild the committed deck as the untouched kyōiku block followed
  // by the full extension set — reruns converge to the same output instead of
  // appending duplicates or dropping earlier batches.
  const merged = [...deck.filter((d) => d.grade !== 0), ...records];
  writeJsonFile(KANJI_DATA_PATH, merged, true);

  console.log(
    `\nApplied ${records.length} grade-0 kanji (${pendingGlyphs.length} newly built) to ${KANJI_DATA_PATH}`,
  );
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
