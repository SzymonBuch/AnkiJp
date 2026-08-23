import path from "node:path";
import fs from "node:fs";
import {
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  AI_PATH,
  TATOEBA_SENTENCES_PATH,
  EXTENSIONS_PATH,
  KANJI_DATA_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";
import { mergeSentences, pickMnemonic } from "./lib/record.mjs";

async function main() {
  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  if (kyoiku.length !== 1006) {
    throw new Error(`kyoiku.json has ${kyoiku.length} entries — expected 1006.`);
  }
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const ai = readJsonFile(AI_PATH, {});
  const tatoeba = readJsonFile(TATOEBA_SENTENCES_PATH, {});
  const extensions = readJsonFile(EXTENSIONS_PATH, null);

  const data = kyoiku.map((k) => {
    const jp = scraped[k.kanji] ?? {};
    const meaning = jp.keyword?.trim() || k.meanings[0] || "";
    const mnemonic = pickMnemonic(k.kanji, jp.mnemonic ?? "", ai);
    return {
      kanji: k.kanji,
      grade: k.grade,
      on: k.on,
      kun: k.kun,
      meaning,
      meanings: k.meanings,
      radicals: jp.radicals ?? [{ glyph: k.kanji, keyword: meaning }],
      sentences: mergeSentences(jp.sentences ?? [], tatoeba[k.kanji] ?? [], jp.vocab ?? []),
      mnemonic: mnemonic.mnemonic,
      mnemonicSource: mnemonic.source,
    };
  });

  // Grade-0 extension records are built by extend-deck.mjs and appended after
  // the kyōiku block in usefulness order (decisions #8, #15, #18). The file
  // already stores them sorted; keep that order verbatim. A missing extensions
  // file must never silently shrink a deck that already carries the extension.
  if (extensions?.records?.length) {
    data.push(...extensions.records);
    console.log(`Appended ${extensions.records.length} grade-0 extension kanji.`);
  } else {
    const current = readJsonFile(KANJI_DATA_PATH, []);
    const tail = current.filter((e) => e.grade === 0);
    if (tail.length) {
      throw new Error(
        `kanji.json currently carries ${tail.length} grade-0 extension kanji, but ` +
          `${path.basename(EXTENSIONS_PATH)} is missing or empty — run extend-deck.mjs ` +
          "first (refusing to wipe the extension by rebuilding kyōiku-only data).",
      );
    }
  }

  fs.mkdirSync(path.dirname(KANJI_DATA_PATH), { recursive: true });
  writeJsonFile(KANJI_DATA_PATH, data, true);

  const stats = {
    total: data.length,
    kyōiku: kyoiku.length,
    grade0: data.length - kyoiku.length,
    jpdbMnemonics: data.filter((d) => d.mnemonicSource === "jpdb").length,
    aiMnemonics: data.filter((d) => d.mnemonicSource === "ai").length,
    missingMnemonics: data.filter((d) => d.mnemonicSource === "ai" && !d.mnemonic).length,
    minSentences: Math.min(...data.map((d) => d.sentences.length)),
    maxSentences: Math.max(...data.map((d) => d.sentences.length)),
  };
  console.log(`Wrote ${data.length} entries to ${KANJI_DATA_PATH}.`);
  console.log(JSON.stringify(stats));
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
