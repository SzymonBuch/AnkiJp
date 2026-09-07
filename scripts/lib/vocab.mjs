import { katakanaToHiragana } from "./common.mjs";

// Vocabulary-selection helpers shared by select-vocab.mjs (production) and
// verify.mjs (independent re-validation of the same deterministic rules).

export const KANJI_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Kanji-class characters for reading alignment: 々 repeats the previous
 * kanji (人々, 時々) and must be segmented as kanji, even though it is never
 * itself a learnable card glyph. */
const ALIGN_KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005]/;

/** Misc tags disqualifying a JMdict sense in the homograph cascade (#13). */
const TAINTED_TAGS = new Set(["arch", "obsc", "rare"]);

function normReading(text) {
  return katakanaToHiragana(text);
}

/**
 * Mechanically align the written form (keb) against its reading (reb) and
 * pre-render `<ruby>base<rt>reading</rt></ruby>` HTML — same convention as
 * the existing Sentence.furigana. Kana runs of the keb must match the reading
 * verbatim; kanji runs greedily consume the shortest reading chunk that lets
 * the rest align (backtracking). Returns null when the pair cannot be aligned
 * (callers fall back to tokenizer-based furigana).
 */
export function alignFurigana(keb, reb) {
  const chars = [...keb];
  const segments = [];
  for (const ch of chars) {
    const isKanji = ALIGN_KANJI_RE.test(ch);
    const last = segments[segments.length - 1];
    if (last && last.isKanji === isKanji) last.text += ch;
    else segments.push({ isKanji, text: ch });
  }
  const rebChars = [...reb];
  const rebNorm = rebChars.map(normReading);

  function consume(segIdx, pos, acc) {
    if (segIdx === segments.length) return pos === rebChars.length ? acc : null;
    const seg = segments[segIdx];
    if (!seg.isKanji) {
      const text = [...seg.text];
      if (text.length > rebChars.length - pos) return null;
      for (let i = 0; i < text.length; i++) {
        if (normReading(text[i]) !== rebNorm[pos + i]) return null;
      }
      return consume(segIdx + 1, pos + text.length, [...acc, { base: seg.text, reading: null }]);
    }
    const remainingSegments = segments
      .slice(segIdx + 1)
      .reduce((sum, s) => sum + [...s.text].length, 0);
    const maxLen = rebChars.length - pos - remainingSegments;
    for (let len = 1; len <= maxLen; len++) {
      const result = consume(
        segIdx + 1,
        pos + len,
        [...acc, { base: seg.text, reading: rebChars.slice(pos, pos + len).join("") }],
      );
      if (result) return result;
    }
    return null;
  }

  const pieces = consume(0, 0, []);
  if (!pieces) return null;
  return pieces
    .map((p) =>
      p.reading ? `<ruby>${p.base}<rt>${p.reading}</rt></ruby>` : p.base,
    )
    .join("");
}

/**
 * Index jmdict-simplified entries for the cascade: keb → entries plus a
 * kana → entries map used for purely-kana ranking terms (their JMdict entries
 * usually also carry kanji spellings, e.g. jpdb できる vs JMdict 出来る).
 */
export function buildJmdictIndex(entries) {
  const byKeb = new Map();
  const byKana = new Map();
  for (const entry of entries) {
    for (const k of entry.kanji) {
      const list = byKeb.get(k.text) ?? [];
      list.push(entry);
      byKeb.set(k.text, list);
    }
    for (const k of entry.kana) {
      const list = byKana.get(k.text) ?? [];
      list.push(entry);
      byKana.set(k.text, list);
    }
  }
  return { byKeb, byKana };
}

function isTainted(entry) {
  return entry.sense.some((s) => (s.misc ?? []).some((m) => TAINTED_TAGS.has(m)));
}

function isCommon(entry) {
  return [...entry.kanji, ...entry.kana].some((x) => x.common === true);
}

/**
 * Match quality for one candidate entry:
 *   2 — full pair match where the matched kana spelling is common
 *       (kanji term: keb==term && reading on a common kana element;
 *       kana term: the matching kana element itself is common),
 *   1 — pair match through a non-common kana spelling,
 *   0 — kanji-spelling match only (no reading agreement).
 * Purely-kana jpdb terms are ambiguous between JMdict homophones (jpdb's
 * いる covers 居る/要る/入る alike); preferring common spellings keeps e.g.
 * 入る (kana いる not common) out of いる's way.
 */
function matchQuality(entry, term, readingNorm) {
  const isKanjiTerm = KANJI_CHAR_RE.test(term);
  if (isKanjiTerm) {
    const hasKeb = entry.kanji.some((k) => k.text === term);
    if (!hasKeb) return 0;
    const readingMatch = entry.kana.filter((k) => normReading(k.text) === readingNorm);
    if (!readingMatch.length) return 0;
    return readingMatch.some((k) => k.common === true) ? 2 : 1;
  }
  // Kana terms come pre-indexed by their kana text.
  const spellings = entry.kana.filter((k) => k.text === term);
  return spellings.some((k) => k.common === true) ? 2 : 1;
}

/**
 * Deterministic homograph cascade (decision #13): full pair match (preferring
 * common kana spellings) → drop arch/obsc/rare-tagged entries (falling back
 * to them only if nothing else remains) → prefer common entries → for purely
 * kana terms prefer kana-headword entries → lowest entID. Returns null when
 * the term is unknown to JMdict entirely. `resolution` reports which fallback
 * stages fired so verify can audit the choices.
 */
export function chooseJmdictEntry(index, term, reading) {
  const candidates = KANJI_CHAR_RE.test(term)
    ? (index.byKeb.get(term) ?? [])
    : (index.byKana.get(term) ?? []);
  if (!candidates.length) return null;

  const readingNorm = normReading(reading);
  let bestQuality = -1;
  for (const entry of candidates) {
    bestQuality = Math.max(bestQuality, matchQuality(entry, term, readingNorm));
  }
  const pool = candidates.filter(
    (e) => matchQuality(e, term, readingNorm) === bestQuality,
  );

  const clean = pool.filter((e) => !isTainted(e));
  const afterTags = clean.length ? clean : pool;
  const common = afterTags.filter(isCommon);
  const afterCommon = common.length ? common : afterTags;

  let afterHeadword = afterCommon;
  let headwordFallback = false;
  if (!KANJI_CHAR_RE.test(term)) {
    const kanaHeadwords = afterCommon.filter((e) => e.kanji.length === 0);
    if (kanaHeadwords.length) {
      afterHeadword = kanaHeadwords;
      headwordFallback = kanaHeadwords.length === afterCommon.length ? false : true;
    }
  }

  // entIds are 7-digit numeric strings — compare numerically for the
  // lowest-id tiebreak.
  const entry = afterHeadword.reduce((best, e) =>
    Number(e.id) < Number(best.id) ? e : best,
  );

  return {
    entry,
    resolution: {
      matchedReading: bestQuality >= 1,
      commonSpelling: bestQuality === 2,
      tagFallback: clean.length === 0,
      commonFallback: common.length === 0,
      headwordFallback,
    },
  };
}

/** All glosses of the chosen entry, deduplicated preserving order (#14). */
export function allMeanings(entry) {
  const seen = new Set();
  const out = [];
  for (const sense of entry.sense) {
    for (const gloss of sense.gloss) {
      if (!seen.has(gloss.text)) {
        seen.add(gloss.text);
        out.push(gloss.text);
      }
    }
  }
  return out;
}

/** Display meaning: glosses of the first sense, at most three (#14). */
export function displayMeaning(entry) {
  const glosses = (entry.sense[0]?.gloss ?? []).slice(0, 3).map((g) => g.text);
  return glosses.join(", ");
}
