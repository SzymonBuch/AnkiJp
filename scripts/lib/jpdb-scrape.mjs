import fs from "node:fs";
import path from "node:path";
import {
  PAGES_DIR,
  sleep,
  fetchWithRetry,
  createRateLimiter,
} from "./common.mjs";
import { parseJpdbPage } from "./jpdb-parser.mjs";

// Shared scraping primitives for jpdb.io kanji pages. Used by the bulk
// fetch-jpdb step (kyōiku base) and by extend-deck (grade-0 extension), so
// both share one page cache and identical retry/captcha handling.

const BASE_URL = "https://jpdb.io";
export const JPDB_CONCURRENCY = 5;
export const JPDB_RATE_LIMIT_MS = 250;
const MAX_ATTEMPTS = 6;
const SENTENCE_TARGET = 3;
const MIN_SENTENCES = 2;

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

export async function scrapeOne(limiter, glyph) {
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

/**
 * Scrape every glyph of `glyphs` missing from `scraped` into it.
 * Resumable (per-glyph cache files + in-memory store), rate-limited and
 * concurrent exactly like the historical fetch-jpdb behavior. `onSave` is
 * invoked periodically so callers can checkpoint the store. Returns the
 * list of per-glyph problems (never throws for individual glyphs).
 */
export async function scrapeMissing(glyphs, scraped, { label = "", onSave } = {}) {
  const pending = glyphs.filter((g) => !(g in scraped));
  if (!pending.length) return [];
  console.log(`Scraping jpdb.io${label ? ` ${label}` : ""}: ${pending.length} kanji...`);

  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const limiter = createRateLimiter(JPDB_RATE_LIMIT_MS);
  const problems = [];
  let done = 0;

  // Sequential-in-worker map with shared limiter keeps the global rate limit
  // honest while still overlapping request latency.
  const workers = Array.from({ length: Math.min(JPDB_CONCURRENCY, pending.length) }, async () => {
    while (true) {
      const i = done;
      if (i >= pending.length) return;
      done += 1;
      const glyph = pending[i];
      try {
        scraped[glyph] = await scrapeOne(limiter, glyph);
      } catch (err) {
        problems.push(`${glyph}: ${err.message}`);
      }
      if (i % 10 === 0 || i === pending.length - 1) {
        console.log(`progress ${i + 1}/${pending.length} (last: ${glyph})`);
        onSave?.();
      }
    }
  });
  await Promise.all(workers);
  return problems;
}
