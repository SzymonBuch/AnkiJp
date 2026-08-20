import fs from "node:fs";
import path from "node:path";
import {
  PAGES_DIR,
  KYOIKU_PATH,
  JPDB_SCRAPE_PATH,
  readJsonFile,
  writeJsonFile,
  sleep,
  fetchWithRetry,
  mapLimit,
  createRateLimiter,
} from "./lib/common.mjs";
import { parseJpdbPage } from "./lib/jpdb-parser.mjs";

const BASE_URL = "https://jpdb.io";
const CONCURRENCY = 5;
const RATE_LIMIT_MS = 250;
const MAX_ATTEMPTS = 6;
const SENTENCE_TARGET = 3;
const MIN_SENTENCES = 2;
const SAVE_EVERY = 20;

const force = process.argv.includes("--force");

function pagePath(hex, expanded) {
  return path.join(PAGES_DIR, `${hex}${expanded ? ".e" : ""}.html`);
}

function readCache(hex, expanded) {
  const file = pagePath(hex, expanded);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function savePage(hex, expanded, html) {
  const file = pagePath(hex, expanded);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, "utf8");
}

function deleteCache(hex, expanded) {
  const file = pagePath(hex, expanded);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function sortKey(sentence) {
  return sentence.jp.length;
}

function selectSentences(examples, glyph, limit = SENTENCE_TARGET) {
  const candidates = examples
    .filter((e) => e.jp.includes(glyph))
    .sort((a, b) => sortKey(a) - sortKey(b));
  return candidates.slice(0, limit);
}

async function fetchPageWithRetry(url, hex, expanded, maxAttempts = MAX_ATTEMPTS) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const html = await fetchWithRetry(url, { retries: 3, retryDelayMs: 1000 });
      const parsed = parseJpdbPage(html);
      if (!parsed.ok) {
        // Blocked/captcha page — discard so we always re-fetch on resume.
        throw new Error(`invalid page (${parsed.reason})`);
      }
      savePage(hex, expanded, html);
      return parsed;
    } catch (err) {
      lastErr = err;
      deleteCache(hex, expanded);
      await sleep(600 * (attempt + 1) + Math.random() * 400);
    }
  }
  throw new Error(`give up after ${maxAttempts} attempts: ${lastErr.message}`);
}

async function scrapeOne(limiter, glyph) {
  const hex = glyph.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  const url = `${BASE_URL}/kanji/${encodeURIComponent(glyph)}`;

  // Default page (cached when present).
  let cached = readCache(hex, false);
  let source = cached;
  let parsed;
  if (source !== null) {
    parsed = parseJpdbPage(source);
    if (!parsed.ok) {
      deleteCache(hex, false);
      cached = null;
    }
  }
  if (cached === null) {
    await limiter();
    parsed = await fetchPageWithRetry(url, hex, false);
  }

  let sentences = selectSentences(parsed.examples, glyph);
  let keyword = parsed.keyword;
  let radicals = parsed.radicals;
  let mnemonic = parsed.mnemonic;
  const vocab = parsed.vocab
    .slice()
    .sort((a, b) => sortKey(a) - sortKey(b))
    .slice(0, 6);

  // Expand to the full example list only when the default page lacks enough.
  if (sentences.length < MIN_SENTENCES) {
    const expCached = readCache(hex, true);
    if (expCached !== null) {
      const expParsed = parseJpdbPage(expCached);
      if (expParsed.ok) {
        const expSentences = selectSentences(expParsed.examples, glyph);
        if (expSentences.length > sentences.length) {
          parsed = expParsed;
          sentences = expSentences;
          keyword = parsed.keyword;
          radicals = parsed.radicals;
          mnemonic = parsed.mnemonic;
        }
      }
    } else {
      await limiter();
      const expParsed = await fetchPageWithRetry(`${url}?expand=e`, hex, true);
      const expSentences = selectSentences(expParsed.examples, glyph);
      if (expSentences.length > sentences.length) {
        parsed = expParsed;
        sentences = expSentences;
        keyword = parsed.keyword;
        radicals = parsed.radicals;
        mnemonic = parsed.mnemonic;
      }
    }
  }

  return {
    hex,
    keyword,
    radicals: radicals ?? [{ glyph, keyword }],
    mnemonic,
    sentences,
    vocab,
  };
}

async function main() {
  const kyoiku = readJsonFile(KYOIKU_PATH, []);
  if (!kyoiku.length || kyoiku.length !== 1006) {
    throw new Error("kyoiku.json missing or incomplete — run fetch-kyoiku.mjs first.");
  }
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  const scraped = readJsonFile(JPDB_SCRAPE_PATH, {});
  const pending = kyoiku.filter((k) => force || !(k.kanji in scraped));
  console.log(`Scraping jpdb.io for ${pending.length} kanji...`);

  const limiter = createRateLimiter(RATE_LIMIT_MS);
  const problems = [];
  let done = 0;

  await mapLimit(pending, CONCURRENCY, async (record, idx) => {
    const glyph = record.kanji;
    const hex = glyph.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    try {
      const result = await scrapeOne(limiter, glyph);
      scraped[glyph] = {
        hex,
        keyword: result.keyword,
        radicals: result.radicals,
        mnemonic: result.mnemonic,
        sentences: result.sentences,
        vocab: result.vocab,
      };
      if (result.sentences.length < MIN_SENTENCES) {
        problems.push(`${glyph}: only ${result.sentences.length} valid sentence(s)`);
      }
    } catch (err) {
      problems.push(`${glyph}: ${err.message}`);
    }
    done += 1;
    if (idx % 10 === 0 || done === pending.length) {
      console.log(`progress ${done}/${pending.length} (last: ${glyph})`);
    }
    if (idx % SAVE_EVERY === 0) {
      writeJsonFile(JPDB_SCRAPE_PATH, scraped);
    }
  });

  writeJsonFile(JPDB_SCRAPE_PATH, scraped);

  console.log(`\nDone. ${Object.keys(scraped).length} kanji scraped.`);
  if (problems.length) {
    console.warn(`\n${problems.length} problem(s):`);
    for (const p of problems) console.warn("  - " + p);
  } else {
    console.log("No scraping problems.");
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}