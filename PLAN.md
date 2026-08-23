# Plan: nauka radykałów i słownictwa

Rozszerzenie AnkiJp o dwa nowe typy treści — **radykały** (部首) i **słownictwo** (単語) — wraz z domyślnym trybem mieszanym uczącym w łańcuchu *radykał → znak → słowo*.

## Stan wyjściowy (fakty z kodu i danych)

- Każdy kanji w `src/data/kanji.json` ma pole `radicals: {glyph, keyword}[]` — dekompozycję jpdb.io na komponenty. To NIE są oficjalne radykały Kangxi (部首 słownikowe), lecz części składowe używane przez jpdb do mnemoniczek. Decyzja: **bazujemy na dekompozycji jpdb**, bez zewnętrznego źródła.
- Unikalnych komponentów: **513** (stan przed ekstensją; finalna liczba wynika z pipeline'u — decyzja #18), wszystkie mają keyword. 251 z nich to jednocześnie kanje z talii → konieczne namespaced ID.
- 45 kanji jednoelementowych ma „fallback sam siebie" jako radykał (build-data.mjs:59).
- Kanje mają po 3 zdania `Sentence {jp, en, furigana}` (furigana to pre-renderowane `<ruby>` HTML); konwencję tę rozciągamy na słówka.
- Kluczem karty SRS jest dziś goły glif (`SrsCard.kanji`, `keyPath:'kanji'`) — radykał 「一」 kolidowałby z kanji 「一」.
- `useStudySession` przebudowuje kolejkę po każdej odpowiedzi → bramkowanie ewaluuje się w trakcie sesji, co umożliwia łańcuchy mieszane.
- Furigana (komponent) obsługuje już dowolne mixy kanji+kana; tokenizer kuromoji jest devDependency pipeline'u.

## Podjęte decyzje

| # | Decyzja |
|---|---------|
| 1 | Radykały = pełny zestaw komponentów jpdb finalnej talii (dziś 513 — decyzja #18), każdy jako karta SRS, pełne bramkowanie kanji (także komponenty jednokrotne). |
| 2 | Kanje jednoelementowe (self-fallback): **auto-odblokowanie** bez wymogu karty radykału-siebie. |
| 3 | Bramkowanie = „komponent **widziany raz**" (stan ≠ `new`), nie pełny stan review — umożliwia łańcuch radykał→kanji→słowo w jednej sesji. |
| 4 | Słówka: **top 2000 wg rankingu jpdb**, wyłącznie formy słownikowe (nieodmienione); jpdb tylko do selekcji — znaczenia/czytania/furigana z **JMdict** (jmdict-simplified, licencja EDRDG, spójna z atrybucjami). |
| 5 | Karta słówka **jednokierunkowa**: słowo+furigana → znaczenie + czytanie. |
| 6 | Sesje: **tryb mieszany jako domyślny**, obok nadal wybór pojedynczego typu. |
| 7 | Przykładowe zdania dla słówek: **do 3 na słowo** (jak przy kanji), preferencja najkrótszych; brak pokrycia → `[]`. Rozmiaru bundla nie optymalizujemy agresywnie (opcjonalnie dynamiczny import, jeśli kiedyś potrzebny). |
| 8 | Kanje spoza kyōiku występujące w top 2000 trafiają do talii jako pełnoprawne kanje (`grade: 0`, ten sam pipeline i bramkowanie) — słówka bramkowane **bez wyjątków**. |
| 9 | Auto-known dla komponentów-tożsamościowych: gdy kanji `X` staje się znane (próg albo ręcznie), karta `r:X` jest automatycznie oznaczana jako znana (persist przy `answerCard` — detekcja przekroczenia progu — i przy `markKnown`; cofnięcie „known" kanji **nie** cofa radykału) — bez podwójnych powtórek tego samego faktu. |
| 10 | Radykały **nie mają opcji Ignore** — jedynie Mark as known (ignorowanie komponentu zablokowałoby wiecznie jego kanje). |
| 11 | Migracja/zasiew radykałów = **reguła B**: komponenty wszystkich widzianych kanji (stan ≠ `new`) stają się `known`; jeden predykat `isComponentSeen(glyph)` współdzielony przez migrację i bramkowanie. |
| 12 | Słówka czysto kana (`kanji: []`) wchodzą do talii bez bramkowania — kolejność dyktuje ranking jpdb. |
| 13 | Homografy JMdict: deterministyczna kaskada (pełne keb+reb → odrzucenie tagów arch/obs/rare → najniższy `entID`); wybrany `entId` zapisany w `vocab.json` (reprodukowalność). Implementacja rozszerza kaskadę o dwa deterministyczne tiebreaki: preferencja popularnej pisowni (wliczona do jakości dopasowania keb+reb) oraz preferencja wpisu z nagłówkiem-kana przy remisie; brak kandydata pasującego do reb dopuszcza najlepsze dopasowanie samego keb. |
| 14 | Znaczenia słówek jak w `KanjiEntry`: `meaning` (display, pierwszy sens, ≤3 glósów) + `meanings[]` (kompletne glósy — filtry dystraktorów). |
| 15 | `pos` karty = pozycja w źródłowym rankingu typu: radykały wg częstości użycia, słówka wg miejsca w top-2000, kanje grade-0 wg użyteczności. |
| 16 | Store `log`: pole wartości `kanji` przemianowane na **`cardId`** — klucz autoincrement tego store'a to już właściwość `id`, więc nazwa `id` koliduje i wywraca migrację (`cards`/`drawings` zmieniają `keyPath` na `'id'` bez kolizji, bo ich stary klucz to `kanji`). |
| 17 | Duplikaty keb w selekcji top-2000 (ta sama forma słownikowa, różne czytania): **jedna karta per keb** — wygrywa najwyższa pozycja w rankingu jpdb, jej czytanie i sensy trafiają na kartę; kaskada homografów (#13) dodatkowo wybiera wpis JMdict. |
| 18 | Zestaw radykałów = komponenty **finalnej talii** (kyōiku + ekstensja grade-0): `data:radicals` odpala **po** dołączeniu ekstensji; liczba komponentów jest wynikiem pipeline'u (dziś 513), nigdy stałą. Jedno źródło prawdy: „radykały = komponenty talii". |
| 19 | Twarda reguła `verify.mjs`: **każdy komponent każdego kanji w `kanji.json` istnieje w `radicals.json`** — konstrukcyjnie wyklucza wieczną blokadę kanji przez komponent bez karty (już dziś 214 komponentów występuje w dokładnie jednym kanji, więc „osierocone" glify to norma, nie wyjątek). |

---

## Etap 0 — Fundament: typy treści i migracja DB v2→v3

- Nowy typ `ContentType = 'kanji' | 'radical' | 'vocab'`; helper `typeOf(id)` wyprowadza typ z prefiksu — jedno źródło prawdy, bez osobnego pola `contentType` w logu.
- **Namespaced ID kart**: `k:一`, `r:氵`, `w:食べる`. Pole `SrsCard.kanji` przemianowane na `id`; `keyPath: 'kanji'` → `'id'` (store `cards`), analogicznie `drawings`. Największy diff w projekcie (srs.ts, db.ts, session hooks, quiz) — jednorazowy.
- Migracja w `upgrade()` (db.ts):
  - przepisanie kluczy `cards` / `drawings` z dopiskiem prefiksu `k:` dla starych glifów; w `log` (klucz to autoincrement) przepisana jest wartość pola `kanji` → **`cardId`** z tym samym prefiksem (decyzja #16 — nazwa `id` kolidowałaby z kluczem autoincrement),
  - reguła migracyjna **B** (decyzja #11): komponenty **wszystkich widzianych kanji** (stan ≠ `new`) są od razu `known` (reuse `applyKnown`) — łapie też ręcznie oznaczone „known"; starzy użytkownicy nie wracają do radykałów, a ich komponenty wchodzą do puli quizowej „known" (zamierzone). Realizowana przy pierwszym zasiewie radykałów (Etap 2), bo w chwili migracji te karty jeszcze nie istnieją; bramkowanie używa później tego samego predykatu `isComponentSeen(glyph)` — jedno źródło prawdy.
- Uogólnienie warstwy kolejkowej o filtr typu: `getSessionQueue(type)`, `getSummary(type)`, `getKnownPool(type)`, `answerCard(id)`; wywołania istniejących ekranów podają `'kanji'` → zero zmian behawioru. `answerCard` traci ad-hoc fallback `createCard(id, 0, now)` (db.ts:245) — odpowiedź na niezmaterializowaną kartę jest błędem, nie tworzy ducha-karty.
- Technika migracji keyPath: IndexedDB nie pozwala zmienić `keyPath` istniejącego store'a — `cards` i `drawings` trzeba odtworzyć (`deleteObjectStore` + utworzenie z `keyPath: 'id'`) i przekopiować rekordy w ramach `upgrade()`; najwyższe ryzyko techniczne Etapu 0, test na starych danych obowiązkowy.
- `getDailyCounts(now, type?)`: licznik nowych kart liczony z logu per typ (prefiks ID); limity dzienne per typ dotyczą wyłącznie nowych kart, `reviewLimit` pozostaje globalny.
- `ensureSeeded` na znaczniku wersji zasiewu (`seedStamp` w store `settings`): dosiewa tylko zakresy, których znacznik nie obejmuje; `resetProgress` czyści znacznik. Bez tego early return przy `count > 0` zablokuje każdy przyszły zasiew u istniejących użytkowników.
- Testy (`db.test.ts`, fake-indexeddb): scenariusz migracji starych danych + separacja kolejek per typ + ponowny zasiew po `resetProgress`.

## Etap 1 — Dane radykałów (jpdb, zero sieci)

- Nowy krok pipeline'u `data:radicals`: wyciąga unikalne `{glyph, keyword}` z **finalnego** `kanji.json` (kyōiku + ekstensja grade-0) → `src/data/radicals.json`. Uruchamiany **po** ekstensji talii (decyzja #18) — krok offline i tani, więc kolejność w `data:pipeline` jest jedyną zmianą sekwencyjną; UI (Etap 2) może powstawać równolegle na dowolnej wersji danych, bo skrypty regenerują je niezależnie.
- Odwrotny indeks komponent→[kanje] liczony **w pamięci** przy ładowaniu (analogicznie do `byGlyph` w kanji.ts:29) — bez duplikacji w danych.
- Sortowanie nauki wg częstości użycia (na dziś: 口×67, 一×64, 木×57, 亻×48…) — najbardziej użyteczne komponenty najpierw; `pos` radykała = pozycja w tym rankingu (decyzja #15). Liczby przeliczają się po każdej regeneracji.
- Walidacja kompletności w `verify.mjs` — reguła #19 jako twardy warunek: każdy komponent każdego kanji istnieje w `radicals.json`.

## Etap 2 — Bramkowanie + UI radykałów

- Zasiew: wszystkie karty radykałów z `radicals.json` (dziś 513, decyzja #18) przez `seedStamp` (Etap 0); przy zasiewie aplikowana reguła B przez wspólny `isComponentSeen(glyph)` (decyzja #11).
- Odblokowanie kanji: wszystkie komponenty z pola `radicals` mają stan ≠ `new`, **z wyjątkiem samoodniesień** (glif == kanji) — te ignorowane przy bramkowaniu.
- Brak Ignore dla radykałów (decyzja #10): sesja Study i Deck ukrywają akcję, `markIgnored` odrzuca typ `radical`.
- Auto-known (decyzja #9): gdy kanji `X` staje się znane (próg albo ręcznie), karta `r:X` jest oznaczana jako znana — mechanizm persystentny w `answerCard`/`markKnown`, bez cofania przy un-known.
- Nowe ustawienia: dzienne limity nowych kart dla radykałów i słówek — domyślnie wyraźnie wyższe niż kanji (karty lekkie); istniejące `newPerDay` zostaje limitem kanji. Wysoki limit radykałów niweluje „ścianę" startową pełnej bramki: wg kolejności częstości ~83 kanji jest gotowych już po 25 wprowadzonych komponentach (pomiar na danych talii).
- UI:
  - Badge typu (radykał/kanji/słówko) na kartach sesji i quizu — identyczne fronty (`r:一` vs `k:一`) muszą być jednoznaczne.
  - `RadicalCard`: front = glif (+ liczba kresek odpada — brak danych bez rescrapa); tył = keyword + klikalna siatka kanji zawierających komponent (→ KanjiDetail).
  - Dashboard: wybór typu sesji; Deck z zakładkami per typ; licznik „zablokowane", po kliknięciu lista brakujących komponentów per kanji (+ ich miejsce w kolejce nauki).
- Quiz radykałów: tryb meaning (glif→znaczenie), dystraktory z pełnej puli radykałów; reverse możliwy, jeśli keywordi okażą się wystarczająco unikalne (dziś: 0 duplikatów, ale p95 długości 19 znaków — do ewaluacji na realnych kartach).
- Checklist: renderowanie 7 egzotycznych punktów kodowych (**⺊㇇⺌⻌㇉⺕㇀**) na docelowych platformach; fallback SVG/obrazek w razie potrzeby.

## Etap 3 — Dane słownictwa (+ rozszerzenie talii kanji)

- Pipeline `data:vocab`: ranking częstotliwościowy jpdb jako lista selekcyjna — przechodzimy od góry, bierzemy wyłącznie **formy słownikowe (nieodmienione)**, schodząc aż zbierze się 2000 (bufor wejściowy na odsiew); duplikaty keb dedupe'owane na starcie — jedna karta per forma słownikowa, wygrywa najwyższy ranking (decyzja #17); walidacja „nieodmienioności" tagami kuromoji w `verify.mjs`.
- **Ekstensja talii**: unia kanji z wybranych 2000 słów ∖ kyōiku → nowe kanje dokładane do `src/data/kanji.json` istniejącym pipeline'em (`data:kyoiku` + scrape `data:jpdb` dla nowych glifów), `grade: 0`. Po tej operacji **obowiązkowa regeneracja radykałów** (`data:radicals`, decyzje #18–19) — nowe glify wnoszą komponenty nieobecne w dzisiejszej 513. Pos: za kyōiku, ale **sortowane wg użyteczności** — liczby słów top-2000 zawierających dany kanji, malejąco (najbardziej „blokujące" ekstrasowe kanje pierwsze). Liczba wynika z danych.
- Treść słówek (znaczenia, czytania) z **jmdict-simplified**, dopasowanie wpisu po keb+reb z rankingu jpdb. Homografy (duplikaty keb) rozstrzygane deterministyczną kaskadą (decyzja #13): pełne dopasowanie keb+reb → odrzucenie wpisów z tagami arch/obs/rare (preferencja common) → najniższy `entID`; kontrola rozstrzygnięć w `verify`.
- Furigana HTML generowana mechanicznie przez alignację keb↔reb (ten sam format `<ruby>` co dziś); kuromoji jako walidacja/fallback.
- **Przykładowe zdania**: rozszerzenie `data:tatoeba` o dobór zdań per słowo — dopasowanie po **lemie z tokenizera** (słowa są formami słownikowymi, ale w zdaniach występują odmienione), substring tylko jako fallback; do 3 pozycji, preferencja najkrótszych, brak pokrycia → pusta tablica.
- Encja: `{ id: '食べる', entId, reading, furiganaHtml, meaning, meanings[], kanji[], sentences[] }` — `meaning` wyświetlany (pierwszy sens, ≤3 glósów), `meanings[]` kompletne glósy do filtrów (decyzja #14); → `src/data/vocab.json`.
- Walidacja w `verify.mjs` (furigana zawiera ruby, czytanie zgodne z reb, **wszystkie kanje każdego słowa istnieją w `kanji.json`** — gwarancja bramkowalności itd.; słówka czysto kana legalne, brak wymogu ≥1 kanji — decyzja #12).

## Etap 4 — Słówka: UI + SRS + quiz

- `VocabCard`: front = słowo z furiganą; tył = znaczenie + czytanie + linki do kanji składowych + sekcja zdań (renderowana identycznie jak w StudyCard, warunkowo gdy pusta).
- Strategia zasiewu: **leniwa materializacja** — przy każdym budowaniu kolejki/podsumowania/puli quizowej (punkty wołania dzisiejszego `ensureSeeded`) przegląd słówek wg rankingu użyteczności; karta tworzy się gdy **wszystkie jego kanje są odblokowane** (spójne z bramkowaniem; bez wyjątków — każdy kanji słowa istnieje w talii, decyzja #8), do wyczerpania dziennego limitu; idempotentna (istnienie karty = skip). Słówka czysto kana przechodzą trywialnie (decyzja #12). `pos` = pozycja w top-2000 (decyzja #15). Pożądany efekt: odpowiedź na ostatnie kanje słowa → słowo wskakuje przy najbliższej przebudowie kolejki.
- Quiz słówek: `meaning` (słowo→znaczenie), `reading` (słowo→poprawne czytanie spośród 4), `reverse`; dystraktory z puli słówek o podobnej długości/udziale kanji, z odfiltrowaniem kandydatów dzielących **jakikolwiek** glós z celem (rozszerzenie wzorca `targetMeanings`, quiz.ts). Tryb `reading` renderuje prompt **bez furigany** (flaga `hideFurigana` na `QuizQuestion`) — inaczej odpowiedź byłaby widoczna nad słowem; test: prompt trybu `reading` nie zawiera `<ruby>`.
- Ekstensja `grade: 0` poza domyślnym filtrem quizu kanji (`grades: [1–6]`) — włączenie do pul quizowych jako osobna opcja.
- Stretch: tryb cloze dla słówek (możliwy dzięki zdaniom).
- Doprecyzowanie po review Etapu 4: dzienny limit słówek ogranicza **zapas zmaterializowanych kart o stanie `new`** — każda przebudowa uzupełnia go do limitu, a liczba wprowadzeń wynika ze świeży-slice liczonej z logu, jak dla pozostałych typów. Dzięki temu odpowiedź na ostatnie kanje faktycznie zwalnia miejsce dla nowo odblokowanego słowa (wskakuje przy najbliższej przebudowie), zamiast bez ograniczeń pompuć talię.

## Etap 5 — Tryb mieszany (domyslny)

- Dashboard: „Mieszany" jako pierwsza/domyślna opcja przed Study/Review; wybór pojedynczego typu pozostaje dostępny.
- Study (mixed): kolejność wprowadzania nowych kart wg priorytetu topologicznego (radykał→kanji→słowa z nim związane) + heurystyka świeżości — tuż po wprowadzeniu komponentu jego kanje wskakują na początek kolejki, potem ich słówka. Remisy: częstość użycia (radykały), grade (kanji).
- Review (mixed): wszystkie due karty niezależnie od typu, wg daty — czysto Anki-like. Doprecyzowanie po implementacji: kroki learning/relearning (zaległe już teraz) zawsze wyprzedzają dated review niezależnie od daty — to celowe odwzorowanie priorytetu learning w Anki, nie błąd sortowania; wewnątrz każdej z tych grup kolejność jest datowa.
- Limity: agregacja poszanowaniem każdego dziennego limitu per typ.
- Quiz: domyślna pula mieszana, opcja zawężenia do typu.
- Stats/log: zapis bez zmian zachowania (log-driven); typ dostępny z prefiksu ID (`typeOf`), rozbicie liczników dopiero w Etapie 6.

## Etap 6 — Integracja i porządki

- Stats/Dashboard: rozbicie liczników per typ.
- Attribution: JMdict (jmdict-simplified) w DashboardScreen + ATTRIBUTIONS.md; README — usunąć sztywne „1 006 kanji" (talia = kyōiku + ekstensja grade 0) i opisać selekcję wg rankingu jpdb.
- Weryfikacja końcowa: `npm run lint && npm test && npm run build` oraz `data:pipeline` + `data:verify` na 100%.

---

## Kolejność commitów

1. **Etap 0** — czysty refactor ID/migracji, zero zmian behawioru (łatwy review).
2. **Etap 3** — dane słownictwa + ekstensja talii grade-0 (wymaga decyzji o źródle rankingu jpdb; kończy się regeneracją radykałów wg decyzji #18).
3. **Etapy 1–2** — radykały: dane z finalnej talii, bramkowanie, UI.
4. **Etap 4** — słówka: UI, SRS, quiz.
5. **Etap 5** — tryb mieszany (logika kolejki + Dashboard), osobno, bo dotyka sesji.
6. **Etap 6** — integracja.

## Ryzyka i uwagi

- **Migracja DB** — krytyczna ścieżka; testy z fake-indexeddb symulują reload i muszą pokryć stare dane (v2) → v3. Zmiana `keyPath` wymaga odtworzenia store'ów `cards`/`drawings` z kopią rekordów (IndexedDB nie robi tego in-place).
- **Jakość automatycznej furigany** dla słówek — alignacja keb↔reb ma przypadki brzegowe (okurigana, niestandardowe czytania); `data:verify` łapie niespójności.
- **Ranking top 2000 z jpdb nie ma lokalnego cache** (obecny scrape jest per-kanji) — jednorazowe pozyskanie listy (premade deck / scrape) do ustalenia na starcie Etapu 3. **Konsekwencja decyzji #18:** to źródło blokuje teraz także regenerację radykałów (ekstensja → radykały), więc decyzja musi zapadać przed startem danych, choć UI radykałów można budować równolegle.
- **Ekstensja talii o grade 0** rośnie rozmiar zasiewu i Decka; pozycja ekstrasów w nauce (pos wg użyteczności) sprawdzalna dopiero na realnej liście.
- **Renderowanie egzotycznych glifów** — patrz checklist w Etapie 2.
- Liczby kresek radykałów odpadają (cache scrapa jpdb nie istnieje lokalnie, parser nie wyciąga kresek) — nie rescrapujemy dla ozdobnika.
