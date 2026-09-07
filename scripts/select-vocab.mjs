import fs from "node:fs";
import { unzipSync } from "fflate";
import {
  JPDB_FREQ_CSV_PATH,
  JPDB_FREQ_CSV_URL,
  JMDICT_JSON_PATH,
  JMDICT_URL,
  JMDICT_VERSION,
  JMDICT_ZIP_PATH,
  VOCAB_OVERRIDES_PATH,
  VOCAB_SELECTION_PATH,
  downloadFile,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";
import { analyzeForm, loadTokenizer } from "./lib/kuromoji.mjs";
import {
  KANJI_CHAR_RE,
  alignFurigana,
  allMeanings,
  buildJmdictIndex,
  chooseJmdictEntry,
  displayMeaning,
} from "./lib/vocab.mjs";

const TARGET_COUNT = 2000;

// Terms must be pure Japanese script (kana + kanji + prolonged mark +
// iteration mark) — anything else (latin, digits, symbols) cannot be a
// learnable dictionary form.
const TERM_RE = /^[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u30FC\u3005]+$/u;

async function main() {
  await downloadFile(JPDB_FREQ_CSV_URL, JPDB_FREQ_CSV_PATH);

  // JMdict: download + unzip once, keep the raw JSON cached between runs.
  if (!fs.existsSync(JMDICT_JSON_PATH)) {
    await downloadFile(JMDICT_URL, JMDICT_ZIP_PATH);
    console.log("unzipping jmdict...");
    const zipBytes = new Uint8Array(fs.readFileSync(JMDICT_ZIP_PATH));
    const files = unzipSync(zipBytes);
    const name = Object.keys(files).find((n) => n.endsWith(".json"));
    if (!name) throw new Error("jmdict zip contains no .json entry");
    fs.writeFileSync(JMDICT_JSON_PATH, Buffer.from(files[name]));
  }

  console.log("parsing jmdict (this can take a while)...");
  const jmdict = JSON.parse(fs.readFileSync(JMDICT_JSON_PATH, "utf8"));
  const index = buildJmdictIndex(jmdict.words);
  const byId = new Map(jmdict.words.map((e) => [e.id, e]));
  const overrides = readJsonFile(VOCAB_OVERRIDES_PATH, {});
  const overrideEntries = Object.entries(overrides).filter(([k]) => !k.startsWith("_"));
  for (const [term, entId] of overrideEntries) {
    const entry = byId.get(entId);
    if (!entry) throw new Error(`override ${term}: entId ${entId} not found in JMdict`);
    const covers =
      entry.kanji.some((k) => k.text === term) || entry.kana.some((k) => k.text === term);
    if (!covers) {
      throw new Error(
        `override ${term}: entId ${entId} (${entry.kanji.map((k) => k.text).join("/")}) ` +
          "does not spell the term",
      );
    }
  }
  if (overrideEntries.length) console.log(`loaded ${overrideEntries.length} manual overrides`);
  console.log(`jmdict entries: ${jmdict.words.length}`);

  const tokenizer = await loadTokenizer();

  const rows = fs
    .readFileSync(JPDB_FREQ_CSV_PATH, "utf8")
    .split("\n")
    .slice(1)
    .map((line, idx) => {
      const [term, reading, freq] = line.trim().split("\t");
      return { term, reading, rank: freq ? Number(freq) : idx + 1 };
    })
    .filter((r) => r.term && r.reading);

  const words = [];
  const seenTerms = new Set();
  const furiganaFailures = [];
  const stats = {
    scannedRows: 0,
    skippedDuplicate: 0,
    skippedSymbol: 0,
    skippedParticle: 0,
    skippedInflected: 0,
    unmatchedJmdict: 0,
    spellingFallback: 0,
    tagFallback: 0,
    commonFallback: 0,
    headwordFallback: 0,
    overridesApplied: 0,
  };
  const overriddenTerms = [];

  for (const row of rows) {
    if (words.length >= TARGET_COUNT) break;
    stats.scannedRows += 1;
    if (seenTerms.has(row.term)) {
      stats.skippedDuplicate += 1;
      continue;
    }
    if (!TERM_RE.test(row.term)) {
      stats.skippedSymbol += 1;
      continue;
    }
    seenTerms.add(row.term);

    // One card per dictionary form: duplicates lose against the highest rank
    // occurrence already handled above (decision #17).
    const { tokens, inflected } = analyzeForm(tokenizer, row.term);
    if (inflected) {
      stats.skippedInflected += 1;
      continue;
    }
    if (tokens.some((t) => t.pos === "助詞")) {
      stats.skippedParticle += 1;
      continue;
    }

    const chosen = chooseJmdictEntry(index, row.term, row.reading);
    if (!chosen) {
      stats.unmatchedJmdict += 1;
      continue;
    }
    const overrideEntId = overrides[row.term];
    if (overrideEntId !== undefined) {
      chosen.entry = byId.get(overrideEntId);
      chosen.resolution.overridden = true;
      stats.overridesApplied += 1;
      overriddenTerms.push(row.term);
    }
    if (!chosen.resolution.commonSpelling) stats.spellingFallback += 1;
    if (chosen.resolution.tagFallback) stats.tagFallback += 1;
    if (chosen.resolution.commonFallback) stats.commonFallback += 1;
    if (chosen.resolution.headwordFallback) stats.headwordFallback += 1;

    // Mechanical alignment or nothing: whole-word ruby would teach the user a
    // wrong reading, and data:verify rejects it anyway. Fail with the full
    // list so the terms can be handled deliberately.
    const furiganaHtml = alignFurigana(row.term, row.reading);
    if (furiganaHtml === null) {
      furiganaFailures.push(`${row.term} (${row.reading})`);
      continue;
    }

    const kanji = [...new Set([...row.term].filter((ch) => KANJI_CHAR_RE.test(ch)))];
    words.push({
      id: row.term,
      rank: words.length + 1,
      sourceRank: Number(row.rank),
      entId: chosen.entry.id,
      reading: row.reading,
      furiganaHtml,
      meaning: displayMeaning(chosen.entry),
      meanings: allMeanings(chosen.entry),
      kanji,
    });
  }

  if (furiganaFailures.length) {
    throw new Error(
      `furigana alignment failed for ${furiganaFailures.length} term(s): ` +
        `${furiganaFailures.join(", ")} — no automatic repair exists; exclude the ` +
        "terms from the ranking or resolve them via vocab-overrides.json",
    );
  }

  if (words.length < TARGET_COUNT) {
    throw new Error(
      `selection exhausted the ranking at ${words.length}/${TARGET_COUNT} words — ` +
        "inspect the skip statistics before lowering the bar",
    );
  }

  const selection = {
    meta: {
      generatedFrom: {
        csv: JPDB_FREQ_CSV_URL,
        jmdict: `jmdict-simplified ${JMDICT_VERSION}`,
        rules: "PLAN.md decisions #4, #12–#14, #17 (particles excluded per user decision)",
      },
      stats,
      overriddenTerms,
    },
    words,
  };
  writeJsonFile(VOCAB_SELECTION_PATH, selection);

  console.log(`\nSelected ${words.length} words (scanned ${stats.scannedRows} ranking rows).`);
  console.log(JSON.stringify(stats, null, 2));
  console.log(`Wrote ${VOCAB_SELECTION_PATH}`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
