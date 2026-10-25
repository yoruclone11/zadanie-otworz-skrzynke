/*
 * Konfiguracja badania — jedyny plik, który trzeba edytować.
 *
 * ENDPOINT: adres aplikacji Google Apps Script (kończy się na /exec).
 *   Instrukcja w README.md, sekcja "Podłączenie Google Sheets".
 *   Gdy jest pusty, badanie działa w trybie demonstracyjnym:
 *   wyniki trafiają tylko do konsoli przeglądarki i localStorage.
 */
window.STUDY_CONFIG = {
  ENDPOINT: '',

  // Stały kod (10 cyfr) — identyczny dla wszystkich badanych.
  // Bez wzorców (rosnących ciągów, dat); dwie cyfry się powtarzają,
  // więc ostatniej nie da się odgadnąć przez eliminację.
  SEQUENCE: '4827491638',

  // Minimalny czas wyświetlania jednej cyfry (ms), zanim można kliknąć „Dalej”.
  MIN_TILE_MS: 1000,

  // Dane badacza pokazywane w informacjach o badaniu (puste = ukryte).
  RESEARCHER: '',
  CONTACT_EMAIL: '',

  VERSION: '1.0.0'
};
