import fs from "node:fs";
import {
  KANJI_DATA_PATH,
  RADICALS_DATA_PATH,
  VOCAB_DATA_PATH,
  VOCAB_SELECTION_PATH,
  VOCAB_OVERRIDES_PATH,
  JMDICT_JSON_PATH,
} from "./lib/common.mjs";
import { analyzeForm, loadTokenizer } from "./lib/kuromoji.mjs";
import { KANJI_CHAR_RE, alignFurigana } from "./lib/vocab.mjs";

const KYOIKU_COUNT = 1006;
const VOCAB_COUNT = 2000;
const MAX_VOCAB_SENTENCES = 3;

function fail(failures, msg, subject = "?") {
  failures.push(`${subject}: ${msg}`);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(KANJI_DATA_PATH, "utf8"));
  const failures = [];
  const warnings = [];

  // ---------------------------------------------------------------- kanji.json

  if (!Array.isArray(data)) fail(failures, "kanji.json is not an array");
  const kyōikuCount = data.filter((d) => d.grade >= 1 && d.grade <= 6).length;
  const grade0Count = data.filter((d) => d.grade === 0).length;
  const badGrades = data.length - kyōikuCount - grade0Count;
  if (kyōikuCount !== KYOIKU_COUNT || badGrades > 0) {
    fail(
      failures,
      `expected ${KYOIKU_COUNT} grades 1-6 + grade-0 extension, got ${kyōikuCount}/grade1-6, ${grade0Count}/grade0, ${badGrades}/invalid`,
    );
  }
  // Extension entries must form a contiguous tail after the kyōiku block.
  let sawGrade0 = false;
  for (const d of data) {
    if (d.grade === 0) sawGrade0 = true;
    else if (sawGrade0) {
      fail(failures, `grade ${d.grade} entry after the grade-0 tail`, d.kanji);
      break;
    }
  }

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

    if (!Number.isInteger(d.grade)) {
      fail(failures, "grade not an integer", k);
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

  await verifyRadicals(data, failures);

  // ------------------------------------------------------------------ vocab.json

  await verifyVocab(data, failures, warnings);

  // ------------------------------------------------------------------- summary

  const sizeBytes = fs.statSync(KANJI_DATA_PATH).size;
  const gradeSummary = [...perGrade.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, n]) => `grade ${g}: ${n}`)
    .join(", ");
  console.log(`kanji.json size: ${(sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`total entries: ${data.length}`);
  console.log(`grades: ${gradeSummary}`);
  console.log(`min sentences per kanji: ${minSentences}`);
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

/**
 * Rule #19 (hard): every jpdb component of every deck kanji must have its own
 * radicals.json card, otherwise that kanji could be locked forever. Self-
 * fallback components (glyph == kanji) are excluded on both sides — they are
 * build-time placeholders, never gate anything (#2).
 */
async function verifyRadicals(data, failures) {
  if (!fs.existsSync(RADICALS_DATA_PATH)) {
    fail(failures, "radicals.json missing — run data:radicals after extending the deck");
    return;
  }
  const radicals = JSON.parse(fs.readFileSync(RADICALS_DATA_PATH, "utf8"));
  const byGlyph = new Map();
  for (let i = 0; i < radicals.length; i++) {
    const r = radicals[i];
    if (!isNonEmptyString(r.glyph)) fail(failures, "radical without glyph", `radicals[${i}]`);
    if (!isNonEmptyString(r.keyword)) fail(failures, `radical ${r.glyph} without keyword`, r.glyph);
    if (!Number.isInteger(r.usedIn) || r.usedIn < 1) fail(failures, "invalid usedIn count", r.glyph);
    if (r.mnemonicSource !== "jpdb" && r.mnemonicSource !== "ai") {
      fail(failures, `invalid radical mnemonicSource ${r.mnemonicSource}`, r.glyph);
    }
    if (r.mnemonicSource === "jpdb" && !isNonEmptyString(r.mnemonic)) {
      fail(failures, 'radical mnemonicSource "jpdb" but mnemonic is empty', r.glyph);
    }
    if (byGlyph.has(r.glyph)) fail(failures, "duplicate radical glyph", r.glyph);
    byGlyph.set(r.glyph, r);
  }

  const usedIn = new Map();
  const firstAppearance = new Map();
  for (const entry of data) {
    for (const r of entry.radicals ?? []) {
      if (!r.glyph || r.glyph === entry.kanji) continue;
      if (!byGlyph.has(r.glyph)) {
        fail(failures, "component has no radical card (rule #19)", `${entry.kanji} ← ${r.glyph}`);
        continue;
      }
      if (byGlyph.get(r.glyph).keyword !== r.keyword) {
        fail(failures, `component keyword mismatch ("${byGlyph.get(r.glyph).keyword}" vs "${r.keyword}")`, r.glyph);
      }
      usedIn.set(r.glyph, (usedIn.get(r.glyph) ?? 0) + 1);
      if (!firstAppearance.has(r.glyph)) firstAppearance.set(r.glyph, firstAppearance.size);
    }
  }

  for (const radical of radicals) {
    if (radical.usedIn !== (usedIn.get(radical.glyph) ?? 0)) {
      fail(failures, `usedIn ${radical.usedIn} does not match component count ${usedIn.get(radical.glyph) ?? 0}`, radical.glyph);
    }
  }

  const dependencies = new Map();
  for (const radical of radicals) {
    const owner = data.find((entry) => entry.kanji === radical.glyph);
    const deps = owner
      ? [...new Set((owner.radicals ?? []).map((r) => r.glyph).filter((g) => g !== radical.glyph))]
      : [];
    dependencies.set(radical.glyph, deps);
    for (const dependency of deps) {
      if (!byGlyph.has(dependency)) {
        fail(failures, "dependency has no radical card", `${radical.glyph} → ${dependency}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (glyph, path = []) => {
    if (visiting.has(glyph)) {
      fail(failures, `dependency cycle: ${[...path, glyph].join(" → ")}`, glyph);
      return;
    }
    if (visited.has(glyph)) return;
    visiting.add(glyph);
    for (const dependency of dependencies.get(glyph) ?? []) visit(dependency, [...path, glyph]);
    visiting.delete(glyph);
    visited.add(glyph);
  };
  for (const glyph of dependencies.keys()) visit(glyph);

  const expectedOrder = [...byGlyph.keys()].sort(
    (a, b) =>
      (usedIn.get(b) ?? 0) - (usedIn.get(a) ?? 0) ||
      (firstAppearance.get(a) ?? Infinity) - (firstAppearance.get(b) ?? Infinity),
  );
  const actualOrder = radicals.map((r) => r.glyph);
  if (
    actualOrder.length === expectedOrder.length &&
    actualOrder.every((g, i) => g === expectedOrder[i])
  ) {
    console.log(
      `radicals.json: ${radicals.length} cards, most-used: ` +
        radicals.slice(0, 5).map((r) => `${r.glyph}×${usedIn.get(r.glyph)}`).join(", "),
    );
  } else {
    fail(
      failures,
      "radicals.json ordering does not match usage ranking (regenerate via data:radicals)",
    );
  }
}

async function verifyVocab(deck, failures, warnings) {
  if (!fs.existsSync(VOCAB_DATA_PATH)) {
    fail(failures, "vocab.json missing — run data:vocab pipeline steps");
    return;
  }
  const vocab = JSON.parse(fs.readFileSync(VOCAB_DATA_PATH, "utf8"));
  if (!Array.isArray(vocab)) {
    fail(failures, "vocab.json is not an array");
    return;
  }
  if (vocab.length !== VOCAB_COUNT) {
    fail(failures, `expected ${VOCAB_COUNT} words, got ${vocab.length}`, "vocab.json");
  }

  const deckGlyphs = new Set(deck.map((d) => d.kanji));
  const ids = new Set();
  let minSentences = Infinity;
  let maxSentences = 0;

  for (let i = 0; i < vocab.length; i++) {
    const v = vocab[i];
    const at = v.id ?? `vocab[${i}]`;

    if (!isNonEmptyString(v.id)) fail(failures, "word missing id", at);
    if (ids.has(v.id)) fail(failures, "duplicate word id", v.id);
    ids.add(v.id);

    if (!Number.isInteger(v.entId) && typeof v.entId !== "string") {
      fail(failures, "entId missing", at);
    }

    if (!isNonEmptyString(v.reading)) fail(failures, "reading missing", at);

    if (!isNonEmptyString(v.furiganaHtml)) {
      fail(failures, "furiganaHtml missing", at);
    } else if (v.kanji?.length) {
      if (!v.furiganaHtml.includes("<ruby>")) fail(failures, "furiganaHtml lacks ruby", at);
      // Mechanical keb↔reb alignment must reproduce it exactly.
      const realigned = alignFurigana(v.id, v.reading);
      if (realigned !== v.furiganaHtml) {
        fail(failures, `furiganaHtml not reproducible by keb↔reb alignment: "${v.furiganaHtml}"`, at);
      }
    } else if (v.furiganaHtml !== v.id) {
      fail(failures, `kana-only furigana should be the bare form, got "${v.furiganaHtml}"`, at);
    }

    if (!isNonEmptyString(v.meaning)) fail(failures, "meaning empty", at);
    if (!Array.isArray(v.meanings) || v.meanings.length === 0) {
      fail(failures, "meanings list empty", at);
    } else {
      for (const m of v.meanings) {
        if (!isNonEmptyString(m)) fail(failures, "empty meaning entry", at);
      }
    }

    if (!Array.isArray(v.kanji)) {
      fail(failures, "kanji list missing", at);
    } else {
      // Decision #8: every word kanji exists in the deck — gating works
      // without exceptions; purely-kana words are legal (#12).
      for (const g of v.kanji) {
        if (!KANJI_CHAR_RE.test(g)) fail(failures, `non-kanji glyph in kanji list: ${g}`, at);
        if (!deckGlyphs.has(g)) fail(failures, `kanji ${g} not in deck (rule #8)`, at);
      }
    }

    if (!Array.isArray(v.sentences)) {
      fail(failures, "sentences list missing", at);
    } else {
      if (v.sentences.length > MAX_VOCAB_SENTENCES) {
        fail(failures, `more than ${MAX_VOCAB_SENTENCES} sentences`, at);
      }
      maxSentences = Math.max(maxSentences, v.sentences.length);
      if (v.sentences.length > 0) {
        minSentences = Math.min(minSentences, v.sentences.length);
      }
      for (const s of v.sentences) {
        const needsRuby = [...(s.jp ?? "")].some((ch) => KANJI_CHAR_RE.test(ch));
        if (!isNonEmptyString(s.jp)) fail(failures, "sentence missing jp", at);
        if (!isNonEmptyString(s.en)) fail(failures, `sentence missing en: "${s.jp?.slice(0, 20)}"`, at);
        // Kana-only sentences have nothing to gloss — ruby is required exactly
        // when kanji are present.
        if (
          needsRuby &&
          (!isNonEmptyString(s.furigana) || !s.furigana.includes("<rt>"))
        ) {
          fail(failures, `sentence missing furigana: "${s.jp?.slice(0, 20)}"`, at);
        }
      }
      // The word itself (or its head) must appear in each example sentence.
      for (const s of v.sentences) {
        if (s.jp && !s.jp.includes(v.id)) {
          warnings.push(`${at}: sentence does not contain the word literally: "${s.jp.slice(0, 20)}"`);
        }
      }
    }
  }

  console.log(
    `vocab.json: ${vocab.length} words, kana-only: ` +
      `${vocab.filter((v) => !v.kanji?.length).length}, sentences per word: ` +
      `${Number.isFinite(minSentences) ? minSentences : 0}-${maxSentences}`,
  );

  // Dictionary-form validation with the tokenizer ("nieodmienione", #4).
  const tokenizer = await loadTokenizer();
  let inflected = 0;
  let particles = 0;
  for (const v of vocab) {
    const { tokens, inflected: bad } = analyzeForm(tokenizer, v.id);
    if (bad) {
      inflected += 1;
      fail(failures, "inflected form selected as dictionary form", v.id);
    }
    if (tokens.some((t) => t.pos === "助詞")) {
      particles += 1;
      fail(failures, "particle selected as vocabulary", v.id);
    }
  }
  if (!inflected && !particles) console.log("vocab forms: all clean dictionary forms");

  await crossCheckSelection(vocab, failures);
  await crossCheckJmdict(vocab, warnings, failures);
}

/**
 * Selection reproducibility: vocab.json must mirror vocab-selection.json in
 * order and content (the selection is the auditable intermediate).
 */
async function crossCheckSelection(vocab, failures) {
  if (!fs.existsSync(VOCAB_SELECTION_PATH)) {
    fail(failures, "vocab-selection.json missing — cannot cross-check provenance");
    return;
  }
  const selection = JSON.parse(fs.readFileSync(VOCAB_SELECTION_PATH, "utf8"));
  const words = selection.words ?? [];
  if (words.length !== vocab.length) {
    fail(failures, `selection has ${words.length} words but vocab.json has ${vocab.length}`);
    return;
  }
  let mismatches = 0;
  for (let i = 0; i < words.length; i++) {
    const s = words[i];
    const v = vocab[i];
    if (
      s.id !== v.id ||
      String(s.entId) !== String(v.entId) ||
      s.reading !== v.reading ||
      s.furiganaHtml !== v.furiganaHtml ||
      JSON.stringify(s.kanji) !== JSON.stringify(v.kanji)
    ) {
      mismatches += 1;
      if (mismatches <= 10) fail(failures, "diverges from selection", `${v.id} @${i}`);
    }
  }
  if (!mismatches) console.log("selection cross-check: identical order and content");
  const overridden = selection.meta?.overriddenTerms ?? [];
  if (overridden.length) {
    console.log(
      `homograph resolution: ${overridden.length} manual override(s) applied: ` +
        overridden.join(", "),
    );
  }
}

/**
 * Homograph cascade audit (#13): when the jmdict-simplified cache is present,
 * independently re-resolve every word and require the same entId (manual
 * overrides excepted).
 */
async function crossCheckJmdict(vocab, warnings, failures) {
  if (!fs.existsSync(JMDICT_JSON_PATH)) {
    warnings.push("jmdict cache absent — skipping independent homograph audit");
    return;
  }
  const { buildJmdictIndex, chooseJmdictEntry } = await import("./lib/vocab.mjs");
  const jmdict = JSON.parse(fs.readFileSync(JMDICT_JSON_PATH, "utf8"));
  const index = buildJmdictIndex(jmdict.words);
  const overrides = fs.existsSync(VOCAB_OVERRIDES_PATH)
    ? readOverrides()
    : {};
  let audited = 0;
  for (const v of vocab) {
    if (overrides[v.id] !== undefined) continue;
    const chosen = chooseJmdictEntry(index, v.id, v.reading);
    if (!chosen) {
      fail(failures, "JMdict audit found no entry, but vocab.json has one", v.id);
      continue;
    }
    if (String(chosen.entry.id) !== String(v.entId)) {
      fail(
        failures,
        `entId ${v.entId} != cascade choice ${chosen.entry.id} (${chosen.entry.kanji.map((k) => k.text).join("/")})`,
        v.id,
      );
      continue;
    }
    audited += 1;
  }
  console.log(`jmdict audit: ${audited} words re-resolved identically`);
}

function readOverrides() {
  const raw = JSON.parse(fs.readFileSync(VOCAB_OVERRIDES_PATH, "utf8"));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
