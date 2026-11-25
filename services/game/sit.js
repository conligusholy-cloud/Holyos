// =============================================================================
// Laundromat Tycoon — síť území
// =============================================================================
// Území je BUŇKA pravidelné šestiúhelníkové sítě, která pokrývá celou
// zeměkouli. Jedna buňka má kolem 1 500 km²; český okres má v průměru 1 000,
// takže je to zhruba okres — jen se počítá, místo aby se stahovala.
//
// Proč ne skutečné správní hranice, když o ty šlo původně:
//
//   Hra se ptala OpenStreetMap, do kterého okresu bod patří, a stahovala si
//   obrys. Na papíře to fungovalo, v produkci ne — z Railway ty služby
//   neodpovídaly a na mapě zůstával kruh. A když obrys nedorazil, sahala hra
//   po poslední záchraně a hledala hranici PODLE JMÉNA; na dotaz „Šumperk"
//   odpoví katalog městem Šumperk, takže místo okresu svítila obec.
//
//   Hlavní důvod je ale jiný: hra se hraje po celém světě a správní členění
//   srovnatelné s okresem prostě všude není. Buňka je všude stejná, je hned
//   a nezávisí na ničem cizím.
//
// Tenhle modul je jen geometrie — žádná databáze. Co se z buňky stane územím
// (jméno, obyvatelé, kdo ho drží), je v okresy.js.
'use strict';

const h3 = require('h3-js');

// Velikost buňky. Čtyřka je kolem 1 500 km² — zhruba okres. Trojka by byl
// kraj, pětka město a okolí. Měnit se nedá za běhu: klíče území tu velikost
// nesou v sobě, takže by se všem rozpadlo, co drží.
const RAD = 4;

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

// Do které buňky bod patří. Tohle je celé „geokódování", které hra potřebuje.
function klicBodu(lat, lon) {
  // Number(null) je nula, ne nesmysl — město bez souřadnic by tím tiše
  // skončilo na rovníku a všechna taková města v jedné buňce. Prázdná
  // hodnota proto propadne dřív, než se z ní stane číslo.
  if (lat == null || lon == null || lat === '' || lon === '') return null;
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  // Na pólech síť existuje, ale hrát se tam nedá a extrémy jen kazí počty.
  if (la > 89.9 || la < -89.9) return null;
  try { return h3.latLngToCell(la, lo, RAD); } catch (e) { return null; }
}

// Je to klíč naší sítě? Staré klíče okresů („cz:sumperk") tím propadnou —
// podle toho se pozná, co se má ještě převést.
function jeKlic(key) {
  if (!key || typeof key !== 'string') return false;
  try { return h3.isValidCell(key) && h3.getResolution(key) === RAD; } catch (e) { return false; }
}

// Obrys buňky jako [[lat,lon], …]. Mapa z toho kreslí mnohoúhelník.
function obrys(key) {
  if (!jeKlic(key)) return null;
  try {
    const b = h3.cellToBoundary(key)
      .map((x) => [Number(x[0]), Number(x[1])])
      .filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]));
    return b.length >= 4 ? b : null;
  } catch (e) { return null; }
}

// Střed buňky. Tam sedí odznak území a kolem něj se měří vzdálenosti.
function stred(key) {
  if (!jeKlic(key)) return null;
  try {
    const s = h3.cellToLatLng(key);
    return { lat: Number(s[0]), lon: Number(s[1]) };
  } catch (e) { return null; }
}

// Sousední buňky. Šest jich je skoro vždycky — na dvanácti místech zeměkoule
// má síť pětiúhelník a sousedů je pět. Žádné dotazování, žádné čekání.
function sousedniKlice(key) {
  if (!jeKlic(key)) return [];
  try { return h3.gridDisk(key, 1).filter((k) => k !== key); } catch (e) { return []; }
}

// Plocha buňky v km². Jen pro přehled v administraci — pravidla hry se o ni
// neopírají, ty počítají s obyvateli.
function plocha(key) {
  if (!jeKlic(key)) return 0;
  try { return Math.round(h3.cellArea(key, 'km2')); } catch (e) { return 0; }
}

// Největší ze známých měst v buňce. Podle něj se území jmenuje.
function nejvetsi(mesta) {
  let nej = null;
  (mesta || []).forEach((m) => {
    if (!m) return;
    if (!nej || cislo(m.population) > cislo(nej.population)) nej = m;
  });
  return nej;
}

// Kolik lidí v buňce žije — součet známých měst. Jiný zdroj hra nemá a mít
// nemusí: licence se platí za trh, který ve hře existuje.
function soucetObyvatel(mesta) {
  const n = (mesta || []).reduce((a, m) => a + Math.max(0, cislo(m && m.population)), 0);
  return n > 0 ? Math.round(n) : null;
}

module.exports = { klicBodu, jeKlic, obrys, stred, sousedniKlice, plocha,
  nejvetsi, soucetObyvatel, RAD };
