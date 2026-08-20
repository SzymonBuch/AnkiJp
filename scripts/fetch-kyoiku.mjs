import {
  KYOIKU_PATH,
  fetchJson,
  katakanaToHiragana,
  normalizeKunReading,
  mapLimit,
  createRateLimiter,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

const GRADES = [1, 2, 3, 4, 5, 6];
const TARGET_COUNT = 1006;
const CONCURRENCY = 8;
const RATE_LIMIT_MS = 60;

const force = process.argv.includes("--force");

async function main() {
  const existing = readJsonFile(KYOIKU_PATH, []);
  if (!force && existing.length >= TARGET_COUNT) {
    console.log(`kyoiku.json already has ${existing.length} entries (use --force to re-download).`);
    return;
  }

  const gradeLists = {};
  for (const grade of GRADES) {
    const glyphs = await fetchJson(`https://kanjiapi.dev/v1/kanji/grade-${grade}`);
    gradeLists[grade] = glyphs;
    console.log(`grade ${grade}: ${glyphs.length} kanji`);
  }
  const total = Object.values(gradeLists).reduce((acc, g) => acc + g.length, 0);
  if (total !== TARGET_COUNT) {
    throw new Error(`Expected ${TARGET_COUNT} kanji, got ${total}`);
  }

  const pending = [];
  for (const grade of GRADES) {
    for (const glyph of gradeLists[grade]) pending.push({ glyph, grade });
  }

  const since = new Map(); // resume support: skip glyphs already in kyoiku.json
  for (const record of existing) since.set(record.kanji, true);
  const todos = pending.filter((p) => force || !since.has(p.glyph));
  console.log(`Fetching details for ${todos.length} kanji from kanjiapi.dev...`);

  const limiter = createRateLimiter(RATE_LIMIT_MS);
  const records = await mapLimit(todos, CONCURRENCY, async ({ glyph, grade }) => {
    await limiter();
    const d = await fetchJson(`https://kanjiapi.dev/v1/kanji/${encodeURIComponent(glyph)}`);
    const record = {
      kanji: glyph,
      grade,
      on: (d.on_readings ?? []).map(katakanaToHiragana),
      kun: (d.kun_readings ?? []).map(normalizeKunReading),
      meanings: d.meanings ?? [],
      strokeCount: d.stroke_count ?? null,
      jlpt: d.jlpt ?? null,
      unicode: d.unicode ?? null,
    };
    return record;
  });

  const byKanji = new Map(existing.map((r) => [r.kanji, r]));
  for (const record of records) byKanji.set(record.kanji, record);

  const merged = [];
  for (const { glyph } of pending) merged.push(byKanji.get(glyph));

  writeJsonFile(KYOIKU_PATH, merged);
  console.log(`Wrote ${merged.length} entries to ${KYOIKU_PATH}.`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}