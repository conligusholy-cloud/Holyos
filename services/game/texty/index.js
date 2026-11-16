// =============================================================================
// Laundromat Tycoon — překlady na serveru
// =============================================================================
// Načte katalogy z disku a dá dohromady jednu funkci t(). Server musí skládat
// každou hlášku v jazyce toho, KOMU ji posílá — ne toho, kdo akci vyvolal.
// V dražbě a na burze se potkají dva hráči s různým nastavením a každý má
// dostat svoje.
'use strict';

const fs = require('fs');
const path = require('path');
const jadro = require('./jadro');

const KATALOGY = {};
function nacti() {
  jadro.JAZYKY.forEach((j) => {
    try {
      KATALOGY[j] = JSON.parse(fs.readFileSync(path.join(__dirname, j + '.json'), 'utf8'));
    } catch (e) {
      console.warn('[game-texty] katalog ' + j + ' se nenačetl:', e && e.message);
      KATALOGY[j] = KATALOGY[j] || {};
    }
  });
}
nacti();
const P = new jadro.Preklady(KATALOGY);

// Jazyk hráče. Hodnota mimo seznam (stará data, překlep) spadne na češtinu.
function jazykHrace(hrac) {
  const j = hrac && hrac.jazyk;
  return jadro.JAZYKY.indexOf(j) >= 0 ? j : jadro.ZDROJ;
}
// Hlavní funkce. Pořadí argumentů schválně končí jazykem — ten se často
// dotahuje až na posledni chvíli z příjemce.
function t(klic, udaje, jazyk) { return P.t(klic, udaje, jazyk); }
// Pro hráče: t pro toho, komu to píšu.
function tHraci(hrac, klic, udaje) { return P.t(klic, udaje, jazykHrace(hrac)); }

// Celý katalog pro prohlížeč. Angličtině se podstrčí česká podkladová vrstva,
// aby hra nemusela řešit padání na zdroj sama a nepřišel chybějící klíč jako
// holý 'drazba.vyvolal'.
function katalogPro(jazyk) {
  const j = jadro.JAZYKY.indexOf(jazyk) >= 0 ? jazyk : jadro.ZDROJ;
  if (j === jadro.ZDROJ) return KATALOGY[jadro.ZDROJ] || {};
  return Object.assign({}, KATALOGY[jadro.ZDROJ] || {}, KATALOGY[j] || {});
}

module.exports = {
  t, tHraci, jazykHrace, katalogPro, nacti,
  JAZYKY: jadro.JAZYKY, ZDROJ: jadro.ZDROJ,
  cislo: jadro.cislo, penize: jadro.penize, datum: jadro.datum,
  _katalogy: KATALOGY,
};
