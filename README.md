# Badanie: wpływ stylu interfejsu na zapamiętywanie informacji w e-learningu

**Link do badania (dla uczestników):** https://yoruclone11.github.io/zadanie-otworz-skrzynke/  
**Panel badacza:** https://yoruclone11.github.io/zadanie-otworz-skrzynke/panel.html

Platforma badawcza do pracy magisterskiej. Uczestnik zapamiętuje 10-cyfrowy kod (po jednej cyfrze na kafelku), a potem wpisuje go, żeby „otworzyć skrzynkę”. Strona losowo przydziela jedną z czterech wersji wyglądu i zapisuje wynik oraz czasy każdego kroku do arkusza Google.

- **Badanie:** `index.html`
- **Panel badacza (statystyki na żywo):** `panel.html`
- **Backend (zapis do Google Sheets):** `apps-script/Code.gs`
- **Analiza statystyczna:** `analiza/analiza.py`

---

## 1. Schemat badania (2 × 2, międzygrupowy)

| Wersja | Kolor / kontrast | Kształt |
|---|---|---|
| **A** | niebieski, stonowany, niski kontrast | zaokrąglony |
| **B** | niebieski, stonowany, niski kontrast | ostry |
| **C** | czerwony, czarno-biały, wysoki kontrast | zaokrąglony |
| **D** | czerwony, czarno-biały, wysoki kontrast | ostry |

**Operacjonalizacja czynników** (ważne do rozdziału metodologicznego):
- *Kolor* zmienia wyłącznie barwy, kontrast, grubość obramowań i cienie (miękkie vs twarde).
- *Kształt* zmienia wyłącznie geometrię: promienie zaokrągleń przycisków, kafelków, pól, kropek postępu i skrzynki oraz zakończenia linii ikon.
- **Stałe we wszystkich wersjach:** treść, układ, rozmiary, czcionka (systemowa), kod, animacje (te same czasy i krzywe), minimalny czas kafelka.

**Przydział:** równoważony — strona pyta backend o liczebność ważnych udziałów i wybiera wersję z najmniejszą liczbą osób (remisy losowo). Gdy backend nie odpowie w 3,5 s, przydział jest czysto losowy. Sposób przydziału zapisuje się w kolumnie `przydzial`.

**Kod:** `4827491638`, ten sam dla wszystkich (zmiana w `js/config.js`). Nie zawiera wzorców, a dwie cyfry się powtarzają, więc ostatniej nie da się odgadnąć przez eliminację.

## 2. Przebieg dla uczestnika

1. **Powitanie** — informacja o badaniu bez ujawniania celu (przykrywka: „uczenie się w środowisku online”), zgoda i oświadczenie o pełnoletności.
2. **Metryczka** — płeć, rok urodzenia, wykształcenie, sytuacja zawodowa, częstotliwość korzystania z e-learningu, zmęczenie (1–5).
3. **Instrukcja** i odliczanie 3-2-1.
4. **Nauka** — 10 kafelków, każdy z jedną cyfrą. Uczestnik przechodzi dalej sam (przyciskiem, spacją lub Enterem), ale nie wcześniej niż po 1 s. Czas każdego kafelka jest mierzony.
5. **Skrzynka** — wpisanie 10 cyfr (klawiatura ekranowa lub fizyczna, z możliwością poprawek).
6. **Ankieta** (przed poznaniem wyniku, żeby wynik nie wpłynął na odpowiedzi): trudność, stres, skupienie, przyjemność, ocena wyglądu (1–7), strategia zapamiętywania, zaburzenia widzenia barw, pytanie o notowanie i o wcześniejszą znajomość kodu.
7. **Wynik** — skrzynka otwiera się tym szerzej, im więcej cyfr jest na właściwych miejscach. Pokazywane są tylko ✓/✗ dla pozycji, bez prawidłowego kodu.
8. **Debriefing** — wyjaśnienie prawdziwego celu, informacja o wersji, kod uczestnika, przycisk „Wycofaj moje dane” i prośba o niezdradzanie szczegółów.

**Zabezpieczenia jakości danych:**
- Ponowny udział z tej samej przeglądarki jest blokowany.
- Odświeżenie strony po rozpoczęciu nauki kończy badanie i zapisuje rekord ze statusem `przerwane`.
- Rejestrowane są przełączenia okna i czas ukrycia karty.
- Osoby niepełnoletnie są odsyłane bez zapisu danych.

Pytanie o daltonizm jest celowo w ankiecie **po** zadaniu, bo zadane na początku mogłoby zdradzić, że chodzi o kolory.

## 3. Podłączenie Google Sheets (ok. 5 minut)

1. Utwórz nowy arkusz na [sheets.new](https://sheets.new), np. „Badanie UI – wyniki”.
2. W arkuszu: **Rozszerzenia → Apps Script**.
3. Usuń zawartość `Code.gs`, wklej cały plik [`apps-script/Code.gs`](apps-script/Code.gs) i zapisz (ikona dyskietki).
4. U góry wybierz funkcję **`ustawienia`** i kliknij **Uruchom**. Google poprosi o uprawnienia: *Przejrzyj uprawnienia → wybierz konto → Zaawansowane → Przejdź do projektu (niebezpieczne) → Zezwól*. To normalne przy własnych skryptach.
5. **Wdróż → Nowe wdrożenie** → typ: **Aplikacja internetowa** →
   - *Wykonaj jako:* **Ja**
   - *Kto ma dostęp:* **Każdy**
   → **Wdróż** i skopiuj **URL aplikacji internetowej** (kończy się na `/exec`).
6. Wklej ten URL do `js/config.js` w polu `ENDPOINT`, zapisz i wypchnij zmianę na GitHub. Można to zrobić bezpośrednio na github.com: plik → ikona ołówka → *Commit changes*.
7. Sprawdź działanie: otwórz `…/index.html?test` i przejdź badanie. W arkuszu „Wyniki” pojawi się wiersz z `test = TRUE`.

> Jeśli później zmienisz kod w Apps Script, użyj **Wdróż → Zarządzaj wdrożeniami → edytuj → Nowa wersja**. Dzięki temu URL się nie zmieni.

**Wycofanie danych:** przycisk na końcu badania ustawia w wierszu `wycofane = TRUE`. Jeśli ktoś napisze później i poda kod uczestnika (np. `F512-E666`), znajdź wiersz, którego `id_uczestnika` zaczyna się od tych znaków (bez myślnika, małymi literami), i usuń go.

## 4. Testowanie

| Adres | Działanie |
|---|---|
| `index.html?test` | tryb testowy: rekord ma `test = TRUE` i nie blokuje ponownego udziału |
| `index.html?w=A` (B, C, D) | wymuszenie konkretnej wersji (automatycznie tryb testowy) |
| `index.html?debug` | tryb testowy + podgląd zapisywanego rekordu na ekranie |

Rekordy testowe są pomijane w liczebnościach, w panelu i w analizie. Przed startem badania możesz je usunąć z arkusza.

## 5. Panel badacza

`panel.html` pokazuje na żywo liczebność wersji, średnie wyniki z odchyleniem standardowym, czasy i oceny z ankiety. Prezentuje wyłącznie dane zbiorcze, bez danych jednostkowych. Arkusz „Podsumowanie” w Google Sheets aktualizuje się automatycznie po każdym zapisie, a ręcznie przez menu **Badanie → Odśwież podsumowanie**.

## 6. Analiza statystyczna

```bash
cd analiza
pip install -r requirements.txt
python analiza.py wyniki.csv     # CSV pobrany z arkusza "Wyniki" (Plik → Pobierz → CSV)
python analiza.py --symuluj 128  # demo na danych symulowanych
```

Skrypt zapisuje `raport.md` oraz wykresy `wykres_wersje.png` i `wykres_interakcja.png`. W raporcie znajdziesz:
- wykluczenia z uzasadnieniem,
- opis próby,
- statystyki opisowe,
- **dwuczynnikową ANOVĘ (typ II) z cząstkowym η²**, z testem Levene’a i testem Shapiro–Wilka reszt,
- testy Mann–Whitneya (z d Cohena) i Kruskala–Wallisa,
- ANOVĘ dla zmiennych dodatkowych,
- korelację czasu nauki z wynikiem,
- krzywą pozycji szeregowej.

**Kryteria wykluczenia** (identyczne w panelu i w skrypcie): rekord testowy, dane wycofane, badanie nieukończone, deklaracja notowania lub zrzutu ekranu, znajomość kodu przed badaniem.

**Liczebność:** do wykrycia średniego efektu głównego (d ≈ 0,5, f ≈ 0,25) przy α = 0,05 i mocy 0,8 potrzeba ok. **128 ważnych osób (32 na wersję)**. W planie 2×2 każdy efekt główny porównuje połowę próby z połową, więc ta liczebność wystarcza. Wykrycie interakcji wymaga większej próby.

## 7. Słownik zmiennych (kolumny arkusza „Wyniki”)

| Kolumna | Opis |
|---|---|
| `czas_serwera` | znacznik czasu zapisu (dodaje backend) |
| `id_uczestnika` | losowy UUID; kod uczestnika to jego pierwsze 8 znaków |
| `status` | `ukonczone` / `przerwane` |
| `etap_osiagniety` | ostatni etap (przy przerwaniu) |
| `test` | TRUE dla rekordów testowych |
| `wersja`, `kolor`, `ksztalt` | A–D; `blue`/`red`; `round`/`sharp` |
| `przydzial` | `zrownowazony` / `losowy` / `wymuszony` |
| `start`, `koniec`, `godzina_lokalna`, `dzien_tygodnia`, `strefa_czasowa` | czas udziału |
| `plec`, `rok_urodzenia`, `wiek`, `wyksztalcenie`, `sytuacja`, `elearning`, `zmeczenie` | metryczka |
| `urzadzenie`, `system`, `przegladarka`, `wskaznik` | telefon/tablet/komputer; dotyk/mysz |
| `okno_szer`, `okno_wys`, `ekran_szer`, `ekran_wys`, `dpr` | rozmiar okna i ekranu |
| `ograniczony_ruch`, `tryb_ciemny_os`, `jezyk` | ustawienia systemu |
| `kod_poprawny`, `kod_wpisany` | kod i odpowiedź |
| **`wynik_pozycje`** | **główna zmienna zależna:** cyfry na właściwych pozycjach (0–10) |
| `wynik_cyfry` | cyfry trafione bez względu na pozycję (0–10) |
| `levenshtein` | odległość edycyjna od poprawnego kodu (0 = idealnie) |
| `poprawny_poczatek` | ile pierwszych cyfr z rzędu jest poprawnych |
| `wzor_pozycji` | np. `1111011101` (1 = poprawna pozycja) |
| `czas_kafelek_1` … `czas_kafelek_10` | czas oglądania każdej cyfry [ms] |
| `nauka_suma_ms`, `nauka_srednia_ms`, `nauka_mediana_ms`, `nauka_odch_std_ms`, `nauka_min_ms`, `nauka_max_ms` | statystyki czasu nauki |
| `wpis_pierwszy_klawisz_ms` | od pokazania skrzynki do pierwszej cyfry |
| `wpis_calosc_ms` | od pokazania skrzynki do zatwierdzenia |
| `przerwa_nauka_wpis_ms` | od ostatniego kafelka do zatwierdzenia kodu |
| `wpis_klawisze`, `wpis_usuniecia`, `wpis_wyczyszczenia`, `wpis_z_klawiatury`, `wpis_z_ekranu` | zachowanie przy wpisywaniu |
| `opuszczenia_nauka`, `opuszczenia_wpis` | ile razy okno straciło fokus |
| `ukryta_karta_nauka_ms`, `ukryta_karta_wpis_ms`, `ukryta_karta_suma_ms` | czas, gdy karta była ukryta |
| `czas_powitanie_ms`, `czas_formularz_ms`, `czas_instrukcja_ms`, `czas_ankieta_ms`, `czas_calkowity_ms` | czasy etapów i całości |
| `ank_trudnosc`, `ank_stres`, `ank_skupienie`, `ank_przyjemnosc`, `ank_wyglad` | ankieta (1–7) |
| `strategia` | strategie oddzielone `;` |
| `widzenie_barw`, `notowal`, `znal_kod` | pytania kontrolne |
| `uwagi` | komentarz uczestnika |
| `zdarzenia` | surowy dziennik zdarzeń (JSON, znaczniki czasu w ms od wejścia) |
| `wycofane` | TRUE, jeśli uczestnik wycofał dane |

## 8. Ograniczenia (do opisania w pracy)

- **Pamięć krótkotrwała, a nie pełna lekcja.** Zadanie mierzy zapamiętanie ciągu cyfr bezpośrednio po nauce. Wnioski dotyczą informacji prezentowanych w interfejsie e-learningowym, a nie trwałego uczenia się.
- **Kolor i kontrast są połączone.** Czynnik „kolor” obejmuje jednocześnie barwę i poziom kontrastu, więc ich wpływu nie da się rozdzielić.
- **Nauka we własnym tempie.** Czas nauki może się różnić między wersjami. Jest rejestrowany i może posłużyć jako kowariant.
- **Badanie online.** Brak kontroli warunków (urządzenie, otoczenie). Częściowo kompensują to zmienne kontrolne i pytanie o notowanie.
- **Kod jest w źródle strony.** Na statycznej stronie nie da się go ukryć przed kimś, kto zajrzy w narzędzia deweloperskie. W praktyce to marginalne ryzyko, ograniczane pytaniem kontrolnym.
- **Jeden kod dla wszystkich.** Istnieje ryzyko przekazania kodu innym. Ograniczają je prośba w debriefingu, ukrycie kodu w wyniku i pytanie `znal_kod`.

## 9. Struktura repozytorium

```
index.html          badanie
panel.html          panel badacza (statystyki zbiorcze)
css/style.css       style: 4 wersje przez atrybuty data-color / data-shape
js/config.js        konfiguracja (ENDPOINT, kod, minimalny czas kafelka)
js/app.js           logika badania, pomiary, zapis
apps-script/Code.gs backend Google Apps Script
analiza/            skrypt analizy statystycznej
```

## 10. Prywatność

Strona nie zbiera imienia, e-maila ani adresu IP (Apps Script go nie przekazuje). Nie używa ciasteczek, czcionek Google ani zewnętrznych skryptów. Przeglądarka zapamiętuje lokalnie tylko znacznik ukończenia (blokada ponownego udziału) i kopię własnego rekordu.
