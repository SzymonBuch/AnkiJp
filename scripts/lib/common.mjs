import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = path.join(ROOT, "scripts", "out");
export const PAGES_DIR = path.join(OUT_DIR, "pages");
export const KYOIKU_PATH = path.join(OUT_DIR, "kyoiku.json");
export const JPDB_SCRAPE_PATH = path.join(OUT_DIR, "jpdb-scrape.json");
export const AI_INPUT_PATH = path.join(OUT_DIR, "mnemonics-ai-input.json");
export const AI_PATH = path.join(OUT_DIR, "mnemonics-ai.json");
export const TATOEBA_SENTENCES_PATH = path.join(OUT_DIR, "tatoeba", "tatoeba-sentences.json");
export const TATOEBA_VOCAB_SENTENCES_PATH = path.join(
  OUT_DIR,
  "tatoeba",
  "tatoeba-vocab-sentences.json",
);
export const KANJI_DATA_PATH = path.join(ROOT, "src", "data", "kanji.json");
export const RADICALS_DATA_PATH = path.join(ROOT, "src", "data", "radicals.json");
export const VOCAB_DATA_PATH = path.join(ROOT, "src", "data", "vocab.json");

// Etap 3 intermediates.
export const JPDB_FREQ_CSV_PATH = path.join(OUT_DIR, "jpdb-v22-freq.csv");
export const JMDICT_ZIP_PATH = path.join(OUT_DIR, "jmdict-eng.json.zip");
export const JMDICT_JSON_PATH = path.join(OUT_DIR, "jmdict-eng.json");
export const VOCAB_SELECTION_PATH = path.join(OUT_DIR, "vocab-selection.json");
export const EXTENSIONS_PATH = path.join(OUT_DIR, "extensions.json");
export const EXTENSION_API_CACHE_PATH = path.join(OUT_DIR, "extension-kanjiapi.json");
/** Committed (not cached): curated JMdict entId overrides for kana homophones. */
export const VOCAB_OVERRIDES_PATH = path.join(ROOT, "scripts", "vocab-overrides.json");

/**
 * Pinned sources for the vocabulary selection ranking (decision: third-party
 * snapshot instead of scraping jpdb.io — their terms of use forbid automated
 * access). The CSV is the JPDB v2.2 frequency list by Kuuuube (columns:
 * term, reading, frequency rank, kana frequency), pinned to a commit for
 * reproducibility. JMdict content comes from jmdict-simplified (EDRDG
 * license), pinned to a release tag.
 */
export const JPDB_FREQ_CSV_URL =
  "https://raw.githubusercontent.com/Kuuuube/yomitan-dictionaries/" +
  "d6fde809e3f26eb5aed6d41896f332179044998c/data/jpdb_v2.2_freq_list_2024-10-13.csv";
export const JMDICT_VERSION = "3.6.2+20260817122448";
export const JMDICT_URL =
  "https://github.com/scriptin/jmdict-simplified/releases/download/" +
  `${encodeURIComponent(JMDICT_VERSION)}/jmdict-eng-${encodeURIComponent(JMDICT_VERSION)}.json.zip`;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readJsonFile(filePath, fallback = null) {
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, "utf8"))
    : fallback;
}

export function writeJsonFile(filePath, data, compact = false) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    (compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)) + "\n",
    "utf8",
  );
}

export function katakanaToHiragana(str) {
  const special = { "ヶ": "け", "ヵ": "か" };
  return [...str].map((ch) => {
    if (special[ch]) return special[ch];
    const code = ch.codePointAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
    return ch;
  }).join("");
}

export function normalizeKunReading(str) {
  return str
    .replace(/\./g, "")
    .replace(/[・-]+$/g, "")
    .trim();
}

const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
};

export function decodeHtml(str) {
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const DEFAULT_USER_AGENT = "AnkiJp-data-pipeline/0.1 (one-off data build; contact: dev)";

export async function fetchWithRetry(url, { retries = 4, retryDelayMs = 500, userAgent = DEFAULT_USER_AGENT } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "*/*" },
      });
      if (res.status === 429 || res.status === 503) {
        throw new Error(`HTTP ${res.status} (rate limited)`);
      }
      if (!res.ok) {
        // 404/410 never recover on retry — give up immediately.
        const err = new Error(`HTTP ${res.status} for ${url}`);
        if (res.status === 404 || res.status === 410) err.permanent = true;
        throw err;
      }
      return await res.text();
    } catch (err) {
      if (err.permanent) throw err;
      lastErr = err;
      if (attempt < retries) {
        const backoff = retryDelayMs * 2 ** attempt + Math.random() * retryDelayMs;
        await sleep(backoff);
      }
    }
  }
  throw new Error(`Failed after ${retries + 1} attempts: ${lastErr.message}`);
}

export async function fetchJson(url, options = {}) {
  const text = await fetchWithRetry(url, options);
  return JSON.parse(text);
}

export async function downloadFile(url, filePath, options = {}) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
  console.log(`downloading ${url}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const retries = options.retries ?? 3;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "*/*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(2000 * 2 ** attempt + Math.random() * 1000);
      }
    }
  }
  throw new Error(`Download failed after ${retries + 1} attempts: ${lastErr.message}`);
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function createRateLimiter(minGapMs) {
  let last = 0;
  return async function beforeRequest() {
    const now = Date.now();
    const wait = Math.max(0, last + minGapMs - now);
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}