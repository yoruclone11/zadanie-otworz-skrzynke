/*
 * Badanie: wpływ stylu interfejsu na zapamiętywanie (schemat 2×2)
 *
 * Przebieg: ładowanie → przydział wersji → powitanie/zgoda → metryczka →
 * instrukcja → odliczanie → 10 kafelków (nauka) → skrzynka (odtwarzanie) →
 * ankieta → zapis → wynik + wyjaśnienie celu (debriefing).
 *
 * Parametry URL (do testów; rekord dostaje test = TRUE):
 *   ?w=A|B|C|D   wymuszenie wersji
 *   ?test        tryb testowy (pomija blokadę ponownego udziału)
 *   ?debug       tryb testowy + podgląd zapisywanego rekordu
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Konfiguracja                                                         */
  /* ------------------------------------------------------------------ */
  const CFG = window.STUDY_CONFIG || {};
  const SEQ = String(CFG.SEQUENCE || '4827491638').replace(/\D/g, '');
  const N = SEQ.length;
  const MIN_TILE = Math.max(0, Number(CFG.MIN_TILE_MS) || 1000);
  const ENDPOINT = String(CFG.ENDPOINT || '').trim();
  const VERSION = CFG.VERSION || '1.0.0';

  const CONDITIONS = {
    A: { color: 'blue', shape: 'round', label: 'niebieska, zaokrąglone elementy' },
    B: { color: 'blue', shape: 'sharp', label: 'niebieska, ostre elementy' },
    C: { color: 'red',  shape: 'round', label: 'czerwona, zaokrąglone elementy' },
    D: { color: 'red',  shape: 'sharp', label: 'czerwona, ostre elementy' },
  };
  const THEME_COLOR = { blue: '#eaf1f9', red: '#ffffff' };

  const LS_DONE = 'badanie_ui_ukonczone';
  const LS_BACKUP = 'badanie_ui_kopia';
  const SS_SESSION = 'badanie_ui_sesja';
  const PHASES = ['loading', 'welcome', 'form', 'instr', 'countdown', 'study', 'lock', 'survey', 'reveal'];

  const qs = new URLSearchParams(location.search);
  const forced = (qs.get('w') || '').toUpperCase();
  const DEBUG = qs.has('debug');
  const IS_TEST = DEBUG || qs.has('test') || !!CONDITIONS[forced];

  /* ------------------------------------------------------------------ */
  /* Narzędzia                                                            */
  /* ------------------------------------------------------------------ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const now = () => performance.now();
  const T0 = now();
  const startedAt = new Date();
  const round = (x) => (x == null || !isFinite(x) ? '' : Math.round(x));
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(area, k) { try { const v = area.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(area, k, v) { try { area.setItem(k, JSON.stringify(v)); } catch (e) { /* tryb prywatny itp. */ } },
    del(area, k) { try { area.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const SS = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();
  const lsGet = (k) => (LS ? store.get(LS, k) : null);
  const lsSet = (k, v) => LS && store.set(LS, k, v);
  const ssGet = (k) => (SS ? store.get(SS, k) : null);
  const ssSet = (k, v) => SS && store.set(SS, k, v);

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.random() * 256));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const shortCode = (pid) => pid.replace(/-/g, '').slice(0, 8).toUpperCase().replace(/(.{4})(.{4})/, '$1-$2');

  function describe(arr) {
    const a = arr.filter((x) => typeof x === 'number' && isFinite(x));
    if (!a.length) return { sum: '', mean: '', median: '', sd: '', min: '', max: '' };
    const sum = a.reduce((s, x) => s + x, 0);
    const mean = sum / a.length;
    const sorted = [...a].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const sd = a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1)) : 0;
    return { sum, mean, median, sd, min: sorted[0], max: sorted[sorted.length - 1] };
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  /* Punktacja odtworzenia */
  function scoreResponse(resp) {
    let pos = 0, prefix = 0, stillPrefix = true;
    const pattern = [];
    for (let i = 0; i < N; i++) {
      const ok = resp[i] === SEQ[i];
      if (ok) pos++;
      if (ok && stillPrefix) prefix++; else stillPrefix = false;
      pattern.push(ok ? '1' : '0');
    }
    // trafione cyfry bez względu na pozycję (część wspólna multizbiorów)
    const cnt = {};
    for (const c of SEQ) cnt[c] = (cnt[c] || 0) + 1;
    let items = 0;
    for (const c of resp) if (cnt[c] > 0) { items++; cnt[c]--; }
    return { pos, items, prefix, pattern: pattern.join(''), lev: levenshtein(SEQ, resp) };
  }

  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    let type = 'komputer';
    if (/iPad|Tablet/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua))) type = 'tablet';
    else if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(ua)) type = 'telefon';
    let os = 'inny';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/iPhone|iPad|iPod/i.test(ua) || touchMac) os = 'iOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
    else if (/CrOS/i.test(ua)) os = 'ChromeOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    let browser = 'inna';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/SamsungBrowser/.test(ua)) browser = 'Samsung';
    else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
    else if (/Chrome|CriOS/.test(ua)) browser = 'Chrome';
    else if (/Safari/.test(ua)) browser = 'Safari';
    return {
      urzadzenie: type, system: os, przegladarka: browser,
      wskaznik: matchMedia('(pointer: coarse)').matches ? 'dotyk' : 'mysz',
      okno_szer: window.innerWidth, okno_wys: window.innerHeight,
      ekran_szer: screen.width, ekran_wys: screen.height,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      ograniczony_ruch: reducedMotion,
      tryb_ciemny_os: matchMedia('(prefers-color-scheme: dark)').matches,
      jezyk: navigator.language || '',
    };
  }

  /* ------------------------------------------------------------------ */
  /* Stan badania                                                         */
  /* ------------------------------------------------------------------ */
  const S = {
    pid: null, condition: null, assignment: null,
    phase: 'loading', screenEnter: T0, screenTimes: {},
    events: [], form: {}, survey: {},
    tiles: new Array(N).fill(null), tileIndex: -1, tileShownAt: 0, lastTileAt: null, holdTimer: null,
    input: { value: '', shownAt: null, firstKeyAt: null, submitAt: null, keys: 0, dels: 0, clears: 0, kb: 0, pad: 0 },
    blur: {}, hidden: {}, hiddenSince: null,
    result: null, saved: false,
  };

  function log(e, data) {
    const ev = { t: Math.round(now() - T0), p: S.phase, e };
    if (data) Object.assign(ev, data);
    S.events.push(ev);
    if (S.events.length > 400) S.events.shift();
  }

  function writeSession(extra) {
    const prev = ssGet(SS_SESSION) || {};
    const reachedIdx = Math.max(PHASES.indexOf(prev.reached || 'loading'), PHASES.indexOf(S.phase));
    ssSet(SS_SESSION, Object.assign(prev, {
      pid: S.pid, condition: S.condition, assignment: S.assignment, reached: PHASES[reachedIdx] || S.phase,
    }, extra || {}));
  }

  /* ------------------------------------------------------------------ */
  /* Ekrany                                                               */
  /* ------------------------------------------------------------------ */
  function show(id) {
    const t = now();
    S.screenTimes[S.phase] = (S.screenTimes[S.phase] || 0) + (t - S.screenEnter);
    S.phase = id;
    S.screenEnter = t;
    $$('main > .screen').forEach((el) => el.classList.toggle('active', el.id === 's-' + id));
    log('screen');
    if (S.pid && PHASES.includes(id)) writeSession();
    window.scrollTo(0, 0);
    const h = $('#s-' + id + ' h1, #s-' + id + ' h2');
    if (h && id !== 'study' && id !== 'countdown') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function applyTheme(code) {
    const c = CONDITIONS[code] || CONDITIONS.A;
    const root = document.documentElement;
    root.dataset.color = c.color;
    root.dataset.shape = c.shape;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[c.color]);
    // zaokrąglenia elementów SVG (skrzynka) zależne od czynnika "kształt"
    $$('[data-r]').forEach((el) => {
      const r = c.shape === 'round' ? el.getAttribute('data-r') : '0';
      el.setAttribute('rx', r); el.setAttribute('ry', r);
    });
  }

  /* Skrzynka (SVG) — wstawiana w dwa miejsca, bez id, żeby uniknąć duplikatów */
  const CHEST_SVG = `
  <svg class="chest" viewBox="0 0 260 230" aria-hidden="true">
    <ellipse class="ch-shadow" cx="130" cy="214" rx="104" ry="10"/>
    <g class="glow">
      <ellipse class="ch-glow" cx="130" cy="104" rx="88" ry="30" opacity=".85"/>
      <line class="ch-ray" x1="130" y1="62" x2="130" y2="18"/>
      <line class="ch-ray" x1="88"  y1="70" x2="66"  y2="34"/>
      <line class="ch-ray" x1="172" y1="70" x2="194" y2="34"/>
    </g>
    <g class="shake">
      <rect class="ch-body"  x="34"  y="104" width="192" height="100" data-r="16"/>
      <rect class="ch-band"  x="58"  y="104" width="20"  height="100" data-r="4"/>
      <rect class="ch-band"  x="182" y="104" width="20"  height="100" data-r="4"/>
      <g class="lid">
        <rect class="ch-lid"  x="28"  y="56" width="204" height="54" data-r="20"/>
        <rect class="ch-band" x="58"  y="56" width="20"  height="54" data-r="4"/>
        <rect class="ch-band" x="182" y="56" width="20"  height="54" data-r="4"/>
      </g>
      <rect class="ch-plate" x="110" y="90" width="40" height="48" data-r="10"/>
      <g class="keyhole">
        <circle class="ch-hole" cx="130" cy="108" r="6"/>
        <rect class="ch-hole" x="127.5" y="110" width="5" height="14" data-r="2"/>
      </g>
    </g>
  </svg>`;

  function mountChests() {
    $$('[data-chest]').forEach((el) => { el.innerHTML = CHEST_SVG; });
  }

  function setLid(container, frac) {
    const lid = $('.lid', container);
    const glow = $('.glow', container);
    if (!lid) return;
    if (frac <= 0) { lid.style.transform = ''; glow.style.opacity = '0'; return; }
    const angle = -(3 + 22 * frac);
    const lift = -(2 + 6 * frac);
    lid.style.transform = `translate(0px, ${lift}px) rotate(${angle}deg)`;
    glow.style.opacity = String(Math.min(1, 0.15 + frac));
  }

  function shake(container) {
    const g = $('.shake', container);
    if (!g) return;
    g.classList.remove('go'); void g.getBoundingClientRect(); g.classList.add('go');
  }

  /* ------------------------------------------------------------------ */
  /* Śledzenie uwagi: opuszczenie okna / ukrycie karty                    */
  /* ------------------------------------------------------------------ */
  function bindFocusTracking() {
    window.addEventListener('blur', () => {
      S.blur[S.phase] = (S.blur[S.phase] || 0) + 1;
      log('blur');
    });
    window.addEventListener('focus', () => log('focus'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        S.hiddenSince = { t: now(), phase: S.phase };
        log('hidden');
      } else if (S.hiddenSince) {
        const dt = now() - S.hiddenSince.t;
        S.hidden[S.hiddenSince.phase] = (S.hidden[S.hiddenSince.phase] || 0) + dt;
        S.hiddenSince = null;
        log('visible', { ms: Math.round(dt) });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Przydział do wersji (równoważony na podstawie liczebności grup)      */
  /* ------------------------------------------------------------------ */
  async function fetchJSON(url, timeoutMs) {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  async function assignCondition() {
    if (CONDITIONS[forced]) return { condition: forced, assignment: 'wymuszony' };
    const codes = Object.keys(CONDITIONS);
    if (ENDPOINT) {
      try {
        const data = await fetchJSON(`${ENDPOINT}?action=counts&_=${Date.now()}`, 3500);
        if (data && data.ok && data.counts) {
          const min = Math.min(...codes.map((c) => Number(data.counts[c]) || 0));
          const pool = codes.filter((c) => (Number(data.counts[c]) || 0) === min);
          return { condition: pool[Math.floor(Math.random() * pool.length)], assignment: 'zrownowazony' };
        }
      } catch (e) { log('counts_error', { msg: String(e && e.message || e) }); }
    }
    return { condition: codes[Math.floor(Math.random() * codes.length)], assignment: 'losowy' };
  }

  /* ------------------------------------------------------------------ */
  /* 1. Powitanie                                                         */
  /* ------------------------------------------------------------------ */
  function initWelcome() {
    const a = $('#c-adult'), c = $('#c-consent'), b = $('#btn-start');
    const upd = () => { b.disabled = !(a.checked && c.checked); };
    a.addEventListener('change', upd); c.addEventListener('change', upd);
    b.addEventListener('click', () => { log('consent'); show('form'); });

    const parts = [];
    if (CFG.RESEARCHER) parts.push(`<strong>Badacz:</strong> ${escapeHtml(CFG.RESEARCHER)}`);
    if (CFG.CONTACT_EMAIL) parts.push(`<strong>Kontakt:</strong> <a href="mailto:${escapeHtml(CFG.CONTACT_EMAIL)}">${escapeHtml(CFG.CONTACT_EMAIL)}</a>`);
    if (parts.length) { const p = $('#researcher-line'); p.innerHTML = parts.join('<br>'); p.hidden = false; }
    if (CFG.CONTACT_EMAIL) $('#contact-line').innerHTML = ` Kontakt: <a href="mailto:${escapeHtml(CFG.CONTACT_EMAIL)}">${escapeHtml(CFG.CONTACT_EMAIL)}</a>.`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ */
  /* 2. Metryczka                                                         */
  /* ------------------------------------------------------------------ */
  const YEAR = new Date().getFullYear();

  function initForm() {
    const sel = $('#f-rok');
    for (let y = YEAR - 16; y >= YEAR - 90; y--) {
      const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); sel.appendChild(o);
    }
    const form = $('#form-meta');
    form.addEventListener('change', (e) => {
      const fs = e.target.closest('fieldset'); if (fs) fs.classList.remove('invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {};
      let firstBad = null;
      $$('fieldset[data-req]', form).forEach((fs) => {
        const name = fs.dataset.req;
        const el = form.elements[name];
        const val = el ? (el.value || '') : '';
        fs.classList.toggle('invalid', !val);
        if (!val && !firstBad) firstBad = fs;
        data[name] = val;
      });
      if (firstBad) { firstBad.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }); return; }
      S.form = data;
      const age = YEAR - Number(data.rok_urodzenia);
      log('form_ok');
      if (age < 18) { show('underage'); ssSet(SS_SESSION, null); return; }
      show('instr');
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3. Instrukcja + odliczanie                                           */
  /* ------------------------------------------------------------------ */
  function initInstr() {
    $('#btn-ready').addEventListener('click', async () => {
      show('countdown');
      const el = $('#cd-num');
      for (const n of [3, 2, 1]) {
        el.textContent = String(n);
        el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        await wait(800);
      }
      startStudy();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. Nauka — 10 kafelków                                               */
  /* ------------------------------------------------------------------ */
  function startStudy() {
    const dots = $('#dots');
    dots.innerHTML = '';
    for (let i = 0; i < N; i++) dots.appendChild(document.createElement('span'));
    show('study');
    showTile(0);
  }

  function showTile(i) {
    S.tileIndex = i;
    const tile = $('#tile');
    $('#tile-digit').textContent = SEQ[i];
    tile.classList.remove('enter', 'leave'); void tile.offsetWidth; tile.classList.add('enter');
    S.tileShownAt = now();
    $$('#dots span').forEach((d, k) => { d.className = k < i ? 'done' : k === i ? 'now' : ''; });
    $('#tile-count').textContent = `Cyfra ${i + 1} z ${N}`;

    const btn = $('#btn-next');
    btn.disabled = true;
    btn.textContent = i === N - 1 ? 'Przejdź do skrzynki' : 'Dalej';
    const bar = $('#hold-bar');
    bar.style.setProperty('--hold', MIN_TILE + 'ms');
    bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    clearTimeout(S.holdTimer);
    S.holdTimer = setTimeout(() => { btn.disabled = false; }, MIN_TILE);
    log('tile_show', { i });
  }

  function nextTile() {
    const btn = $('#btn-next');
    if (S.phase !== 'study' || btn.disabled) return;
    btn.disabled = true;
    const i = S.tileIndex;
    const t = now();
    S.tiles[i] = Math.round(t - S.tileShownAt);
    S.lastTileAt = t;
    log('tile_next', { i, ms: S.tiles[i] });
    const tile = $('#tile');
    tile.classList.remove('enter'); tile.classList.add('leave');
    setTimeout(() => { if (i + 1 < N) showTile(i + 1); else startLock(); }, 170);
  }

  /* ------------------------------------------------------------------ */
  /* 5. Skrzynka — wpisywanie kodu                                        */
  /* ------------------------------------------------------------------ */
  function buildSlots(container) {
    container.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const s = document.createElement('div'); s.className = 'slot'; container.appendChild(s);
    }
  }

  function renderSlots(popIndex) {
    const v = S.input.value;
    $$('#slots .slot').forEach((s, i) => {
      s.textContent = v[i] || '';
      s.classList.toggle('cursor', i === v.length);
      if (i === popIndex) { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); }
    });
    $('#btn-open').disabled = v.length !== N;
    $('#slots-live').textContent = v.length ? `Wpisano ${v.length} z ${N} cyfr` : '';
  }

  function startLock() {
    buildSlots($('#slots'));
    show('lock');
    S.input.shownAt = now();
    renderSlots();
  }

  function pressKey(k, via) {
    const inp = S.input;
    if (S.phase !== 'lock' || inp.submitAt) return;
    if (/^\d$/.test(k)) {
      if (inp.value.length >= N) return;
      if (inp.firstKeyAt == null) inp.firstKeyAt = now();
      inp.value += k; inp.keys++; via === 'kb' ? inp.kb++ : inp.pad++;
      log('key', { k, pos: inp.value.length });
      renderSlots(inp.value.length - 1);
    } else if (k === 'del') {
      if (!inp.value.length) return;
      inp.value = inp.value.slice(0, -1); inp.dels++;
      log('del', { pos: inp.value.length });
      renderSlots();
    } else if (k === 'clr') {
      if (!inp.value.length) return;
      inp.value = ''; inp.clears++;
      log('clear');
      renderSlots();
    }
  }

  async function submitCode() {
    const inp = S.input;
    if (S.phase !== 'lock' || inp.submitAt || inp.value.length !== N) return;
    inp.submitAt = now();
    S.result = scoreResponse(inp.value);
    log('submit');
    $('#lock-card').classList.add('lock-busy');
    $$('#slots .slot').forEach((s) => s.classList.remove('cursor'));
    const box = $('[data-chest="lock"]');
    const kh = $('.keyhole', box);
    kh.classList.add('turn');
    await wait(450);
    shake(box);
    await wait(1100);
    show('survey');
  }

  function initLock() {
    $('#keypad').addEventListener('click', (e) => {
      const b = e.target.closest('.key'); if (!b) return;
      pressKey(b.dataset.k, 'pad');
    });
    $('#btn-open').addEventListener('click', submitCode);
  }

  /* ------------------------------------------------------------------ */
  /* Klawiatura fizyczna                                                  */
  /* ------------------------------------------------------------------ */
  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (S.phase === 'study') {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (!e.repeat) nextTile();
        }
      } else if (S.phase === 'lock') {
        let k = null;
        if (/^\d$/.test(e.key)) k = e.key;
        else if (e.key === 'Backspace') k = 'del';
        else if (e.key === 'Escape') k = 'clr';
        else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) submitCode(); return; }
        if (k) {
          e.preventDefault();
          pressKey(k, 'kb');
          const btn = $(`#keypad .key[data-k="${k}"]`);
          if (btn) { btn.classList.add('press'); setTimeout(() => btn.classList.remove('press'), 110); }
        }
      }
    });
    $('#btn-next').addEventListener('click', nextTile);
  }

  /* ------------------------------------------------------------------ */
  /* 6. Ankieta                                                           */
  /* ------------------------------------------------------------------ */
  const SCALES = [
    { k: 'ank_trudnosc', q: 'Jak trudne było dla Ciebie zadanie?', lo: 'bardzo łatwe', hi: 'bardzo trudne' },
    { k: 'ank_stres', q: 'Jak bardzo czułeś/aś napięcie lub stres podczas zadania?', lo: 'wcale', hi: 'bardzo mocno' },
    { k: 'ank_skupienie', q: 'Na ile udało Ci się skupić na zadaniu?', lo: 'wcale', hi: 'całkowicie' },
    { k: 'ank_przyjemnosc', q: 'Jak przyjemnie korzystało Ci się z tej strony?', lo: 'bardzo nieprzyjemnie', hi: 'bardzo przyjemnie' },
    { k: 'ank_wyglad', q: 'Jak oceniasz wygląd strony?', lo: 'bardzo nieatrakcyjny', hi: 'bardzo atrakcyjny' },
  ];
  const CHOICES = [
    { k: 'strategia', multi: true, req: false, q: 'W jaki sposób zapamiętywałeś/aś kod?', hint: 'Możesz zaznaczyć kilka odpowiedzi.',
      o: [['powtarzanie', 'Powtarzałem/am cyfry w myślach'], ['grupowanie', 'Dzieliłem/am je na grupy (np. po 2–3)'],
          ['skojarzenia', 'Skojarzenia (daty, numery, wzory)'], ['na_glos', 'Powtarzałem/am na głos'],
          ['brak', 'Bez szczególnej strategii'], ['inna', 'Inaczej']] },
    { k: 'widzenie_barw', req: true, q: 'Czy masz rozpoznane zaburzenia rozróżniania barw (np. daltonizm)?',
      o: [['nie', 'Nie'], ['tak', 'Tak'], ['nie_wiem', 'Nie wiem']] },
    { k: 'notowal', req: true, q: 'Czy podczas zadania zapisywałeś/aś cyfry, robiłeś/aś zdjęcie lub zrzut ekranu?',
      hint: 'Odpowiedz szczerze — to niczego nie zmienia dla Ciebie, a bardzo pomaga w rzetelnej analizie.',
      o: [['nie', 'Nie'], ['tak', 'Tak']] },
    { k: 'znal_kod', req: true, q: 'Czy znałeś/aś ten kod wcześniej (np. od znajomego lub z poprzedniego udziału)?',
      o: [['nie', 'Nie'], ['tak', 'Tak']] },
  ];

  function initSurvey() {
    const box = $('#survey-items');
    let html = '';
    SCALES.forEach((s) => {
      html += `<fieldset class="q" data-req="${s.k}"><legend class="label">${s.q}</legend>
        <div class="scale" style="--n:7">${[1, 2, 3, 4, 5, 6, 7].map((v) =>
          `<label><input type="radio" name="${s.k}" value="${v}"><span>${v}</span></label>`).join('')}</div>
        <div class="scale-ends"><span>${s.lo}</span><span>${s.hi}</span></div>
        <p class="err" role="alert">Zaznacz wartość na skali.</p></fieldset>`;
    });
    CHOICES.forEach((c) => {
      const type = c.multi ? 'checkbox' : 'radio';
      html += `<fieldset class="q" ${c.req ? `data-req="${c.k}"` : ''}><legend class="label">${c.q}</legend>
        ${c.hint ? `<p class="field-hint">${c.hint}</p>` : ''}
        <div class="chips">${c.o.map(([v, l]) =>
          `<label class="chip"><input type="${type}" name="${c.k}" value="${v}"><span>${l}</span></label>`).join('')}</div>
        <p class="err" role="alert">Wybierz odpowiedź.</p></fieldset>`;
    });
    html += `<div class="q"><label class="label" for="f-uwagi">Uwagi (opcjonalnie)</label>
      <textarea id="f-uwagi" name="uwagi" maxlength="600" placeholder="Np. coś Cię rozproszyło albo coś nie działało?"></textarea></div>`;
    box.innerHTML = html;

    const form = $('#form-survey');
    form.addEventListener('change', (e) => { const fs = e.target.closest('fieldset'); if (fs) fs.classList.remove('invalid'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let firstBad = null;
      const data = {};
      $$('fieldset[data-req]', form).forEach((fs) => {
        const name = fs.dataset.req;
        const val = form.elements[name] ? form.elements[name].value : '';
        fs.classList.toggle('invalid', !val);
        if (!val && !firstBad) firstBad = fs;
        data[name] = val;
      });
      if (firstBad) { firstBad.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }); return; }
      data.strategia = $$('input[name="strategia"]:checked', form).map((x) => x.value).join(';');
      data.uwagi = ($('#f-uwagi').value || '').trim().slice(0, 600);
      S.survey = data;
      log('survey_ok');

      const btn = $('#btn-survey');
      btn.disabled = true; btn.textContent = 'Zapisywanie…';
      await saveFinal();
      revealResult();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rekord danych                                                        */
  /* ------------------------------------------------------------------ */
  function buildRecord(status, reached) {
    const c = CONDITIONS[S.condition] || {};
    const st = describe(S.tiles);
    const r = S.result || {};
    const inp = S.input;
    const endT = now();
    const scr = Object.assign({}, S.screenTimes);
    scr[S.phase] = (scr[S.phase] || 0) + (endT - S.screenEnter);
    const hidden = Object.assign({}, S.hidden);
    if (S.hiddenSince) hidden[S.hiddenSince.phase] = (hidden[S.hiddenSince.phase] || 0) + (endT - S.hiddenSince.t);
    const hiddenTotal = Object.values(hidden).reduce((a, b) => a + b, 0);
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }

    const rec = {
      id_uczestnika: S.pid,
      status,
      etap_osiagniety: reached || S.phase,
      wersja_aplikacji: VERSION,
      test: IS_TEST,
      wersja: S.condition,
      kolor: c.color || '',
      ksztalt: c.shape || '',
      przydzial: S.assignment,
      start: startedAt.toISOString(),
      koniec: new Date().toISOString(),
      godzina_lokalna: startedAt.getHours(),
      dzien_tygodnia: ['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'][startedAt.getDay()],
      strefa_czasowa: tz,

      plec: S.form.plec || '',
      rok_urodzenia: S.form.rok_urodzenia || '',
      wiek: S.form.rok_urodzenia ? YEAR - Number(S.form.rok_urodzenia) : '',
      wyksztalcenie: S.form.wyksztalcenie || '',
      sytuacja: S.form.sytuacja || '',
      elearning: S.form.elearning || '',
      zmeczenie: S.form.zmeczenie || '',
    };
    Object.assign(rec, deviceInfo());
    Object.assign(rec, {
      kod_poprawny: SEQ,
      kod_wpisany: inp.value,
      wynik_pozycje: r.pos != null ? r.pos : '',
      wynik_cyfry: r.items != null ? r.items : '',
      levenshtein: r.lev != null ? r.lev : '',
      poprawny_poczatek: r.prefix != null ? r.prefix : '',
      wzor_pozycji: r.pattern || '',
    });
    for (let i = 0; i < N; i++) rec['czas_kafelek_' + (i + 1)] = S.tiles[i] == null ? '' : S.tiles[i];
    Object.assign(rec, {
      nauka_suma_ms: round(st.sum),
      nauka_srednia_ms: round(st.mean),
      nauka_mediana_ms: round(st.median),
      nauka_odch_std_ms: round(st.sd),
      nauka_min_ms: round(st.min),
      nauka_max_ms: round(st.max),
      wpis_pierwszy_klawisz_ms: inp.firstKeyAt != null && inp.shownAt != null ? round(inp.firstKeyAt - inp.shownAt) : '',
      wpis_calosc_ms: inp.submitAt != null && inp.shownAt != null ? round(inp.submitAt - inp.shownAt) : '',
      przerwa_nauka_wpis_ms: inp.submitAt != null && S.lastTileAt != null ? round(inp.submitAt - S.lastTileAt) : '',
      wpis_klawisze: inp.keys,
      wpis_usuniecia: inp.dels,
      wpis_wyczyszczenia: inp.clears,
      wpis_z_klawiatury: inp.kb,
      wpis_z_ekranu: inp.pad,
      opuszczenia_nauka: S.blur.study || 0,
      opuszczenia_wpis: S.blur.lock || 0,
      ukryta_karta_nauka_ms: round(hidden.study || 0),
      ukryta_karta_wpis_ms: round(hidden.lock || 0),
      ukryta_karta_suma_ms: round(hiddenTotal),
      czas_powitanie_ms: round(scr.welcome),
      czas_formularz_ms: round(scr.form),
      czas_instrukcja_ms: round(scr.instr),
      czas_ankieta_ms: round(scr.survey),
      czas_calkowity_ms: round(endT - T0),

      ank_trudnosc: S.survey.ank_trudnosc || '',
      ank_stres: S.survey.ank_stres || '',
      ank_skupienie: S.survey.ank_skupienie || '',
      ank_przyjemnosc: S.survey.ank_przyjemnosc || '',
      ank_wyglad: S.survey.ank_wyglad || '',
      strategia: S.survey.strategia || '',
      widzenie_barw: S.survey.widzenie_barw || '',
      notowal: S.survey.notowal || '',
      znal_kod: S.survey.znal_kod || '',
      uwagi: S.survey.uwagi || '',
      zdarzenia: JSON.stringify(S.events),
    });
    return rec;
  }

  async function post(payload) {
    if (!ENDPOINT) {
      console.info('[badanie] tryb demo (brak ENDPOINT) — rekord:', payload);
      return { ok: true, demo: true };
    }
    const body = JSON.stringify(payload);
    const opts = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(ENDPOINT, opts);
        const data = await res.json();
        if (data && data.ok) return data;
        throw new Error(data && data.error || 'Błąd zapisu');
      } catch (err) {
        log('post_error', { a: attempt, msg: String(err && err.message || err).slice(0, 80) });
        // Ostatnia deska ratunku: tryb no-cors (nie da się odczytać odpowiedzi, ale żądanie dochodzi)
        if (attempt === 2) {
          try { await fetch(ENDPOINT, Object.assign({}, opts, { mode: 'no-cors' })); return { ok: true, blind: true }; }
          catch (e2) { return { ok: false, error: String(e2) }; }
        }
        await wait(700 * (attempt + 1));
      }
    }
    return { ok: false };
  }

  async function saveFinal() {
    const rec = buildRecord('ukonczone', 'survey');
    lsSet(LS_BACKUP, rec); // kopia lokalna na wypadek problemów z siecią
    const res = await post({ type: 'record', record: rec });
    S.saved = !!res.ok;
    log(res.ok ? 'saved' : 'save_failed');
    if (DEBUG) showDebug(rec, res);
    if (!IS_TEST) lsSet(LS_DONE, { pid: S.pid, at: new Date().toISOString() });
    writeSession({ reached: 'reveal' });
  }

  /* ------------------------------------------------------------------ */
  /* 7. Wynik + debriefing                                                */
  /* ------------------------------------------------------------------ */
  function revealResult() {
    const r = S.result || scoreResponse(S.input.value);
    show('reveal');
    const box = $('[data-chest="reveal"]');
    applyTheme(S.condition); // zaokrąglenia w nowo wstawionym SVG
    const frac = r.pos / N;

    // licznik wyniku
    const scoreEl = $('#score');
    const setScore = (v) => { scoreEl.innerHTML = `${v}<small> / ${N}</small>`; };
    setScore(0);
    if (reducedMotion) setScore(r.pos);
    else {
      let v = 0;
      const step = () => { if (v < r.pos) { v++; setScore(v); setTimeout(step, 90); } };
      setTimeout(step, 500);
    }

    const msg = r.pos === N ? 'Brawo! Skrzynka otwarta — cały kod się zgadza.'
      : r.pos >= 7 ? 'Prawie! Skrzynka uchyliła się — większość kodu się zgadza.'
      : r.pos >= 4 ? 'Skrzynka drgnęła — część kodu się zgadza.'
      : 'Zamek nie ustąpił — to naprawdę trudne zadanie!';
    $('#reveal-msg').textContent = msg;

    // wzór trafień — bez ujawniania prawidłowego kodu
    const rs = $('#result-slots');
    buildSlots(rs);
    $$('.slot', rs).forEach((s, i) => {
      const ok = r.pattern[i] === '1';
      s.classList.add(ok ? 'ok' : 'no', 'reveal');
      s.style.animationDelay = (600 + i * 70) + 'ms';
      // bez cyfr — samo ✓/✗, żeby nie ujawniać fragmentów kodu kolejnym osobom
      s.textContent = ok ? '✓' : '✗';
      s.setAttribute('aria-label', `Pozycja ${i + 1}: ${ok ? 'poprawnie' : 'błędnie'}`);
    });

    setTimeout(() => {
      if (frac > 0) setLid(box, frac); else shake(box);
      if (r.pos === N) confetti();
    }, 650);

    $('#my-version').textContent = (CONDITIONS[S.condition] || {}).label || S.condition;
    $('#pid-code').textContent = shortCode(S.pid);
  }

  function confetti() {
    if (reducedMotion) return;
    const wrap = document.createElement('div');
    wrap.className = 'confetti';
    const cols = getComputedStyle(document.documentElement);
    const palette = [cols.getPropertyValue('--primary'), cols.getPropertyValue('--chest-glow'), cols.getPropertyValue('--tile-bg'), '#1f8a4c'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = palette[i % palette.length];
      p.style.setProperty('--x', (Math.random() * 200 - 100) + 'px');
      p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
      p.style.setProperty('--d', (1.8 + Math.random() * 1.6) + 's');
      p.style.animationDelay = Math.random() * 0.5 + 's';
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 4500);
  }

  function initReveal() {
    $('#btn-share').addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      const label = $('#btn-share span');
      try {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) {
          await navigator.share({ title: 'Badanie — weź udział (5 min)', url });
        } else {
          await navigator.clipboard.writeText(url);
          label.textContent = 'Skopiowano!';
          setTimeout(() => { label.textContent = 'Skopiuj link do badania'; }, 2200);
        }
      } catch (e) { label.textContent = url; }
      log('share');
    });

    let armed = false;
    $('#btn-withdraw').addEventListener('click', async () => {
      const btn = $('#btn-withdraw'), msg = $('#withdraw-msg');
      if (!armed) {
        armed = true;
        btn.textContent = 'Na pewno? Kliknij ponownie';
        msg.textContent = 'Twoje dane zostaną oznaczone do usunięcia i nie zostaną wykorzystane w analizie.';
        return;
      }
      btn.disabled = true; btn.textContent = 'Wycofywanie…';
      const res = await post({ type: 'withdraw', id_uczestnika: S.pid });
      if (res.ok) {
        btn.textContent = 'Dane wycofane';
        msg.textContent = 'Gotowe — Twoje dane nie zostaną wykorzystane. Dziękuję za udział.';
        if (LS) store.del(LS, LS_BACKUP);
      } else {
        btn.disabled = false; btn.textContent = 'Spróbuj ponownie';
        msg.textContent = `Nie udało się połączyć. Możesz też podać badaczowi kod ${shortCode(S.pid)}.`;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tryb testowy / debug                                                 */
  /* ------------------------------------------------------------------ */
  function showDebug(rec, res) {
    let box = $('.debug-box');
    if (!box) { box = document.createElement('div'); box.className = 'debug-box'; document.body.appendChild(box); }
    const copy = Object.assign({}, rec); copy.zdarzenia = `[${S.events.length} zdarzeń]`;
    box.textContent = `ZAPIS: ${JSON.stringify(res)}\n\n${JSON.stringify(copy, null, 1)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                                */
  /* ------------------------------------------------------------------ */
  async function init() {
    mountChests();
    bindFocusTracking();
    initWelcome(); initForm(); initInstr(); initLock(); initKeyboard(); initSurvey(); initReveal();

    if (IS_TEST) {
      const b = document.createElement('div'); b.className = 'test-badge'; b.textContent = 'TRYB TESTOWY';
      document.body.appendChild(b);
      if (SS) store.del(SS, SS_SESSION);
    }

    // jedna osoba = jeden udział
    if (!IS_TEST && lsGet(LS_DONE)) { applyTheme('A'); show('done'); return; }

    // odświeżenie strony w trakcie badania
    const sess = IS_TEST ? null : ssGet(SS_SESSION);
    if (sess && sess.pid && CONDITIONS[sess.condition]) {
      S.pid = sess.pid; S.condition = sess.condition; S.assignment = sess.assignment;
      applyTheme(S.condition);
      const reached = PHASES.indexOf(sess.reached);
      if (sess.reached === 'reveal') { show('done'); return; }
      if (reached >= PHASES.indexOf('countdown')) {
        show('interrupted');
        if (!sess.abortSent) {
          writeSession({ abortSent: true });
          post({ type: 'record', record: buildRecord('przerwane', sess.reached) });
        }
        return;
      }
      show('welcome');
      return;
    }

    const a = await assignCondition();
    S.condition = a.condition; S.assignment = a.assignment; S.pid = uuid();
    applyTheme(S.condition);
    log('assigned', { w: S.condition, how: S.assignment });
    show('welcome');
    if (DEBUG) showDebug({ wersja: S.condition, przydzial: S.assignment, endpoint: ENDPOINT || '(brak — tryb demo)' }, {});
  }

  // udostępnienie do testów automatycznych (tylko w trybie debug)
  if (DEBUG) window.__badanie = { state: S, buildRecord, scoreResponse };

  init();
})();
