import {
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  AI_INPUT_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

async function main() {
  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  if (kyoiku.length !== 1006) {
    throw new Error(`kyoiku.json has ${kyoiku.length} entries — expected 1006.`);
  }
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});

  const needsAi = [];
  for (const k of kyoiku) {
    const jp = scraped[k.kanji];
    const mnemonic = jp?.mnemonic ?? "";
    const radicals = jp?.radicals ?? [{ glyph: k.kanji, keyword: jp?.keyword ?? k.meanings[0] ?? "" }];
    if (mnemonic.trim()) continue;
    needsAi.push({
      kanji: k.kanji,
      meaning: jp?.keyword ?? k.meanings[0] ?? "",
      radicals,
      on: k.on,
      kun: k.kun,
    });
  }

  writeJsonFile(AI_INPUT_PATH, needsAi);

  console.log(`kanji missing a jpdb mnemonic: ${needsAi.length} / ${kyoiku.length}`);
  if (needsAi.length) {
    console.log(`Written to ${AI_INPUT_PATH}`);
    console.log("Have each one summarized by an AI and save the results to scripts/out/mnemonics-ai.json with shape:");
    console.log('  { "<kanji>": { "mnemonic": "...", "source": "ai" } }');
  } else {
    console.log("All kanji have a jpdb mnemonic — no AI input needed.");
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}