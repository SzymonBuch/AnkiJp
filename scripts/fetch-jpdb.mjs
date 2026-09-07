import {
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";
import { scrapeMissing } from "./lib/jpdb-scrape.mjs";

const MIN_SENTENCES = 2;

const force = process.argv.includes("--force");

async function main() {
  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  if (!kyoiku.length || kyoiku.length !== 1006) {
    throw new Error("kyoiku.json missing or incomplete — run fetch-kyoiku.mjs first.");
  }

  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const pending = kyoiku.filter((k) => force || !(k.kanji in scraped));
  if (!pending.length) {
    console.log(`All ${kyoiku.length} kanji already scraped.`);
    return;
  }
  console.log(`Scraping jpdb.io for ${pending.length} kanji...`);

  const problems = await scrapeMissing(
    pending.map((k) => k.kanji),
    scraped,
    { onSave: () => writeJsonFile(JPDB_SCRAPE_PATH, scraped) },
  );

  writeJsonFile(JPDB_SCRAPE_PATH, scraped);

  console.log(`\nDone. ${Object.keys(scraped).length} kanji scraped.`);
  const shortOnSentences = kyoiku.filter(
    (k) => (scraped[k.kanji]?.sentences ?? []).length < MIN_SENTENCES,
  );
  if (shortOnSentences.length) {
    console.warn(
      `\n${shortOnSentences.length} kanji with fewer than ${MIN_SENTENCES} jpdb sentences ` +
        "(tatoeba fallback covers them):",
    );
    for (const k of shortOnSentences) console.warn("  - " + k.kanji);
  }
  if (problems.length) {
    console.warn(`\n${problems.length} problem(s):`);
    for (const p of problems) console.warn("  - " + p);
  } else {
    console.log("No scraping problems.");
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
