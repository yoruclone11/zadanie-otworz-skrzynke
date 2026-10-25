#!/usr/bin/env python3
"""
Analiza wyników badania: wpływ stylu interfejsu (kolor × kształt) na zapamiętywanie.

Użycie:
    1. W arkuszu Google: Plik → Pobierz → CSV (arkusz "Wyniki") → zapisz jako wyniki.csv
    2. pip install -r requirements.txt
    3. python analiza.py wyniki.csv
       → raport.md (opis, ANOVA 2×2, testy nieparametryczne) + wykresy *.png

    Demo na danych symulowanych (sprawdzenie, że wszystko działa):
       python analiza.py --symuluj 128

Analiza główna: dwuczynnikowa ANOVA (typ II) dla wyniku pozycyjnego (0–10)
z czynnikami KOLOR (niebieski/czerwony) i KSZTAŁT (zaokrąglony/ostry),
efekt: cząstkowe eta². Jako kontrola założeń: test Levene’a i Shapiro–Wilka reszt;
alternatywa nieparametryczna: Mann–Whitney dla czynników głównych, Kruskal–Wallis dla 4 wersji.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

OUT = Path(__file__).resolve().parent
WERSJE = {'A': 'niebieska + zaokrąglona', 'B': 'niebieska + ostra', 'C': 'czerwona + zaokrąglona', 'D': 'czerwona + ostra'}
ZMIENNE = [
    ('wynik_pozycje', 'Wynik pozycyjny (0–10) — GŁÓWNA'),
    ('wynik_cyfry', 'Cyfry trafione bez względu na pozycję (0–10)'),
    ('levenshtein', 'Odległość Levenshteina (mniej = lepiej)'),
    ('poprawny_poczatek', 'Poprawny początek kodu (liczba cyfr)'),
    ('nauka_srednia_ms', 'Średni czas na kafelek [ms]'),
    ('nauka_suma_ms', 'Łączny czas nauki [ms]'),
    ('wpis_calosc_ms', 'Czas wpisywania kodu [ms]'),
    ('ank_stres', 'Stres (1–7)'),
    ('ank_trudnosc', 'Trudność (1–7)'),
    ('ank_skupienie', 'Skupienie (1–7)'),
    ('ank_przyjemnosc', 'Przyjemność korzystania (1–7)'),
    ('ank_wyglad', 'Ocena wyglądu (1–7)'),
]


# ----------------------------------------------------------------------------
# Wczytanie i filtrowanie
# ----------------------------------------------------------------------------
def prawda(s):
    return s.astype(str).str.upper().isin(['TRUE', 'PRAWDA', '1'])


def wczytaj(sciezka):
    df = pd.read_csv(sciezka, dtype={'kod_wpisany': str, 'kod_poprawny': str, 'wzor_pozycji': str})
    n0 = len(df)
    log = [f'Wszystkie wiersze w pliku: {n0}']
    maski = [
        ('rekordy testowe', prawda(df['test'])),
        ('dane wycofane przez uczestnika', prawda(df.get('wycofane', pd.Series(False, index=df.index)))),
        ('badanie nieukończone (przerwane)', df['status'].astype(str) != 'ukonczone'),
        ('deklaracja notowania / zrzutu ekranu', df['notowal'].astype(str) == 'tak'),
        ('znajomość kodu przed badaniem', df['znal_kod'].astype(str) == 'tak'),
    ]
    zostaje = pd.Series(True, index=df.index)
    for opis, m in maski:
        nowe = (m & zostaje).sum()
        log.append(f'- wykluczono: {opis}: {nowe}')
        zostaje &= ~m
    df = df[zostaje].copy()
    # duplikaty po id (na wszelki wypadek)
    przed = len(df)
    df = df.drop_duplicates('id_uczestnika', keep='first')
    if przed - len(df):
        log.append(f'- wykluczono: duplikaty id: {przed - len(df)}')
    log.append(f'**Do analizy: {len(df)}**')
    for c, _ in ZMIENNE:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors='coerce')
    return df, log


# ----------------------------------------------------------------------------
# ANOVA 2×2 (typ II) bez zewnętrznych bibliotek statystycznych
# ----------------------------------------------------------------------------
def _ssr(X, y):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    r = y - X @ beta
    return float(r @ r), r


def anova_2x2(df, y_col):
    d = df[[y_col, 'kolor', 'ksztalt']].dropna()
    y = d[y_col].to_numpy(float)
    n = len(y)
    if n < 6 or d['kolor'].nunique() < 2 or d['ksztalt'].nunique() < 2:
        return None
    k = np.where(d['kolor'] == 'red', 1.0, -1.0)
    s = np.where(d['ksztalt'] == 'sharp', 1.0, -1.0)
    one = np.ones(n)
    ss_full, resid = _ssr(np.column_stack([one, k, s, k * s]), y)
    ss_add, _ = _ssr(np.column_stack([one, k, s]), y)
    ss_only_s, _ = _ssr(np.column_stack([one, s]), y)
    ss_only_k, _ = _ssr(np.column_stack([one, k]), y)
    df_e = n - 4
    ms_e = ss_full / df_e if df_e > 0 else np.nan
    wyniki = []
    for nazwa, ss in [('Kolor', ss_only_s - ss_add), ('Kształt', ss_only_k - ss_add), ('Kolor × Kształt', ss_add - ss_full)]:
        F = ss / ms_e if ms_e > 0 else np.nan
        p = float(stats.f.sf(F, 1, df_e)) if np.isfinite(F) else np.nan
        eta = ss / (ss + ss_full) if (ss + ss_full) > 0 else np.nan
        wyniki.append({'efekt': nazwa, 'SS': ss, 'df': 1, 'F': F, 'p': p, 'eta2_cz': eta})
    wyniki.append({'efekt': 'Błąd', 'SS': ss_full, 'df': df_e, 'F': np.nan, 'p': np.nan, 'eta2_cz': np.nan})
    return pd.DataFrame(wyniki), resid


def cohen_d(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 2 or len(b) < 2:
        return np.nan
    sp = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / (len(a) + len(b) - 2))
    return (a.mean() - b.mean()) / sp if sp > 0 else np.nan


def fmt_p(p):
    if p is None or not np.isfinite(p):
        return '—'
    return '< 0,001' if p < 0.001 else f'{p:.3f}'.replace('.', ',')


def f2(x, d=2):
    return '—' if x is None or (isinstance(x, float) and not np.isfinite(x)) else f'{x:.{d}f}'.replace('.', ',')


# ----------------------------------------------------------------------------
# Raport
# ----------------------------------------------------------------------------
def raport(df, log):
    L = ['# Raport z analizy badania', '', '## Próba', ''] + log + ['']

    L += ['## Liczebność wersji', '', '| Wersja | Opis | N |', '|---|---|---|']
    for w, opis in WERSJE.items():
        L.append(f'| {w} | {opis} | {(df["wersja"] == w).sum()} |')
    L.append('')

    L += ['## Charakterystyka próby', '']
    if 'wiek' in df:
        wiek = pd.to_numeric(df['wiek'], errors='coerce')
        L.append(f'- Wiek: M = {f2(wiek.mean(), 1)}, SD = {f2(wiek.std(), 1)}, zakres {f2(wiek.min(), 0)}–{f2(wiek.max(), 0)}')
    for kol in ['plec', 'wyksztalcenie', 'urzadzenie', 'elearning', 'widzenie_barw']:
        if kol in df:
            vc = df[kol].fillna('brak').value_counts()
            L.append(f'- {kol}: ' + ', '.join(f'{k} {v}' for k, v in vc.items()))
    L.append('')

    L += ['## Statystyki opisowe wyniku pozycyjnego', '', '| Grupa | N | M | SD | Mediana |', '|---|---|---|---|---|']
    for w, opis in WERSJE.items():
        x = df.loc[df['wersja'] == w, 'wynik_pozycje'].dropna()
        L.append(f'| {w}: {opis} | {len(x)} | {f2(x.mean())} | {f2(x.std())} | {f2(x.median(), 1)} |')
    for kol, val, nazwa in [('kolor', 'blue', 'Kolor niebieski'), ('kolor', 'red', 'Kolor czerwony'),
                            ('ksztalt', 'round', 'Kształt zaokrąglony'), ('ksztalt', 'sharp', 'Kształt ostry')]:
        x = df.loc[df[kol] == val, 'wynik_pozycje'].dropna()
        L.append(f'| **{nazwa}** | {len(x)} | {f2(x.mean())} | {f2(x.std())} | {f2(x.median(), 1)} |')
    L.append('')

    L += ['## Analiza główna: ANOVA 2×2 dla wyniku pozycyjnego', '']
    res = anova_2x2(df, 'wynik_pozycje')
    if res is None:
        L += ['Za mało danych do ANOVA.', '']
    else:
        tab, resid = res
        L += ['| Efekt | SS | df | F | p | η²cz |', '|---|---|---|---|---|---|']
        for _, r in tab.iterrows():
            L.append(f'| {r.efekt} | {f2(r.SS)} | {int(r.df)} | {f2(r.F)} | {fmt_p(r.p)} | {f2(r.eta2_cz, 3)} |')
        L.append('')
        grupy = [df.loc[df['wersja'] == w, 'wynik_pozycje'].dropna() for w in WERSJE]
        grupy = [g for g in grupy if len(g) > 1]
        if len(grupy) >= 2:
            lev = stats.levene(*grupy)
            L.append(f'- Jednorodność wariancji (Levene): W = {f2(lev.statistic)}, p = {fmt_p(lev.pvalue)}')
        if 3 <= len(resid) <= 5000:
            sh = stats.shapiro(resid)
            L.append(f'- Normalność reszt (Shapiro–Wilk): W = {f2(sh.statistic, 3)}, p = {fmt_p(sh.pvalue)}')
        L.append('- Wynik 0–10 jest dyskretny i często skośny — dlatego poniżej również testy nieparametryczne.')
        L.append('')

    L += ['## Testy nieparametryczne (kontrolnie)', '']
    for kol, a, b, nazwa in [('kolor', 'blue', 'red', 'Kolor: niebieski vs czerwony'),
                             ('ksztalt', 'round', 'sharp', 'Kształt: zaokrąglony vs ostry')]:
        xa = df.loc[df[kol] == a, 'wynik_pozycje'].dropna()
        xb = df.loc[df[kol] == b, 'wynik_pozycje'].dropna()
        if len(xa) > 1 and len(xb) > 1:
            mw = stats.mannwhitneyu(xa, xb, alternative='two-sided')
            rbc = 1 - 2 * mw.statistic / (len(xa) * len(xb))
            L.append(f'- {nazwa}: U = {f2(mw.statistic, 1)}, p = {fmt_p(mw.pvalue)}, r (rang-biseryjna) = {f2(rbc, 3)}, d Cohena = {f2(cohen_d(xa, xb), 3)}')
    grupy = [df.loc[df['wersja'] == w, 'wynik_pozycje'].dropna() for w in WERSJE]
    if sum(len(g) > 1 for g in grupy) >= 2:
        kw = stats.kruskal(*[g for g in grupy if len(g) > 0])
        L.append(f'- Kruskal–Wallis (4 wersje): H = {f2(kw.statistic)}, p = {fmt_p(kw.pvalue)}')
    L.append('')

    L += ['## Zmienne dodatkowe (ANOVA 2×2, p dla efektów)', '',
          '| Zmienna | M nieb. | M czerw. | M zaokr. | M ostry | p kolor | p kształt | p interakcja |', '|---|---|---|---|---|---|---|---|']
    for c, opis in ZMIENNE:
        if c not in df or df[c].notna().sum() < 6:
            continue
        r = anova_2x2(df, c)
        if r is None:
            continue
        t = r[0].set_index('efekt')
        m = lambda kol, v: df.loc[df[kol] == v, c].mean()
        d = 0 if c.endswith('_ms') else 2
        L.append(f'| {opis} | {f2(m("kolor", "blue"), d)} | {f2(m("kolor", "red"), d)} | {f2(m("ksztalt", "round"), d)} | '
                 f'{f2(m("ksztalt", "sharp"), d)} | {fmt_p(t.loc["Kolor", "p"])} | {fmt_p(t.loc["Kształt", "p"])} | {fmt_p(t.loc["Kolor × Kształt", "p"])} |')
    L.append('')

    if {'nauka_suma_ms', 'wynik_pozycje'} <= set(df.columns):
        d = df[['nauka_suma_ms', 'wynik_pozycje']].dropna()
        if len(d) > 3:
            rho = stats.spearmanr(d['nauka_suma_ms'], d['wynik_pozycje'])
            L += ['## Czas nauki a wynik', '',
                  f'Korelacja Spearmana łącznego czasu nauki z wynikiem pozycyjnym: ρ = {f2(rho.statistic, 3)}, p = {fmt_p(rho.pvalue)}. '
                  'Jeśli wersje różnią się czasem nauki, warto rozważyć ANCOVA z czasem nauki jako kowariantem.', '']

    if 'wzor_pozycji' in df:
        wz = df['wzor_pozycji'].dropna().astype(str).str.zfill(10)
        wz = wz[wz.str.fullmatch(r'[01]{10}')]
        if len(wz):
            krzywa = [wz.str[i].astype(int).mean() * 100 for i in range(10)]
            L += ['## Krzywa pozycji szeregowej (% poprawnych na każdej pozycji)', '',
                  '| ' + ' | '.join(str(i + 1) for i in range(10)) + ' |', '|' + '---|' * 10,
                  '| ' + ' | '.join(f2(v, 0) for v in krzywa) + ' |', '',
                  'Typowo widać efekt pierwszeństwa (początek) i świeżości (koniec).', '']
    return '\n'.join(L)


def wykresy(df):
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        return []
    pliki = []
    fig, ax = plt.subplots(figsize=(7, 4.2))
    dane = [df.loc[df['wersja'] == w, 'wynik_pozycje'].dropna() for w in WERSJE]
    bp = ax.boxplot(dane, patch_artist=True, widths=.55)
    ax.set_xticks(range(1, 5), [f'{w}\n{o}' for w, o in WERSJE.items()], fontsize=8)
    for patch, c in zip(bp['boxes'], ['#8fb3da', '#8fb3da', '#e05050', '#e05050']):
        patch.set_facecolor(c)
    for i, d in enumerate(dane, 1):
        ax.scatter(np.random.normal(i, .06, len(d)), d, s=10, color='#222', alpha=.45, zorder=3)
    ax.set_ylabel('Wynik pozycyjny (0–10)'); ax.set_ylim(-.5, 10.5)
    ax.set_title('Wynik zapamiętania w czterech wersjach interfejsu')
    fig.tight_layout(); p = OUT / 'wykres_wersje.png'; fig.savefig(p, dpi=160); plt.close(fig); pliki.append(p)

    fig, ax = plt.subplots(figsize=(5.5, 4))
    for kol_v, kolor, lab in [('blue', '#4677b0', 'niebieski'), ('red', '#d01c1c', 'czerwony')]:
        m = [df.loc[(df['kolor'] == kol_v) & (df['ksztalt'] == s), 'wynik_pozycje'].mean() for s in ['round', 'sharp']]
        se = [df.loc[(df['kolor'] == kol_v) & (df['ksztalt'] == s), 'wynik_pozycje'].sem() for s in ['round', 'sharp']]
        ax.errorbar([0, 1], m, yerr=se, marker='o', capsize=4, color=kolor, label=f'kolor: {lab}')
    ax.set_xticks([0, 1], ['zaokrąglony', 'ostry']); ax.set_xlabel('Kształt'); ax.set_ylabel('Średni wynik ± SE')
    ax.set_title('Wykres interakcji kolor × kształt'); ax.legend()
    fig.tight_layout(); p = OUT / 'wykres_interakcja.png'; fig.savefig(p, dpi=160); plt.close(fig); pliki.append(p)
    return pliki


def symuluj(n, seed=7):
    rng = np.random.default_rng(seed)
    w = np.array(list('ABCD'))[np.arange(n) % 4]
    kolor = np.where(np.isin(w, ['A', 'B']), 'blue', 'red')
    ksztalt = np.where(np.isin(w, ['A', 'C']), 'round', 'sharp')
    # przykładowy niewielki efekt kształtu, brak efektu koloru — tylko do demonstracji!
    zdolnosc = rng.normal(6.2, 1.8, n) + np.where(ksztalt == 'round', .45, -.45)
    wynik = np.clip(np.round(zdolnosc), 0, 10).astype(int)
    df = pd.DataFrame({
        'id_uczestnika': [f'sym-{i}' for i in range(n)], 'status': 'ukonczone', 'test': False, 'wycofane': False,
        'wersja': w, 'kolor': kolor, 'ksztalt': ksztalt, 'wynik_pozycje': wynik,
        'wynik_cyfry': np.clip(wynik + rng.integers(0, 3, n), 0, 10),
        'levenshtein': np.clip(10 - wynik - rng.integers(0, 2, n), 0, 10), 'poprawny_poczatek': np.minimum(wynik, rng.integers(2, 11, n)),
        'nauka_srednia_ms': rng.normal(1900, 500, n).round(), 'wpis_calosc_ms': rng.normal(14000, 4000, n).round(),
        'ank_stres': rng.integers(1, 8, n), 'ank_trudnosc': rng.integers(2, 8, n), 'ank_skupienie': rng.integers(3, 8, n),
        'ank_przyjemnosc': rng.integers(2, 8, n), 'ank_wyglad': rng.integers(1, 8, n),
        'notowal': 'nie', 'znal_kod': 'nie', 'wiek': rng.integers(19, 45, n),
        'plec': rng.choice(['kobieta', 'mezczyzna'], n), 'urzadzenie': rng.choice(['telefon', 'komputer'], n),
        'wzor_pozycji': [''.join('1' if rng.random() < (s / 10 + (.15 if i in (0, 9) else 0)) else '0' for i in range(10)) for s in wynik],
    })
    df['nauka_suma_ms'] = df['nauka_srednia_ms'] * 10
    p = OUT / 'symulowane.csv'
    df.to_csv(p, index=False)
    return p


def main():
    ap = argparse.ArgumentParser(description='Analiza badania 2×2 (kolor × kształt).')
    ap.add_argument('csv', nargs='?', help='plik CSV pobrany z arkusza "Wyniki"')
    ap.add_argument('--symuluj', type=int, metavar='N', help='wygeneruj N symulowanych uczestników i przeanalizuj je')
    a = ap.parse_args()
    if a.symuluj:
        sciezka = symuluj(a.symuluj)
        print(f'Wygenerowano dane symulowane: {sciezka}')
    elif a.csv:
        sciezka = a.csv
    else:
        ap.print_help(); sys.exit(1)
    df, log = wczytaj(sciezka)
    tekst = raport(df, log)
    (OUT / 'raport.md').write_text(tekst, encoding='utf-8')
    pliki = wykresy(df)
    print(tekst)
    print('\nZapisano:', OUT / 'raport.md', *pliki, sep='\n  ')


if __name__ == '__main__':
    main()
