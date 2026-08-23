import {
  KANJI_DATA_PATH,
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

  const needsAi = [];
  for (const d of deck) {
    if (d.mnemonicSource !== "ai") continue;
    if (d.mnemonic?.trim()) continue;
    needsAi.push({
      kanji: d.kanji,
      meaning: d.meaning,
      radicals: d.radicals,
      on: d.on,
      kun: d.kun,
    });
  }

  writeJsonFile(AI_INPUT_PATH, needsAi);

  console.log(`kanji missing a jpdb mnemonic: ${needsAi.length} / ${deck.length}`);
  if (needsAi.length) {
    console.log(`Written to ${AI_INPUT_PATH}`);
    console.log("Have each one summarized by an AI and save the results to scripts/out/mnemonics-ai.json with shape:");
    console.log('  { "<kanji>": { "mnemonic": "...", "source": "ai" } }');
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
