import fs from "node:fs";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";
import unbzip2Stream from "unbzip2-stream";
import {
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  OUT_DIR,
  katakanaToHiragana,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

const TATOEBA_DIR = path.join(OUT_DIR, "tatoeba");
const JPN_TSV = path.join(TATOEBA_DIR, "jpn_sentences.tsv");
const ENG_TSV = path.join(TATOEBA_DIR, "eng_sentences.tsv");
const ENG_TSV_BZ2 = path.join(TATOEBA_DIR, "eng_sentences.tsv.bz2");
const LINKS_CSV = path.join(TATOEBA_DIR, "links.csv");
const JPN_CACHE = path.join(TATOEBA_DIR, "jpn-candidates.json");
const LINKS_CACHE = path.join(TATOEBA_DIR, "links-filtered.json");
const ENG_CACHE = path.join(TATOEBA_DIR, "eng-needed.json");
const SENTENCES_PATH = path.join(TATOEBA_DIR, "tatoeba-sentences.json");

const MIN_SENTENCES = 2;
const MAX_JP_LENGTH = 80;
const TARGET_COUNT = 2;

function tsvLine(line) {
  return line.split("\t");
}

async function decompressBz2(bz2Path, outPath) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return;
  console.log(`decompressing ${path.basename(bz2Path)}...`);
  await pipeline(createReadStream(bz2Path), unbzip2Stream(), createWriteStream(outPath));
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

async function scanJpnSentences(targetKanji) {
  if (fs.existsSync(JPN_CACHE)) {
    console.log("jpn candidates cached.");
    return JSON.parse(fs.readFileSync(JPN_CACHE, "utf8"));
  }
  console.log("scanning jpn sentences...");
  const sentenceById = {};
  await eachLine(JPN_TSV, (line) => {
    const parts = tsvLine(line);
    if (parts.length < 3) return;
    const text = parts.slice(2).join("\t");
    if (text.length <= MAX_JP_LENGTH && targetKanji.some((k) => text.includes(k))) {
      sentenceById[parts[0]] = text;
    }
  });
  console.log(`candidate jpn sentences: ${Object.keys(sentenceById).length}`);
  writeJsonFile(JPN_CACHE, sentenceById);
  return sentenceById;
}

async function filterLinks(candidateIds) {
  if (fs.existsSync(LINKS_CACHE)) {
    console.log("links (filtered) cached.");
    return JSON.parse(fs.readFileSync(LINKS_CACHE, "utf8"));
  }
  console.log("filtering links.csv...");
  const links = {};
  const idSet = new Set(candidateIds);
  await eachLine(LINKS_CSV, (line) => {
    const [a, b] = tsvLine(line);
    if (!a || !b || a === b) return;
    if (idSet.has(a)) (links[a] ??= []).push(b);
    else if (idSet.has(b)) (links[b] ??= []).push(a);
  });
  writeJsonFile(LINKS_CACHE, links);
  console.log(`links kept for ${Object.keys(links).length} candidate ids.`);
  return links;
}

async function readEngSentences(neededIds) {
  if (fs.existsSync(ENG_CACHE)) {
    console.log("eng sentences cached.");
    return JSON.parse(fs.readFileSync(ENG_CACHE, "utf8"));
  }
  console.log(`reading ${neededIds.size} eng sentences...`);
  const engById = {};
  await eachLine(ENG_TSV, (line) => {
    const parts = tsvLine(line);
    if (parts.length < 3) return;
    const id = parts[0];
    if (neededIds.has(id)) engById[id] = parts.slice(2).join("\t");
  });
  writeJsonFile(ENG_CACHE, engById);
  console.log(`eng sentences read: ${Object.keys(engById).length}`);
  return engById;
}

function loadTokenizer() {
  const dictPath = fileURLToPath(new URL("../node_modules/kuromoji/dict", import.meta.url));
  return new Promise((resolve, reject) => {
    kuromoji
      .builder({ dicPath: dictPath })
      .build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
  });
}

const KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function toFurigana(text, tokenizer) {
  let out = "";
  for (const token of tokenizer.tokenize(text)) {
    const surface = token.surface_form;
    if (KANJI_RE.test(surface)) {
      const reading = token.reading ? katakanaToHiragana(token.reading) : "";
      out += reading ? `<ruby>${surface}<rt>${reading}</rt></ruby>` : surface;
    } else {
      out += surface;
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(TATOEBA_DIR, { recursive: true });

  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const targets = kyoiku.filter((k) => (scraped[k.kanji]?.sentences ?? []).length < MIN_SENTENCES);
  const targetKanji = targets.map((t) => t.kanji);
  console.log(`target kanji needing tatoeba sentences: ${targetKanji.join(", ") || "(none)"}`);
  if (!targets.length) {
    console.log("No kanji need the tatoeba fallback — nothing to do.");
    return;
  }

  await decompressBz2(ENG_TSV_BZ2, ENG_TSV);

  const sentenceById = await scanJpnSentences(targetKanji);
  const links = await filterLinks(Object.keys(sentenceById));
  const neededEng = new Set();
  for (const ids of Object.values(links)) for (const id of ids) neededEng.add(id);
  const engById = await readEngSentences(neededEng);

  const tokenizer = await loadTokenizer();
  const byKanji = {};
  for (const kanji of targetKanji) {
    const options = [];
    for (const [jpnId, text] of Object.entries(sentenceById)) {
      if (!text.includes(kanji)) continue;
      const en = (links[jpnId] ?? [])
        .map((id) => engById[id])
        .filter(Boolean)
        .sort((a, b) => a.length - b.length)[0];
      if (!en) continue;
      options.push({ jp: text, en });
    }
    options.sort((a, b) => a.jp.length - b.jp.length);
    const picked = options.slice(0, TARGET_COUNT);
    byKanji[kanji] = picked.map((s) => ({
      jp: s.jp,
      en: s.en,
      furigana: toFurigana(s.jp, tokenizer),
    }));
    console.log(`${kanji}: ${picked.length} tatoeba sentence(s) from ${options.length} candidates`);
  }

  writeJsonFile(SENTENCES_PATH, byKanji);
  const missing = targetKanji.filter((k) => (byKanji[k] ?? []).length < MIN_SENTENCES);
  if (missing.length) console.warn(`still missing: ${missing.join(", ")}`);
  console.log(`\nWrote ${Object.keys(byKanji).length} kanji to ${SENTENCES_PATH}.`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}