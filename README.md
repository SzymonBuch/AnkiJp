# AnkiJp

PWA for learning the 1,006 joyo kanji with Anki-style SRS (SM-2) and quizzes in the style of kanjiquizzer.com. UI and translations are in English. Runs fully offline once installed.

## Features

- Anki-style SM-2 spaced repetition (Again / Hard / Good / Easy) for all 1,006 教育漢字
- Study new cards and review due cards in daily sessions
- Quizzes over kanji you already know (reading, meaning, reverse) — isolated from SRS
- Deck browser with status filters, search, and full card details
- Statistics (reviews per day, retention, accuracy, streaks) from local history
- Fully offline: all data is bundled and SRS state lives in your browser's IndexedDB

## Stack

- Vite + React + TypeScript + Tailwind CSS v4
- `vite-plugin-pwa` (offline installable PWA)
- IndexedDB via `idb` for SRS state

## Requirements

- Node.js 24+ and npm 11+ for development/builds
- A modern browser (Chrome, Edge, Firefox, Safari) for using the app

## Install as a PWA

AnkiJp is a progressive web app, so it installs like a native app and works offline on your
phone and desktop.

### Android (Chrome)

1. Open the app URL in Chrome.
2. Tap the menu (⋮) → **Install app** (or **Add to Home screen**).
3. Confirm, and an app icon is placed on your home screen.

### iPhone / iPad (Safari)

1. Open the app URL in Safari.
2. Tap the **Share** button (square-and-arrow).
3. Tap **Add to Home Screen** and confirm.

### Desktop (Chrome / Edge)

1. Open the app URL.
2. Click the **install icon** in the address bar (or menu → **Install AnkiJp**).

### Offline note

Once installed (or after one visit, thanks to the service worker), the app works without an
internet connection. Your SRS progress is stored locally on the device in IndexedDB and is not
synced — clear browser data or uninstall removes it. Use **Settings → Export statistics** to
keep a backup.

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Quality checks

```bash
npm test         # unit tests (SM-2, IndexedDB, quiz, stats)
npm run lint     # oxlint
npm run build    # tsc + vite build
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

## Deployment

The app is a static bundle (`dist/` after `npm run build`), so it can be hosted anywhere
static files are served over HTTPS (required for installable PWAs).

### GitHub Pages

1. Set `base` in `vite.config.ts` to your project path, e.g. `/AnkiJp/` for `<user>.github.io/AnkiJp`.
2. Build and push `dist/` to the `gh-pages` branch, or use the `peaceiris/actions-gh-pages` GitHub Action with `enable_jekyll: false`.

### Netlify

Build command: `npm run build` · Publish directory: `dist`.
Deploy via drag-and-drop of `dist/`, the `netlify deploy` CLI, or connect the repo.

### Vercel

Framework preset: **Vite** · Build command: `npm run build` · Output directory: `dist`.

> Because the app is fully client-side, no serverless config or environment variables are needed.

## License / Attribution

Data sources and their licenses are documented in `ATTRIBUTIONS.md`. The application shows a
condensed version of these credits ("Data sources & attribution" on the dashboard); the full
licenses cover Tatoeba (CC BY 2.0), KANJIDIC/EDRDG (EDRDG licence), kanjiapi.dev, jpdb and Kuromoji.