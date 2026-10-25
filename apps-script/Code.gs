/**
 * Backend badania — Google Apps Script podpięty do arkusza Google Sheets.
 *
 * Instalacja (szczegóły w README.md):
 *   1. Utwórz nowy arkusz Google → Rozszerzenia → Apps Script.
 *   2. Wklej cały ten plik w miejsce zawartości Code.gs i zapisz.
 *   3. Uruchom raz funkcję `ustawienia` (przyzna uprawnienia i utworzy arkusze).
 *   4. Wdróż → Nowe wdrożenie → Aplikacja internetowa:
 *        Wykonaj jako: Ja | Kto ma dostęp: Każdy
 *   5. Skopiuj adres URL (…/exec) do js/config.js → ENDPOINT.
 *
 * Endpointy:
 *   GET  ?action=counts  → liczebność ważnych, ukończonych udziałów w każdej wersji (do równoważenia grup)
 *   GET  ?action=stats   → zbiorcze statystyki (bez danych jednostkowych) dla panelu badacza
 *   POST {type:'record', record:{…}}         → zapis wyniku (nowe kolumny dodają się automatycznie)
 *   POST {type:'withdraw', id_uczestnika:…}  → oznaczenie danych jako wycofanych
 */

const ARKUSZ_WYNIKI = 'Wyniki';
const ARKUSZ_PODSUMOWANIE = 'Podsumowanie';
const WERSJE = ['A', 'B', 'C', 'D'];
const OPIS_WERSJI = {
  A: 'niebieska + zaokrąglona',
  B: 'niebieska + ostra',
  C: 'czerwona + zaokrąglona',
  D: 'czerwona + ostra',
};

/* ------------------------------------------------------------------ */
/* Wejście HTTP                                                         */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'counts';
  try {
    if (action === 'counts') return json_({ ok: true, counts: liczebnosci_() });
    if (action === 'stats') return json_({ ok: true, stats: statystyki_() });
    return json_({ ok: false, error: 'Nieznana akcja' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const body = JSON.parse(e.postData.contents);
    if (body.type === 'withdraw') {
      const n = wycofaj_(String(body.id_uczestnika || ''));
      return json_({ ok: true, oznaczono: n });
    }
    if (body.type === 'record' && body.record) {
      const wynik = zapiszRekord_(body.record);
      try { odswiezPodsumowanie(); } catch (ignored) { /* podsumowanie nie może blokować zapisu */ }
      return json_({ ok: true, wynik: wynik });
    }
    return json_({ ok: false, error: 'Nieprawidłowe dane' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) { /* ignore */ }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Zapis                                                                */
/* ------------------------------------------------------------------ */

function arkuszWynikow_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ARKUSZ_WYNIKI);
  if (!sh) sh = ss.insertSheet(ARKUSZ_WYNIKI, 0);
  return sh;
}

function naglowki_(sh) {
  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function bezpieczna_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  let s = String(v);
  if (s.length > 45000) s = s.slice(0, 45000); // limit komórki Sheets to 50 000 znaków
  // ochrona przed wstrzyknięciem formuł (np. "=IMPORTXML(...)" w polu uwag)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function zapiszRekord_(rec) {
  const sh = arkuszWynikow_();
  let head = naglowki_(sh);

  if (head.length === 0) {
    head = ['czas_serwera'].concat(Object.keys(rec)).concat(['wycofane']);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    const brak = Object.keys(rec).filter(function (k) { return head.indexOf(k) === -1; });
    if (brak.length) {
      sh.getRange(1, head.length + 1, 1, brak.length).setValues([brak]).setFontWeight('bold');
      head = head.concat(brak);
    }
  }

  // ochrona przed duplikatem (ponowiona wysyłka tego samego rekordu)
  const iId = head.indexOf('id_uczestnika');
  const iStatus = head.indexOf('status');
  if (iId > -1 && sh.getLastRow() > 1) {
    const ids = sh.getRange(2, iId + 1, sh.getLastRow() - 1, 1).getValues();
    const st = iStatus > -1 ? sh.getRange(2, iStatus + 1, sh.getLastRow() - 1, 1).getValues() : null;
    for (let r = 0; r < ids.length; r++) {
      if (String(ids[r][0]) === String(rec.id_uczestnika)) {
        const stary = st ? String(st[r][0]) : '';
        if (stary === String(rec.status) || stary === 'ukonczone') return 'duplikat';
      }
    }
  }

  // kody zapisujemy jako tekst, żeby nie zgubić zer wiodących (np. "0482…")
  const TEKST = ['kod_poprawny', 'kod_wpisany', 'wzor_pozycji'];
  const row = head.map(function (h) {
    if (h === 'czas_serwera') return new Date();
    if (h === 'wycofane') return false;
    if (!rec.hasOwnProperty(h)) return '';
    if (TEKST.indexOf(h) > -1 && rec[h] !== '') return "'" + String(rec[h]).replace(/\D/g, '');
    return bezpieczna_(rec[h]);
  });
  sh.appendRow(row);
  return 'zapisano';
}

function wycofaj_(id) {
  if (!id) return 0;
  const sh = arkuszWynikow_();
  const head = naglowki_(sh);
  const iId = head.indexOf('id_uczestnika');
  const iW = head.indexOf('wycofane');
  if (iId === -1 || iW === -1 || sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, iId + 1, sh.getLastRow() - 1, 1).getValues();
  let n = 0;
  for (let r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === id) { sh.getRange(r + 2, iW + 1).setValue(true); n++; }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Odczyt i statystyki                                                  */
/* ------------------------------------------------------------------ */

function wiersze_() {
  const sh = arkuszWynikow_();
  if (sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = vals[0].map(String);
  return vals.slice(1).map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function prawda_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

/** Rekord nadaje się do analizy? */
function wazny_(o) {
  return String(o.status) === 'ukonczone'
    && !prawda_(o.test)
    && !prawda_(o.wycofane)
    && String(o.notowal) !== 'tak'
    && String(o.znal_kod) !== 'tak';
}

function liczebnosci_() {
  const c = { A: 0, B: 0, C: 0, D: 0 };
  wiersze_().forEach(function (o) { if (wazny_(o) && c.hasOwnProperty(o.wersja)) c[o.wersja]++; });
  return c;
}

function opisz_(arr) {
  const a = arr.map(Number).filter(function (x) { return isFinite(x); });
  const n = a.length;
  if (!n) return { n: 0, srednia: null, sd: null };
  const m = a.reduce(function (s, x) { return s + x; }, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (n - 1)) : 0;
  return { n: n, srednia: Math.round(m * 100) / 100, sd: Math.round(sd * 100) / 100 };
}

function statystyki_() {
  const all = wiersze_();
  const ok = all.filter(wazny_);
  const grupy = {
    A: function (o) { return o.wersja === 'A'; },
    B: function (o) { return o.wersja === 'B'; },
    C: function (o) { return o.wersja === 'C'; },
    D: function (o) { return o.wersja === 'D'; },
    niebieska: function (o) { return o.kolor === 'blue'; },
    czerwona: function (o) { return o.kolor === 'red'; },
    zaokraglona: function (o) { return o.ksztalt === 'round'; },
    ostra: function (o) { return o.ksztalt === 'sharp'; },
  };
  const out = {};
  Object.keys(grupy).forEach(function (g) {
    const rows = ok.filter(grupy[g]);
    out[g] = {
      wynik_pozycje: opisz_(rows.map(function (o) { return o.wynik_pozycje; })),
      wynik_cyfry: opisz_(rows.map(function (o) { return o.wynik_cyfry; })),
      nauka_srednia_ms: opisz_(rows.map(function (o) { return o.nauka_srednia_ms; })),
      nauka_suma_ms: opisz_(rows.map(function (o) { return o.nauka_suma_ms; })),
      ank_stres: opisz_(rows.map(function (o) { return o.ank_stres; })),
      ank_wyglad: opisz_(rows.map(function (o) { return o.ank_wyglad; })),
    };
  });
  return {
    wazne: ok.length,
    wszystkie: all.length,
    ukonczone: all.filter(function (o) { return String(o.status) === 'ukonczone' && !prawda_(o.test); }).length,
    przerwane: all.filter(function (o) { return String(o.status) === 'przerwane' && !prawda_(o.test); }).length,
    testowe: all.filter(function (o) { return prawda_(o.test); }).length,
    wycofane: all.filter(function (o) { return prawda_(o.wycofane); }).length,
    wykluczone_notowal_lub_znal_kod: all.filter(function (o) {
      return String(o.status) === 'ukonczone' && !prawda_(o.test) && !prawda_(o.wycofane)
        && (String(o.notowal) === 'tak' || String(o.znal_kod) === 'tak');
    }).length,
    grupy: out,
    aktualizacja: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Arkusz "Podsumowanie" + menu                                         */
/* ------------------------------------------------------------------ */

function odswiezPodsumowanie() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ARKUSZ_PODSUMOWANIE);
  if (!sh) sh = ss.insertSheet(ARKUSZ_PODSUMOWANIE);
  const s = statystyki_();
  sh.clear();
  const rows = [
    ['Podsumowanie badania (tylko ważne rekordy)', '', '', '', '', '', '', ''],
    ['Aktualizacja', new Date(), '', '', '', '', '', ''],
    ['Ważne rekordy', s.wazne, 'Ukończone (bez testów)', s.ukonczone, 'Przerwane', s.przerwane, 'Wycofane', s.wycofane],
    ['Wykluczone (notował / znał kod)', s.wykluczone_notowal_lub_znal_kod, 'Testowe', s.testowe, '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['Grupa', 'Opis', 'N', 'Wynik pozycyjny: średnia', 'SD', 'Cyfry trafione: średnia', 'Czas na kafelek [ms]: średnia', 'Stres (1–7): średnia'],
  ];
  const opis = Object.assign({}, OPIS_WERSJI, {
    niebieska: 'czynnik KOLOR: A + B', czerwona: 'czynnik KOLOR: C + D',
    zaokraglona: 'czynnik KSZTAŁT: A + C', ostra: 'czynnik KSZTAŁT: B + D',
  });
  Object.keys(s.grupy).forEach(function (g) {
    const x = s.grupy[g];
    rows.push([g, opis[g], x.wynik_pozycje.n, x.wynik_pozycje.srednia, x.wynik_pozycje.sd,
      x.wynik_cyfry.srednia, x.nauka_srednia_ms.srednia, x.ank_stres.srednia]);
  });
  sh.getRange(1, 1, rows.length, 8).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  sh.getRange(6, 1, 1, 8).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(7, 1, 4, 8).setBackground('#fafafa');
  sh.autoResizeColumns(1, 8);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Badanie')
    .addItem('Odśwież podsumowanie', 'odswiezPodsumowanie')
    .addItem('Pokaż liczebność grup', 'pokazLiczebnosci')
    .addToUi();
}

function pokazLiczebnosci() {
  const c = liczebnosci_();
  SpreadsheetApp.getUi().alert('Ważne udziały w wersjach:\n\n' +
    WERSJE.map(function (w) { return w + ' (' + OPIS_WERSJI[w] + '): ' + c[w]; }).join('\n'));
}

/** Uruchom raz ręcznie z edytora — nadaje uprawnienia i tworzy arkusze. */
function ustawienia() {
  arkuszWynikow_();
  odswiezPodsumowanie();
  Logger.log('Gotowe. Teraz: Wdróż → Nowe wdrożenie → Aplikacja internetowa (Wykonaj jako: Ja, Dostęp: Każdy).');
}
