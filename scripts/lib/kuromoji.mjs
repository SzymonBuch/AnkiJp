import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";
import { katakanaToHiragana } from "./common.mjs";

/** Load the kuromoji tokenizer bundled in node_modules (pipeline-only). */
export function loadTokenizer() {
  const dictPath = fileURLToPath(new URL("../../node_modules/kuromoji/dict", import.meta.url));
  return new Promise((resolve, reject) => {
    kuromoji
      .builder({ dicPath: dictPath })
      .build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
  });
}

export const KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * True when `text` is a dictionary (non-inflected) form: every token's
 * basic_form equals its surface (or is unmarked). Also returns the tokens so
 * callers can apply additional POS rules without re-tokenizing.
 */
export function analyzeForm(tokenizer, text) {
  const tokens = tokenizer.tokenize(text);
  const inflected = tokens.some(
    (t) => t.basic_form && t.basic_form !== "*" && t.basic_form !== t.surface_form,
  );
  return { tokens, inflected };
}

/**
 * Pre-render `<ruby>` HTML for a sentence/word via tokenizer readings —
 * same convention as the jpdb scrape output (`<ruby>漢字<rt>かんじ</rt></ruby>`).
 */
export function toFurigana(text, tokenizer) {
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
