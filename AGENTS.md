# AGENTS.md

AnkiJp is a fully offline React PWA for learning radicals (部首), kanji and vocabulary (単語) with Anki-style SM-2 SRS, gating (radical → kanji → word chains) and quizzes. No backend; all data is bundled and SRS state lives in the browser's IndexedDB. The deck is the 1,006 教育漢字 plus a grade-0 extension of extra kanji pulled in by the top-2000 vocabulary.

## Commands

- `npm run dev` — Vite dev server (PWA service worker is active in dev via `devOptions.enabled`; use a fresh window / hard reload if stale SW caches confuse you).
- `npm run build` — `tsc -b` (type-check) **then** `vite build`. This is the typecheck command; there is no separate `typecheck` script.
- `npm run lint` — oxlint (not ESLint). Config in `.oxlintrc.json`.
- `npm test` — `vitest run`. Tests are `src/lib/*.test.ts`; run one file with `npx vitest run src/lib/srs.test.ts`.
- `npm run preview` — preview the production build; use this for realistic PWA/service-worker checks.

Verify a change with `npm run lint && npm test && npm run build`.

## Architecture

- `src/screens/` — route screens (Dashboard, Deck, Study, Review, Quiz, Stats, Settings). Navigation is a simple state switch, see `src/lib/nav.ts`.
- `src/components/` — shared UI (StudyCard, SessionView, RatingButtons, KanjiDetail, Furigana, RadicalCard/VocabCard, quiz views).
- `src/lib/` — all logic: `srs.ts` (SM-2 + namespaced card ids `k:`/`r:`/`w:`), `db.ts` (IndexedDB via `idb`, DB v3), `gating.ts` (component gating), `mixed.ts` (mixed-session ordering), `kanji.ts` / `radicals.ts` / `vocab.ts` (data access), `quiz.ts`, `stats.ts`, session hooks.
- `src/data/kanji.json` (kyōiku + grade-0 extension), `src/data/radicals.json` and `src/data/vocab.json` are committed, generated datasets. Don't edit them by hand — regenerate via the data pipeline below.

## Data pipeline (scripts/*.mjs)

One-off Node scripts that regenerate `src/data/kanji.json`, `src/data/radicals.json` and `src/data/vocab.json`:

- `npm run data:pipeline` runs the whole chain; `npm run data:verify` must pass 100% before committing.
- Network-dependent (`kanjiapi.dev`, scraping `jpdb.io`, Tatoeba dumps, JMdict). Fetch scripts cache intermediates in `scripts/out/` (gitignored) and are resumable/rate-limited.
- Steps: `data:kyoiku` → `data:jpdb` → `data:vocab` (top-2000 selection) → `data:extend` (grade-0 deck extension) → `data:tatoeba` → `data:mnemonics` → `data:build` → `data:radicals` (after the final deck, PLAN #18) → `data:vocabjson` → `data:verify`.
- `extensions.json` accumulates the whole grade-0 tail — `data:build` refuses to rebuild when it is missing but the committed deck already carries the extension; rerun `data:extend` to regenerate it from the deck without refetching.
- Furigana for vocab comes only from mechanical keb↔reb alignment; a failure is a hard error (no whole-word-ruby fallback — wrong ruby teaches wrong readings).
- Mnemonics: kanji with `mnemonicSource: "ai"` have an empty `mnemonic` pending a **manual** step — the user runs `scripts/out/mnemonics-ai-input.json` through an AI and writes results to `scripts/out/mnemonics-ai.json`. Don't invent mnemonics yourself; only the user fills these.
- `scripts/lib/common.mjs` has the shared paths/helpers (`common.mjs`, `jpdb-parser.mjs`).

## TypeScript gotchas

- `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `erasableSyntaxOnly: true` — no enums, namespaces, or parameter properties.
- `noUnusedLocals` / `noUnusedParameters` — dead code fails the build.
- TypeScript 7.0.2 (native compiler); project uses project references (`tsconfig.app.json` for `src/`, `tsconfig.node.json` for `vite.config.ts`).

## Testing quirks

- IndexedDB tests need `import 'fake-indexeddb/auto'` at the top of the file (see `src/lib/db.test.ts`). Pure-logic tests (`srs`, `quiz`, `stats`) don't.
- DB tests persist state across a simulated reload (close + reopen); treat the DB as the source of truth for queue/session behavior.

## Other

- `PLAN.md` (in Polish) is the design/roadmap doc and the source of truth for data sourcing decisions and acceptance criteria; `README.md` covers usage/deployment.
- SRS behavior in `src/lib/srs.ts` deliberately mirrors Anki (SM-2 steps, ease 130–500%, fuzz ±5%, 36500-day cap). When in doubt, match Anki's behavior; don't reimplement.
- Requires Node.js 24+ and npm 11+.