# AnkiJp — plan projektu

Aplikacja PWA do nauki kanji (1006 教育漢字) w stylu Anki + tryb quizu w stylu kanjiquizzer.com.
UI i tłumaczenia po angielsku.

---

## Decyzje projektowe

| Obszar | Decyzja |
|---|---|
| Forma | PWA (instalowalna na telefonie, w pełni offline) |
| Stack | Vite + React + TypeScript + Tailwind, `vite-plugin-pwa`, IndexedDB (`idb`) |
| Język UI / tłumaczeń | Angielski |
| Zestaw znaków | 1006 教育漢字 (klasy 1–6, aktualna lista po reformie 2020) |
| SRS | SM-2 (algorytm Anki) z przyciskami Again / Hard / Good / Easy |
| Radicale | Rozkład wg jpdb.io — sekcja „Composed of" ze stron `jpdb.io/kanji/<glif>` |
| Mnemoniki | Ze stron `jpdb.io/kanji/<glif>` (publiczne, bez logowania); brakujące — lista przygotowana przez skrypt, uzupełniana przez użytkownika (AI), oznaczenie `mnemonicSource: "ai"` |
| Zadania przykładowe | Min. 2 na znak: zdania z furiganą (ruby) + tłumaczenie EN bezpośrednio z jpdb; Tatoeba tylko jako fallback |
| Architektura | Brak backendu — dane spakowane w aplikacji, stan SRS lokalnie w IndexedDB |

---

## Źródła danych (zweryfikowane)

1. **Lista 1006 kanji** — `https://kanjiapi.dev/v1/kanji/grade-{1..6}` (80+160+200+200+185+181 = 1006; aktualny 教育漢字 po reformie 2020). Pola: kanji, on/kun, znaczenia EN, grade, stroke_count
2. **Keyword, odczytania z %, radicale, mnemoniki, przykłady** — strony `https://jpdb.io/kanji/<glif>` (publiczne, bez logowania; zweryfikowane 200 OK). Sekcje: Keyword (główne znaczenie EN), Composed of (radicale + keywordy EN), Mnemonic, Examples (ruby furigana + tłumaczenie EN, do 200/kanji)
3. **Fallback zdań** — dumps Tatoeba: `https://downloads.tatoeba.org/exports/links.tar.bz2`, `https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2`, `https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2` (dekodowanie przez bsdtar); furigana fallback: kuromoji.js
4. **Fallback odczytań/znaczeń** — `[Kanji] JPDB Kanji.zip` (repo `MarvNC/yomitan-dictionaries`, raw: `https://github.com/MarvNC/yomitan-dictionaries/raw/master/dl/%5BKanji%5D%20JPDB%20Kanji.zip`, ~381 KB) — tylko odczytania z % i poziom 漢字検定; **brak** radicali, zdań i mnemoników

> Uwaga: wcześniejsza wersja planu zakładała 1026 znaków (liczby sprzed reformy 2020) i nieaktualne URL-e (repo przemianowane `yomichan` → `yomitan`, stara ścieżka Tatoeba). Powyższe adresy zweryfikowane (stan: 2026-08-20).

Atrybucje wymagane licencjami (Tatoeba CC-BY 2.0, EDRDG, jpdb) umieszczone w aplikacji.

---

## Etapy

### Etap 1 — Inicjalizacja projektu
- [x] `npm create vite` (react-ts) w katalogu `AnkiJp`
- [x] Instalacja zależności — wersje zweryfikowane 2026-08-20: najnowsze stabilne (dist-tag `latest`, bez alpha/beta/rc), licencje wolne:

| Pakiet | Wersja | Licencja | Uwagi |
|---|---|---|---|
| `react` / `react-dom` | 19.2.8 | MIT | |
| `vite` | 8.2.2 | MIT | silnik build |
| `@vitejs/plugin-react` | 6.1.0 | MIT | peer: vite ^8 |
| `tailwindcss` | 4.3.3 | MIT | v4 — integracja przez `@tailwindcss/vite` |
| `@tailwindcss/vite` | 4.3.3 | MIT | peer: vite ^5–^8 |
| `vite-plugin-pwa` | 1.3.0 | MIT | peer: vite ^3–^8 + workbox |
| `idb` | 8.0.3 | ISC | IndexedDB |
| `vitest` | 4.1.11 | MIT | devDeps — unit testy SM-2/DB (peer: vite ^6–^8) |
| `fake-indexeddb` | 6.2.5 | Apache-2.0 | devDeps — testy IndexedDB bez przeglądarki |
| `typescript` | 7.0.2 | Apache-2.0 | build TS (Native) |
| `node-html-parser` | 9.0.1 | MIT | devDeps — parsowanie HTML stron jpdb |

Środowisko docelowe: Node 24.19.0 / npm 11.17.0 / git 2.55.0 (repo git pominięte na start).
- [x] Struktura katalogów:
  ```
  src/
    screens/    # Dashboard, Deck, Study, Review, Quiz, Stats, Settings
    components/ # CardFront, CardBack, RatingButtons, KanjiGrid, ...
    lib/        # srs.ts (SM-2), db.ts (IndexedDB)
    data/       # kanji.json (wygenerowany, commitujemy)
  scripts/      # pipeline danych (Node, odpalan jednorazowo)
  ```
- [x] Konfiguracja PWA: manifest, service worker (cache app shell + danych), ikony
- [x] `npm run build` + preview działa offline

**Kryterium akceptacji:** projekt buduje się, PWA instaluje się z ekranu głównego, działa offline.

---

### Etap 2 — Pipeline danych (skrypty w `scripts/`)
- [x] `fetch-kyoiku.mjs` — pobranie list klas 1–6 z kanjiapi.dev + szczegółów per znak → 1006 rekordów (`on`/`kun` w hiraganie, pełne znaczenia, stroke_count, jlpt, unicode) → `scripts/out/kyoiku.json`; resume + `--force`
- [x] `fetch-jpdb.mjs` — scrape `jpdb.io/kanji/<glif>` dla 1006 znaków: concurrency 5, rate-limit 250 ms + retry, cache surowych stron w `scripts/out/pages/` (wznowienie); parsowanie sekcji Keyword, Composed of (radicale + keywordy EN), Mnemonic, Examples (najkrótsze ≥2 z ruby furiganą + tłumaczeniem EN, top 3); `?expand=e` tylko gdy na stronie brak przykładów → `scripts/out/jpdb-scrape.json`
- [x] `prepare-mnemonics.mjs` — kanji bez mnemoników (kanji + główne znaczenie + radicale + odczytania) → `scripts/out/mnemonics-ai-input.json` — wynik: 491/1006 bez mnemonika jpdb
- [x] (fallback w pipeline) `fetch-tatoeba.mjs` — Tatoeba dumps (links, jpn/eng sentences) + kuromoji furigana dla 7 kanji bez ≥2 przykładów na jpdb (郡, 俵, 仁, 后, 孝, 蚕, 陛); 俵 ma 1 zdanie w całym Tatoeba → uzupełnione przykładami słownikowymi jpdb (vocab z ruby+EN)
- [ ] (manualnie) mnemoniki AI — użytkownik przepuszcza `scripts/out/mnemonics-ai-input.json` przez AI i wgrywa wyniki → `scripts/out/mnemonics-ai.json`; bez tego karty mają `mnemonicSource: "ai"` i puste `mnemonic`
- [x] `build-data.mjs` — scalenie `kyoiku.json` + `jpdb-scrape.json` (+ opcjonalnie `tatoeba-sentences.json`, `mnemonics-ai.json`) → `src/data/kanji.json` (1176 KB, kompaktowy JSON)
- [x] `verify.mjs` — sanity checks: 1006 wpisów, odczytania, radicale z keywordami, ≥2 zdania z furiganą+EN, główne znaczenie, unikalność
- [x] `ATTRIBUTIONS.md` + sekcja atrybucji w aplikacji (footer w App.tsx)

**Kryterium akceptacji:** `verify.mjs` przechodzi w 100% ✅ (PASS — 1006 wpisów, min. 2 zdania/znak, brak kanji bez odczytań/znaczenia/radicali; najbliższy brak: mnemoniki AI — 491 szt. do uzupełnienia przez użytkownika).

> Fallbacki (gdy jpdb zablokuje scrape lub zabraknie danych): Tatoeba (URL-e i dekodowanie bsdtar w sekcji źródeł) + kuromoji.js dla furigany; mnemoniki AI; JPDB Kanji.zip tylko dla odczytań z % i poziomów 漢字検定.

---

### Etap 3 — Silnik SRS (SM-2)
- [x] `src/lib/srs.ts` — harmonogram odtwarzający zachowanie Anki:
  - stany karty: `new` → `learning` → `review` (+ `relearning` po lapse)
  - kroki nauki: 1 min, 10 min; **Good** z ostatniego kroku → graduation (interwał 1d)
  - w trakcie nauki: **Again** → krok 1 (1 min); **Hard** → krok wstecz (min. 1 min); **Easy** → natychmiastowa graduation (interwał ~4d jak domyślny Easy Interval Anki)
  - powtórki: **Again** → lapse (relearning 10 min, interwał reset do 1d), ease −20 pkt; **Hard** interwał ×1.2 (min. bieżący+1), ease −15 pkt; **Good** interwał ×ease (ease bez zmian); **Easy** interwał ×ease×1.3, ease +15 pkt
  - ease start 250% (minimum 130%, maks. 500%), fuzz ±5% dla interwałów ≥ 2 dni, max interwał 36500 dni (jak w Anki)
  - per kanji: `{ kanji, pos, state, step, ease, interval, due, reps, lapses }`
- [x] `src/lib/db.ts` — IndexedDB (`idb`): store `cards` (stan SRS, seed 1006 kart z `kanji.json`), `log` (historia odpowiedzi z `prevState`), `settings`; oraz `src/lib/kanji.ts` (typy + lookup danych)
- [x] Kolejka `getSessionQueue()`: zaległe powtórki (due ≤ dzisiaj, limit dzienny powtórek), karty w krokach nauki (1 min/10 min) wracają w tej samej sesji po upływie kroku, limit nowych/dziennie z ustawień; liczniki dzienne wyliczane z `log`

**Kryterium akceptacji:** ✅ 42/42 testy (vitest + fake-indexeddb): SM-2 — interwały i stany zgodne z zachowaniem Anki (kroki 1 min→10 min→graduation 1d, Easy na nowej karcie ~4d, lapse—relearning 10 min, interwały ×1.2/×ease/×ease×1.3, ease 130–500, fuzz ±5%, cap 36500); stan przetrwał przeładowanie strony — test z zamknięciem połączenia i ponownym otwarciem IndexedDB. `npm test`, `npm run lint`, `npm run build` — PASS.

---

### Etap 4 — UI: Study / Review (karty w stylu Anki)
- [x] Przód karty: duży znak + przycisk "Show answer" (enter/space)
- [x] Tył karty:
  - radicale (rozkład wg jpdb)
  - odczytania on/kun w hiraganie
  - znaczenia (EN): jedno główne znaczenie (keyword) — karta reprezentuje jedno "słowo"; pełna lista znaczeń tylko w szczegółach w Deck
  - ≥2 zdania przykładowe z furiganą + tłumaczeniem
  - mnemonik (badge: „jpdb" / „AI-generated")
- [x] Przyciski **Again / Hard / Good / Easy** z kolorami jak Anki (czerw./pomarańcz./ziel./niebieski + skróty 1–4)
- [x] Ekran Study (nowe) i Review (zaległe) korzystające z jednego komponentu karty (`SessionView` + `useStudySession`)
- [x] Nawigacja i koniec sesji (podsumowanie: X nowych, Y powtórek)

**Kryterium akceptacji:** ✅ pełna sesja nowych + powtórek, oceny wpływają na harmonogram (kolejka przebudowywana z IndexedDB po każdej odpowiedzi — karty w krokach nauki wracają w tej samej sesji; `npm test` 42/42, lint, build — PASS).

---

### Etap 5 — Quiz (styl kanjiquizzer.com)
- [x] Tryb 1: znak → poprawny odczyt (4 odpowiedzi do wyboru)
- [x] Tryb 2: znak → znaczenie (4 odpowiedzi)
- [x] Tryb 3 (odwrotny): odczytanie (hiragana) → wybór kanji (4 odpowiedzi)
- [x] Pula pytań: **tylko kanji "znane"** — interwał ≥ 21 dni (próg konfigurowalny) lub ręcznie oznaczone
- [x] Quiz jest jednorazowy i całkowicie odizolowany od SRS — wyniki nie zmieniają stanu kart ani logów
- [x] Ekran podsumowania (wynik %, poprawka błędów)

**Kryterium akceptacji:** ✅ quiz nie pokazuje nieznanych kanji; quiz nie wpływa na stan SRS ani log.

---

### Etap 6 — Deck, Dashboard, Settings
- [x] **Deck**: siatka/list 1006 kanji, filtr status (`new`/`learning`/`due`/`known`), wyszukiwarka, klik → szczegóły karty (pełna lista znaczeń, wszystkie zdania) + ręczne oznaczenie "known"
- [x] **Dashboard**: liczniki (nowe, zaległe, znane, streak), przyciski Study / Review / Quiz / Deck
- [x] **Stats**: ekran statystyk z historii w `log` — powtórki dziennie, retencja, accuracy, streak
- [x] **Settings**: limit nowych/dzień, limit powtórek/dzień, próg "known" dla quizu, reset postępu, eksport statystyk (JSON)

**Kryterium akceptacji:** ✅ wszystkie ekrany nawigowalne, ustawienia zapisywane w IndexedDB.

---

### Etap 7 — Testy, atrybucje, publikacja
- [x] Przegląd mobile-first (iPhone + Android + Chrome/Edge) — dotyk, wielkości przycisków: min. 44 px dla wszystkich interaktywnych elementów (przyciski headerów, filtry, siatka Deck 5 kolumn na mobile), `touch-action: manipulation`, safe-area insets dla notcha, brak zoomu inputów na iOS (font-size 16 px)
- [x] Atrybucje: Tatoeba (CC-BY 2.0), EDRDG/KANJIDIC (licencja EDRDG), jpdb — `ATTRIBUTIONS.md` + zwinięta sekcja w aplikacji z linkami do licencji
- [x] Instrukcja instalacji PWA w README (Android/Chrome, iOS/Safari, desktop Chrome/Edge + uwaga o offline i backup)
- [x] (opcjonalnie) deploy na GitHub Pages / Netlify / Vercel — sekcja w README

**Kryterium akceptacji:** aplikacja działa offline na telefonie, licencje wymienione, README kompletne.

---

## Ryzyka i fallbacki

| Ryzyko | Fallback |
|---|---|
| Blokada scrapingu jpdb.io (Cloudflare / rate limit) | Delay + retry + cache stron (wznawianie); fallback danych: kanjiapi (odczytania/znaczenia) + Tatoeba/kuromoji (zdania) + mnemoniki AI |
| Dla rzadkich kanji mało zdań w jpdb | Rozszerzenie filtra (dłuższe zdania / mniej rygorystyczny dobór) |
| Część przykładów jpdb bez tłumaczenia EN | Szukanie wśród pozostałych przykładów na stronie / luźniejsze dopasowanie / zdanie JP-only (bez tłumaczenia) |
| Brakujący mnemonik lub pusta sekcja na stronie jpdb | Oznaczenie `mnemonicSource: "ai"` i uzupełnienie ręczne / AI (Etap 2) |
| JPDB Kanji.zip bez radicali, zdań i mnemoników | Zastąpiony scrape'm stron `jpdb.io/kanji/<glif>` (sekcje Composed of / Mnemonic / Examples) |
| Duży JSON danych (opóźnienie ładowania) | Podział na shardy / ładowanie leniwe; docelowo < 2 MB |