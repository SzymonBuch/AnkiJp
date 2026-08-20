# AnkiJp

PWA for learning the 1,006 joyo kanji with Anki-style SRS (SM-2) and quizzes in the style of kanjiquizzer.com. UI and translations are in English. Runs fully offline once installed.

## Stack

- Vite + React + TypeScript + Tailwind CSS v4
- `vite-plugin-pwa` (offline installable PWA)
- IndexedDB via `idb` for SRS state

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Scripts

`scripts/` holds the one-off data pipeline (fetching kanji list, jpdb scraping, mnemonic preparation, data assembly). See `PLAN.md` for the full roadmap.

### Data pipeline

The data scripts (`src/data/kanji.json`) are generated from public sources:

```bash
npm run data:kyoiku     # fetch 1,006 教育漢字 + readings/meanings from kanjiapi.dev
npm run data:jpdb       # scrape jpdb.io kanji pages (cached in scripts/out/pages/)
npm run data:tatoeba    # Tatoeba fallback sentences for kanji with few examples
npm run data:mnemonics  # list kanji still missing a mnemonic for AI fill-in
npm run data:build      # merge everything into src/data/kanji.json
npm run data:verify     # sanity checks (must pass 100%)
npm run data:pipeline   # run the whole chain
```

Intermediates are cached in `scripts/out/` (gitignored); scraping is resumable and rate-limited.

## License / Attribution

Data sources and their licenses are documented in `ATTRIBUTIONS.md`.