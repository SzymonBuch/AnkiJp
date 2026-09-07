import {
  KANJI_DATA_PATH,
  JPDB_SCRAPE_PATH,
  AI_INPUT_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

/**
 * List kanji whose mnemonic is still the empty "ai" placeholder, based on the
 * FINAL bundled deck (single source of truth). The user runs this list
 * through an AI and saves results to scripts/out/mnemonics-ai.json; the next
 * data:build picks them up.
 */
async function main() {
  const deck = readJsonFile(KANJI_DATA_PATH, []);
  if (!deck.length) {
    throw new Error("kanji.json is empty — run the data pipeline first.");
  }

  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const needsAi = [];
  for (const d of deck) {
    if (d.mnemonicSource !== "ai") continue;
    if (d.mnemonic?.trim()) continue;
    needsAi.push({
      type: "kanji",
      key: `kanji:${d.kanji}`,
      kanji: d.kanji,
      meaning: d.meaning,
      radicals: d.radicals,
      on: d.on,
      kun: d.kun,
    });
  }

  const components = new Map();
  for (const d of deck) {
    for (const r of d.radicals ?? []) {
      if (r.glyph && r.glyph !== d.kanji && !components.has(r.glyph)) components.set(r.glyph, r);
    }
  }
  for (const [glyph, radical] of components) {
    if (deck.some((d) => d.kanji === glyph && d.mnemonic?.trim())) continue;
    if (scraped[glyph]?.mnemonic?.trim()) continue;
    needsAi.push({
      type: "radical",
      key: `radical:${glyph}`,
      glyph,
      meaning: radical.keyword,
    });
  }

  writeJsonFile(AI_INPUT_PATH, needsAi);

  console.log(`mnemonics pending for kanji/radical cards: ${needsAi.length}`);
  if (needsAi.length) {
    console.log(`Written to ${AI_INPUT_PATH}`);
    console.log("Have each one summarized by an AI and save the results to scripts/out/mnemonics-ai.json with shape:");
    console.log('  { "kanji:<glyph>": { "mnemonic": "...", "source": "ai" }, "radical:<glyph>": { "mnemonic": "...", "source": "ai" } }');
  } else {
    console.log("All kanji have a mnemonic — no AI input needed.");
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
