import { parse } from "node-html-parser";
import { decodeHtml } from "./common.mjs";

const SUBSECTION_LABEL = "h6.subsection-label";

function unwrapHighlight(node) {
  const clone = node.clone();
  for (const span of clone.querySelectorAll("span.highlight")) {
    span.replaceWith(...span.childNodes);
  }
  return clone;
}

function unwrapLinks(node) {
  const clone = node.clone();
  for (const a of clone.querySelectorAll("a")) {
    a.replaceWith(...a.childNodes);
  }
  return clone;
}

function plainJp(node) {
  const clone = unwrapHighlight(unwrapLinks(node));
  for (const rt of clone.querySelectorAll("rt")) rt.remove();
  return clone.text.replace(/\s+/gu, " ").trim();
}

function furiganaHtml(node) {
  return decodeHtml(unwrapHighlight(unwrapLinks(node)).innerHTML).replace(/\s+/gu, " ").trim();
}

function extractRadicals(root) {
  for (const container of root.querySelectorAll("div.subsection-composed-of-kanji")) {
    const header = container.querySelector(SUBSECTION_LABEL);
    if (header?.text.trim() !== "Composed of") continue;
    const subsection = container.querySelector("div.subsection");
    if (!subsection) return null;
    const radicals = [];
    for (const item of subsection.querySelectorAll(":scope > div")) {
      const spelling = item.querySelector(".spelling");
      const description = item.querySelector(".description");
      if (!spelling || !description) continue;
      const glyph = spelling.text.trim();
      if (!glyph) continue;
      radicals.push({ glyph, keyword: description.text.trim() });
    }
    return radicals.length ? radicals : null;
  }
  return null;
}

function extractMnemonic(root) {
  const node = root.querySelector("div.mnemonic");
  return node ? node.text.replace(/\s+/gu, " ").trim() : "";
}

function extractExamples(root) {
  const container = root.querySelector("div.subsection-examples");
  if (!container) return [];
  const examples = [];
  for (const usedIn of container.querySelectorAll("div.used-in")) {
    const jp = usedIn.querySelector(".jp");
    const en = usedIn.querySelector(".en");
    if (!jp || !en) continue;
    const jpText = plainJp(jp);
    const enText = en.text.replace(/\s+/gu, " ").trim();
    const ruby = furiganaHtml(jp);
    if (!jpText || !enText || !ruby.includes("<rt>")) continue;
    examples.push({ jp: jpText, en: enText, furigana: ruby });
  }
  return examples;
}

function extractVocab(root) {
  const container = root.querySelector("div.subsection-used-in");
  if (!container) return [];
  const vocab = [];
  for (const usedIn of container.querySelectorAll("div.used-in")) {
    const jp = usedIn.querySelector(".jp");
    const en = usedIn.querySelector(".en");
    if (!jp || !en) continue;
    const jpText = plainJp(jp);
    const enText = en.text.replace(/\s+/gu, " ").trim();
    const ruby = furiganaHtml(jp);
    if (!jpText || !enText || !ruby.includes("<rt>")) continue;
    vocab.push({ jp: jpText, en: enText, furigana: ruby });
  }
  return vocab;
}

export function parseJpdbPage(html) {
  const root = parse(html);

  const keywordHeader = root.querySelectorAll(SUBSECTION_LABEL).find(
    (n) => n.text.trim() === "Keyword",
  );
  if (!keywordHeader) {
    return { ok: false, reason: "no Keyword section (page likely blocked or invalid)" };
  }
  const keyword = keywordHeader.nextElementSibling?.text.trim() ?? "";

  return {
    ok: true,
    keyword,
    radicals: extractRadicals(root),
    mnemonic: extractMnemonic(root),
    examples: extractExamples(root),
    vocab: extractVocab(root),
  };
}