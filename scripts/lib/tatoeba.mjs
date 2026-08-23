import fs from "node:fs";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import readline from "node:readline";
import unbzip2Stream from "unbzip2-stream";
import {
  OUT_DIR,
  downloadFile,
  readJsonFile,
  writeJsonFile,
} from "./common.mjs";
import { toFurigana } from "./kuromoji.mjs";

// Shared Tatoeba machinery: file downloads, fingerprint-cached corpus scans,
// link/translation lookup, and sentence selection for kanji fallbacks plus
// vocabulary example sentences (Etap 3: lemma matching, substring fallback).

export const TATOEBA_DIR = path.join(OUT_DIR, "tatoeba");
const JPN_TSV_BZ2_URL =
  "https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2";
const ENG_TSV_BZ2_URL =
  "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2";
const JPN_ENG_LINKS_BZ2_URL =
  "https://downloads.tatoeba.org/exports/per_language/eng/eng-jpn_links.tsv.bz2";

export const JPN_TSV = path.join(TATOEBA_DIR, "jpn_sentences.tsv");
const JPN_TSV_BZ2 = path.join(TATOEBA_DIR, "jpn_sentences.tsv.bz2");
export const ENG_TSV = path.join(TATOEBA_DIR, "eng_sentences.tsv");
const ENG_TSV_BZ2 = path.join(TATOEBA_DIR, "eng_sentences.tsv.bz2");
const LINKS_TSV = path.join(TATOEBA_DIR, "eng-jpn_links.tsv");
const LINKS_TSV_BZ2 = path.join(TATOEBA_DIR, "eng-jpn_links.tsv.bz2");

const MAX_JP_LENGTH = 80;

function tsvLine(line) {
  return line.split("\t");
}

async function decompressBz2(bz2Path, outPath) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return;
  console.log(`decompressing ${path.basename(bz2Path)}...`);
  await pipeline(createReadStream(bz2Path), unbzip2Stream(), createWriteStream(outPath));
}

/** Download + decompress all corpus files this module relies on. Resumable. */
export async function ensureTatoebaFiles() {
  fs.mkdirSync(TATOEBA_DIR, { recursive: true });
  await Promise.all([
    downloadFile(JPN_TSV_BZ2_URL, JPN_TSV_BZ2),
    downloadFile(ENG_TSV_BZ2_URL, ENG_TSV_BZ2),
    downloadFile(JPN_ENG_LINKS_BZ2_URL, LINKS_TSV_BZ2),
  ]);
  await decompressBz2(JPN_TSV_BZ2, JPN_TSV);
  await decompressBz2(ENG_TSV_BZ2, ENG_TSV);
  await decompressBz2(LINKS_TSV_BZ2, LINKS_TSV);
}

async function eachLine(filePath, fn) {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line) await fn(line);
  }
}

/**
 * Scan the Japanese corpus for short sentences accepted by `matchFn(text)`.
 * The scan is expensive, so results are cached under a fingerprint of the
 * query; a fingerprint change invalidates the cache automatically.
 */
async function scanJpnSentences(fingerprint, matchFn) {
  const cachePath = path.join(TATOEBA_DIR, "jpn-candidates.json");
  const cached = readJsonFile(cachePath, null);
  if (cached?.fingerprint === fingerprint) {
    console.log("jpn candidates cached.");
    return cached.sentences;
  }
  console.log("scanning jpn sentences...");
  const sentenceById = {};
  await eachLine(JPN_TSV, (line) => {
    const parts = tsvLine(line);
    if (parts.length < 3) return;
    const text = parts.slice(2).join("\t");
    if (text.length <= MAX_JP_LENGTH && matchFn(text)) {
      sentenceById[parts[0]] = text;
    }
  });
  console.log(`candidate jpn sentences: ${Object.keys(sentenceById).length}`);
  writeJsonFile(cachePath, { fingerprint, sentences: sentenceById });
  return sentenceById;
}

/** English↔Japanese link pairs touching the candidate sentence ids. */
async function filterLinks(fingerprint, candidateIds) {
  const cachePath = path.join(TATOEBA_DIR, "links-filtered.json");
  const cached = readJsonFile(cachePath, null);
  if (cached?.fingerprint === fingerprint) {
    console.log("links (filtered) cached.");
    return cached.links;
  }
  console.log("filtering eng-jpn links...");
  const idSet = new Set(candidateIds);
  const links = {};
  await eachLine(LINKS_TSV, (line) => {
    const [a, b] = tsvLine(line);
    if (!a || !b || a === b) return;
    // Per-language dump is ordered (eng, jpn); accept either orientation.
    if (idSet.has(a)) (links[a] ??= []).push(b);
    else if (idSet.has(b)) (links[b] ??= []).push(a);
  });
  writeJsonFile(cachePath, { fingerprint, links });
  console.log(`links kept for ${Object.keys(links).length} candidate ids.`);
  return links;
}

/** English texts for the given sentence ids. */
async function readEngSentences(fingerprint, neededIds) {
  const cachePath = path.join(TATOEBA_DIR, "eng-needed.json");
  const cached = readJsonFile(cachePath, null);
  if (cached?.fingerprint === fingerprint) {
    console.log("eng sentences cached.");
    return cached.engById;
  }
  console.log(`reading ${neededIds.size} eng sentences...`);
  const engById = {};
  await eachLine(ENG_TSV, (line) => {
    const parts = tsvLine(line);
    if (parts.length < 3) return;
    const id = parts[0];
    if (neededIds.has(id)) engById[id] = parts.slice(2).join("\t");
  });
  writeJsonFile(cachePath, { fingerprint, engById });
  console.log(`eng sentences read: ${Object.keys(engById).length}`);
  return engById;
}

function shortestTranslation(jpnId, links, engById) {
  return (links[jpnId] ?? [])
    .map((id) => engById[id])
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)[0];
}

/**
 * Kanji fallback sentences: for glyphs whose jpdb examples fall short of
 * two, pick the shortest Tatoeba sentences containing the glyph (existing
 * behavior, generalized to an arbitrary target set). Returns {glyph: Sentence[]}
 * covering only glyphs that still lack coverage.
 */
export async function buildKanjiFallbacks(targetGlyphs, tokenizer) {
  if (!targetGlyphs.length) return {};
  await ensureTatoebaFiles();
  const fingerprint = `kanji:${MAX_JP_LENGTH}:${[...targetGlyphs].sort().join("")}`;
  const sentenceById = await scanJpnSentences(
    fingerprint,
    (text) => targetGlyphs.some((k) => text.includes(k)),
  );
  const links = await filterLinks(fingerprint, Object.keys(sentenceById));
  const neededEng = new Set();
  for (const ids of Object.values(links)) for (const id of ids) neededEng.add(id);
  const engById = await readEngSentences(fingerprint, neededEng);

  const byKanji = {};
  for (const kanji of targetGlyphs) {
    const options = [];
    for (const [jpnId, text] of Object.entries(sentenceById)) {
      if (!text.includes(kanji)) continue;
      const en = shortestTranslation(jpnId, links, engById);
      if (!en) continue;
      options.push({ jp: text, en });
    }
    options.sort((a, b) => a.jp.length - b.jp.length);
    const picked = options.slice(0, 2);
    byKanji[kanji] = picked.map((s) => ({
      jp: s.jp,
      en: s.en,
      furigana: toFurigana(s.jp, tokenizer),
    }));
    console.log(`${kanji}: ${picked.length} tatoeba sentence(s) from ${options.length} candidates`);
  }
  return byKanji;
}

/**
 * Vocabulary example sentences (Etap 3): up to three shortest sentences per
 * word, matched by LEMMA (any token whose basic form equals the dictionary
 * form — words appear inflected inside sentences). Plain substring matching
 * is only a fallback when no lemma match exists. Words may end up with zero
 * sentences ("brak pokrycia → pusta tablica").
 */
export async function buildVocabWordSentences(words, tokenizer) {
  const wordIds = words.map((w) => w.id);
  await ensureTatoebaFiles();
  const wordSet = new Set(wordIds);
  const fingerprint = `vocab:${MAX_JP_LENGTH}:${[...wordIds].sort().join("")}`;

  // First-character prefilter keeps the corpus scan cheap despite 2000 terms.
  const firstCharIndex = new Map();
  for (const id of wordIds) {
    for (const ch of new Set([...id])) {
      const list = firstCharIndex.get(ch) ?? [];
      list.push(id);
      firstCharIndex.set(ch, list);
    }
  }

  const sentenceById = await scanJpnSentences(fingerprint, (text) => {
    for (const ch of new Set(text)) {
      const candidates = firstCharIndex.get(ch);
      if (!candidates) continue;
      for (const id of candidates) {
        if (!text.includes(id)) continue;
        return true;
      }
    }
    return false;
  });

  const links = await filterLinks(fingerprint, Object.keys(sentenceById));
  const neededEng = new Set();
  for (const ids of Object.values(links)) for (const id of ids) neededEng.add(id);
  const engById = await readEngSentences(fingerprint, neededEng);

  // Longest-first would waste tokenizations on late exits; ascending length
  // fills the "prefer shortest" quota with minimal work. Persist progress so
  // the multi-minute pass resumes where it stopped.
  const statePath = path.join(TATOEBA_DIR, "vocab-sentence-progress.json");
  const state = readJsonFile(statePath, null);
  const valid = state?.fingerprint === fingerprint ? state : null;
  const results = valid?.results ?? {};
  let done = valid?.done ?? 0;

  const ordered = Object.entries(sentenceById)
    .sort((a, b) => a[1].length - b[1].length || Number(a[0]) - Number(b[0]));
  const remaining = new Set(wordIds);
  for (const [id, picks] of Object.entries(results)) {
    if (picks.length >= 3 || !wordSet.has(id)) remaining.delete(id);
  }

  console.log(`matching lemmas over ${ordered.length} candidate sentences...`);
  for (; done < ordered.length && remaining.size > 0; done++) {
    const [jpnId, text] = ordered[done];
    const en = shortestTranslation(jpnId, links, engById);
    if (en !== undefined) {
      const tokens = tokenizer.tokenize(text);
      const forms = new Set(tokens.map((t) => t.basic_form));
      const matched = [...remaining].filter((id) => forms.has(id));
      for (const id of matched) {
        (results[id] ??= []).push({
          jp: text,
          en,
          furigana: toFurigana(text, tokenizer),
        });
        if (results[id].length >= 3) remaining.delete(id);
      }
    }
    if (done % 20000 === 0) {
      writeJsonFile(statePath, { fingerprint, done, results });
      console.log(`progress ${done}/${ordered.length} (words left: ${remaining.size})`);
    }
  }
  writeJsonFile(statePath, { fingerprint, done, results });

  // Substring fallback for words without enough lemma coverage.
  const byWord = {};
  let fallbackWords = 0;
  for (const id of wordIds) {
    const lemmaPicks = results[id] ?? [];
    const picks = [...lemmaPicks];
    if (picks.length >= 3) {
      byWord[id] = picks.slice(0, 3);
      continue;
    }
    const options = [];
    for (const [jpnId, text] of Object.entries(sentenceById)) {
      if (!text.includes(id)) continue;
      const en = shortestTranslation(jpnId, links, engById);
      if (en === undefined) continue;
      options.push({ jp: text, en });
    }
    options.sort((a, b) => a.jp.length - b.jp.length);
    for (const opt of options) {
      if (picks.length >= 3) break;
      if (picks.some((p) => p.jp === opt.jp)) continue;
      picks.push({ ...opt, furigana: toFurigana(opt.jp, tokenizer) });
    }
    if (lemmaPicks.length === 0 && picks.length > 0) fallbackWords += 1;
    byWord[id] = picks.slice(0, 3);
  }
  console.log(`substring fallback needed for ${fallbackWords} word(s)`);

  const empty = wordIds.filter((id) => (byWord[id] ?? []).length === 0);
  if (empty.length) {
    console.warn(
      `${empty.length} word(s) without sentence coverage (legal per decision #7): ` +
        empty.slice(0, 30).join(", ") + (empty.length > 30 ? "..." : ""),
    );
  }
  return byWord;
}
