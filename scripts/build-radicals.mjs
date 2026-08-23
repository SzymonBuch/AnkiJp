import {
  KANJI_DATA_PATH,
  RADICALS_DATA_PATH,
  readJsonFile,
  writeJsonFile,
} from "./lib/common.mjs";

/**
 * Radicals = the jpdb components of the FINAL deck (kyōiku + grade-0
 * extension), decision #18. Self-fallbacks (component == kanji itself,
 * build-data placeholder for single-element kanji) are not jpdb components
 * and never gate anything (#2), so they are excluded here — verify.mjs
 * mirrors that exclusion in rule #19.
 *
 * Output: [{glyph, keyword}] unique, sorted by usage frequency across the
 * deck (most-used first); pos of a radical card is its index in this order
 * (decision #15).
 */
function main() {
  const deck = readJsonFile(KANJI_DATA_PATH, []);
  if (!deck.length) throw new Error("kanji.json is empty");

  const byGlyph = new Map();
  const firstAppearance = new Map();
  for (const entry of deck) {
    for (const r of entry.radicals ?? []) {
      if (!r.glyph || r.glyph === entry.kanji) continue;
      if (!firstAppearance.has(r.glyph)) firstAppearance.set(r.glyph, firstAppearance.size);
      const existing = byGlyph.get(r.glyph);
      if (existing) existing.usedIn += 1;
      else byGlyph.set(r.glyph, { glyph: r.glyph, keyword: r.keyword, usedIn: 1 });
    }
  }

  // First appearance order is the deterministic tiebreak.
  const radicals = [...byGlyph.values()].sort(
    (a, b) =>
      b.usedIn - a.usedIn ||
      (firstAppearance.get(a.glyph) ?? Infinity) - (firstAppearance.get(b.glyph) ?? Infinity),
  );
  writeJsonFile(RADICALS_DATA_PATH, radicals, true);

  const counts = radicals.map((r) => r.usedIn);
  console.log(`Wrote ${radicals.length} radicals to ${RADICALS_DATA_PATH}`);
  console.log(
    JSON.stringify({
      total: radicals.length,
      maxUsedIn: Math.max(...counts),
      minUsedIn: Math.min(...counts),
      singleUse: counts.filter((c) => c === 1).length,
    }),
  );
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
