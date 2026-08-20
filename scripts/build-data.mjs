import path from "node:path";
import fs from "node:fs";
import {
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  AI_PATH,
  TATOEBA_SENTENCES_PATH,
  KANJI_DATA_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

const MIN_SENTENCES = 2;
const MAX_SENTENCES = 3;

function mergeSentences(jpdbSentences, tatoeba, vocab) {
  const merged = [];
  for (const s of jpdbSentences) {
    if (merged.length < MAX_SENTENCES) merged.push(s);
  }
  for (const s of tatoeba) {
    if (merged.length >= MIN_SENTENCES) break;
    merged.push(s);
  }
  for (const v of vocab) {
    if (merged.length >= MIN_SENTENCES) break;
    merged.push(v);
  }
  return merged;
}

function pickMnemonic(kanji, jpdbMnemonic, ai) {
  const aiMnemonic = ai?.[kanji]?.mnemonic?.trim();
  if (jpdbMnemonic.trim()) return { mnemonic: jpdbMnemonic.trim(), source: "jpdb" };
  if (aiMnemonic) return { mnemonic: aiMnemonic, source: "ai" };
  return { mnemonic: "", source: "ai" };
}

async function main() {
  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  if (kyoiku.length !== 1006) {
    throw new Error(`kyoiku.json has ${kyoiku.length} entries — expected 1006.`);
  }
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const ai = readJsonFile(AI_PATH, {});
  const tatoeba = readJsonFile(TATOEBA_SENTENCES_PATH, {});

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

  fs.mkdirSync(path.dirname(KANJI_DATA_PATH), { recursive: true });
  writeJsonFile(KANJI_DATA_PATH, data, true);

  const stats = {
    total: data.length,
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