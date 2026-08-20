import fs from "node:fs";
import { KANJI_DATA_PATH } from "./lib/common.mjs";

function fail(failures, msg, kanji = "?") {
  failures.push(`${kanji}: ${msg}`);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(KANJI_DATA_PATH, "utf8"));
  const failures = [];
  const warnings = [];

  if (!Array.isArray(data)) fail(failures, "kanji.json is not an array");
  if (data.length !== 1006) fail(failures, `expected 1006 entries, got ${data.length}`);

  const unique = new Set(data.map((d) => d.kanji));
  if (unique.size !== data.length) {
    fail(failures, `duplicate kanji detected (${data.length - unique.size} duplicates)`);
  }

  let missingMnemonic = 0;
  let minSentences = Infinity;
  const perGrade = new Map();

  for (const d of data) {
    const k = d.kanji;
    if (!isNonEmptyString(k)) fail(failures, "kanji missing", k);

    if (!Number.isInteger(d.grade) || d.grade < 1 || d.grade > 6) {
      fail(failures, `invalid grade ${d.grade}`, k);
    } else {
      perGrade.set(d.grade, (perGrade.get(d.grade) ?? 0) + 1);
    }

    if (!Array.isArray(d.on)) fail(failures, "on readings not an array", k);
    if (!Array.isArray(d.kun)) fail(failures, "kun readings not an array", k);
    if (d.on.length + d.kun.length === 0) fail(failures, "no readings at all", k);
    for (const r of [...(d.on ?? []), ...(d.kun ?? [])]) {
      if (!isNonEmptyString(r)) fail(failures, "empty reading", k);
    }

    if (!isNonEmptyString(d.meaning)) fail(failures, "empty main meaning (keyword)", k);
    if (!Array.isArray(d.meanings) || d.meanings.length === 0) {
      fail(failures, "empty meanings list", k);
    } else {
      for (const m of d.meanings) {
        if (!isNonEmptyString(m)) fail(failures, "empty meaning entry", k);
      }
    }

    if (!Array.isArray(d.radicals) || d.radicals.length === 0) {
      fail(failures, "no radicals", k);
    } else {
      for (const r of d.radicals) {
        if (!isNonEmptyString(r.glyph)) fail(failures, "radical without glyph", k);
        if (!isNonEmptyString(r.keyword)) fail(failures, `radical ${r.glyph} without keyword`, k);
      }
    }

    if (!Array.isArray(d.sentences) || d.sentences.length < 2) {
      fail(failures, `need >=2 sentences, got ${d.sentences?.length ?? 0}`, k);
    } else {
      minSentences = Math.min(minSentences, d.sentences.length);
      for (const s of d.sentences) {
        if (!isNonEmptyString(s.jp)) fail(failures, "sentence missing jp", k);
        if (!isNonEmptyString(s.en)) fail(failures, `sentence missing en: "${s.jp?.slice(0, 20)}"`, k);
        if (!isNonEmptyString(s.furigana) || !s.furigana.includes("<rt>")) {
          fail(failures, `sentence missing furigana: "${s.jp?.slice(0, 20)}"`, k);
        }
      }
    }

    if (d.mnemonicSource !== "jpdb" && d.mnemonicSource !== "ai") {
      fail(failures, `invalid mnemonicSource ${d.mnemonicSource}`, k);
    }
    if (d.mnemonicSource === "jpdb" && !isNonEmptyString(d.mnemonic)) {
      fail(failures, 'mnemonicSource "jpdb" but mnemonic is empty', k);
    }
    if (d.mnemonicSource === "ai" && !isNonEmptyString(d.mnemonic)) {
      missingMnemonic += 1;
      warnings.push(`${k}: mnemonic pending (mnemonicSource "ai", empty)`);
    }
  }

  const sizeBytes = fs.statSync(KANJI_DATA_PATH).size;
  const gradeSummary = [...perGrade.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, n]) => `grade ${g}: ${n}`)
    .join(", ");
  const onlyOn = data.filter((d) => d.on.length > 0 && d.kun.length === 0).length;
  const onlyKun = data.filter((d) => d.on.length === 0 && d.kun.length > 0).length;

  console.log(`kanji.json size: ${(sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`total entries: ${data.length}`);
  console.log(`grades: ${gradeSummary}`);
  console.log(`min sentences per kanji: ${minSentences}`);
  console.log(`only on readings: ${onlyOn}, only kun readings: ${onlyKun}`);
  console.log(`mnemonicSource jpdb: ${data.filter((d) => d.mnemonicSource === "jpdb").length}`);
  console.log(`mnemonicSource ai: ${data.filter((d) => d.mnemonicSource === "ai").length}`);
  console.log(`mnemonics still empty (source ai): ${missingMnemonic}`);
  if (warnings.length) console.log(`\n${warnings.length} warning(s) — see details below`);
  for (const w of warnings.slice(0, 50)) console.warn(`  ! ${w}`);
  if (warnings.length > 50) console.warn(`  ... and ${warnings.length - 50} more`);

  if (failures.length) {
    console.error(`\nFAIL — ${failures.length} problem(s):`);
    for (const f of failures.slice(0, 100)) console.error(`  x ${f}`);
    if (failures.length > 100) console.error(`  ... and ${failures.length - 100} more`);
    process.exit(1);
  }

  console.log("\nPASS — all sanity checks complete.");
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}