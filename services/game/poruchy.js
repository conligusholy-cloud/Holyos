// =============================================================================
// Laundromat Tycoon — kdy se stroj porouchá
// =============================================================================
// Porucha byla do 19. 11. los v prohlížeči: Math.random při každém návratu do
// hry. Server o ní věděl jen to, co mu klient napsal, takže kdo si hru upravil,
// mohl mít poruch kolik chtěl — nebo žádnou. Bylo to poslední místo, kde se
// serveru nedalo věřit vlastnímu výpočtu.
//
// Nově je porucha vlastností MÍSTA A ČASU, ne losu. Herní měsíc je okno a pro
// každé okno se z otisku místa spočítá, jestli se v něm stroj porouchal, kdy
// přesně a jaká to byla závada. Obě strany tím dostanou nutně stejný výsledek
// a server si ho umí spočítat sám, bez jediného čísla od klienta.
//
// Je to stejný princip, na kterém stojí přípojky: otisk místa místo náhody.
//
// Co se tím mění pro hráče: porucha už nezávisí na tom, kdy hru načte. Dřív
// mohl dvěma načteními dostat dvě různé poruchy, teď dostane tu samou —
// a právě proto si ji nemůže odkliknout pryč.
//
// Musí sedět s hlidejPoruchy v public/compounder/game/game.js.
'use strict';

const MESIC_MS = 43200000;          // herní měsíc = 12 skutečných hodin
const PORUCHA_ROCNE = 4;            // kolikrát za herní rok se stroj průměrně porouchá
const SANCE_V_OKNE = PORUCHA_ROCNE / 12;

// Otisk místa — tentýž, jaký používají přípojky. Žádný druhý hash.
const otisk = (klic, salt) => require('./pozemky').spotHash(klic, salt);

// Porouchal se tenhle stroj v tomhle okně? Vrací popis, nebo null.
function vOkne(spotId, okno) {
  const klic = String(spotId) + ':' + okno;
  if (otisk(klic, 'porucha') >= SANCE_V_OKNE) return null;
  return {
    okno,
    // Okamžik uvnitř okna. Nezaokrouhluje se na minuty: hra i server musí
    // dostat tutéž milisekundu, jinak by se ztráta lišila o drobné.
    od: okno * MESIC_MS + Math.floor(otisk(klic, 'kdy') * MESIC_MS),
    // 0 až 1 — kdo závadu zobrazuje, si z toho vybere řádek ve své tabulce.
    zavada: otisk(klic, 'zavada'),
  };
}

// Poruchy, které na tom místě nastaly v intervalu <od, do>. Oken je málo:
// i týden nepřítomnosti je jen čtrnáct herních měsíců.
function vIntervalu(spotId, od, do_) {
  const a = Math.max(0, Number(od) || 0);
  const b = Math.max(a, Number(do_) || 0);
  const out = [];
  for (let w = Math.floor(a / MESIC_MS); w <= Math.floor(b / MESIC_MS); w++) {
    const p = vOkne(spotId, w);
    if (p && p.od >= a && p.od <= b) out.push(p);
  }
  return out;
}

// Poslední porucha v intervalu — to je ta, kterou hráč po návratu uvidí.
function posledni(spotId, od, do_) {
  const l = vIntervalu(spotId, od, do_);
  return l.length ? l[l.length - 1] : null;
}

module.exports = { vOkne, vIntervalu, posledni, MESIC_MS, PORUCHA_ROCNE, SANCE_V_OKNE };
