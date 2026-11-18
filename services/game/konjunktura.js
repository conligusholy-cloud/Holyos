// =============================================================================
// Laundromat Tycoon — konjunktura a krize, počítané serverem
// =============================================================================
// Třetí etapa firemní pokladny. Návštěvnost se skládá z několika vlivů a
// tenhle je ze všech nejlíp přenositelný na server: krize ani sezóna totiž
// nepatří hráči. Jsou to funkce herního času, stejné pro všechny ve stejnou
// chvíli — proto se nikde neukládají a každý si je spočítá sám.
//
// Tím pádem je může počítat i server, a to úplně stejně jako prohlížeč.
// Je to přesně ta část, u které nemá smysl se klienta na nic ptát.
//
// Jak to funguje:
//
//   Jednou za herní rok se losuje, jestli začne krize. Nelosuje se náhodně:
//   z čísla bloku se spočítá deterministický šum, takže všem vyjde totéž.
//   Krize má svůj začátek, délku a dno a může přesáhnout do dalších bloků,
//   proto se hledá i o tři bloky zpátky.
//
//   Propad nenastoupí ze dne na den — nabíhá, drží se u dna a zase povoluje,
//   a uvnitř kolísá, takže se nedá odhadnout, kdy je nejhůř.
//
//   I v dobrých časech to dýchá (KONJ_VLNA) a přes rok se vlní sezóna:
//   po Vánocích je slabo, v létě se perou ručníky.
//
// Konstanty i vzorce MUSÍ sedět s game.js. Test je porovnává proti
// skutečnému kódu hry na stovkách okamžiků, ne proti mému vlastnímu
// výpočtu — u čísla, kterým se násobí tržba celé hry, je to jediná
// poctivá kontrola.

'use strict';

const MONTH_MS = 43200000;         // herní měsíc = 12 skutečných hodin
const YEAR_MS = 12 * MONTH_MS;     // herní rok = 6 skutečných dní

const KRIZE_BLOK = 1;
const KRIZE_SANCE = 0.28;
const KRIZE_DELKA_MIN = 0.5;
const KRIZE_DELKA_MAX = 2;
const KRIZE_DNO_MIN = 0.15;
const KRIZE_DNO_MAX = 0.4;
const KONJ_VLNA = 0.05;

const SEZONA = [0.86, 0.88, 0.94, 0.99, 1.02, 1.08, 1.13, 1.12, 1.07, 0.96, 1.03, 1.08];
const SEZONA_PRUMER = SEZONA.reduce((a, b) => a + b, 0) / SEZONA.length;

// Deterministický šum: ze stejného čísla vyleze vždycky stejné „náhodné"
// číslo. Musí sedět bit po bitu s prohlížečem, proto Math.imul a posuny
// bez znaménka — obyčejné násobení by přeteklo jinak.
function krizeSum(blok, sul) {
  let x = Math.imul(blok ^ (sul * 0x9e3779b9), 2654435761);
  x ^= x >>> 15; x = Math.imul(x, 2246822519);
  x ^= x >>> 13; x = Math.imul(x, 3266489917);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function krizeBloku(i) {
  if (krizeSum(i, 1) >= KRIZE_SANCE) return null;
  const blokMs = KRIZE_BLOK * YEAR_MS;
  const od = i * blokMs + krizeSum(i, 2) * blokMs;
  const delka = (KRIZE_DELKA_MIN + krizeSum(i, 3) * (KRIZE_DELKA_MAX - KRIZE_DELKA_MIN)) * YEAR_MS;
  const dno = KRIZE_DNO_MIN + krizeSum(i, 4) * (KRIZE_DNO_MAX - KRIZE_DNO_MIN);
  return { od, do: od + delka, delka, dno };
}

function hernoMesic(t) { return ((Math.floor(t / MONTH_MS) % 12) + 12) % 12; }
function sezonaV(t) { return SEZONA[hernoMesic(t)] / SEZONA_PRUMER; }

// Koeficient, kterým se násobí návštěvnost v daném okamžiku.
function ekonomikaV(t) {
  const blokMs = KRIZE_BLOK * YEAR_MS;
  const i = Math.floor(t / blokMs);
  let nejhorsi = null;
  for (let k = i - 3; k <= i; k++) {
    const kr = krizeBloku(k);
    if (!kr || t < kr.od || t >= kr.do) continue;
    if (!nejhorsi || kr.dno > nejhorsi.dno) nejhorsi = kr;
  }
  const dech = 1 + KONJ_VLNA * Math.sin(t / (0.37 * YEAR_MS));
  const sez = sezonaV(t), mes = hernoMesic(t);
  if (!nejhorsi) {
    return { koef: dech * sez, krize: false, hloubka: 0, sezona: sez, mesic: mes };
  }
  const u = (t - nejhorsi.od) / nejhorsi.delka;
  const tvar = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.6);
  const vlna = 1 + 0.22 * Math.sin(t / (0.11 * YEAR_MS) + nejhorsi.od);
  const pokles = Math.max(0, Math.min(0.45, nejhorsi.dno * tvar * vlna));
  return { koef: Math.max(0.3, dech - pokles) * sez, krize: pokles > 0.03, hloubka: pokles,
    sezona: sez, mesic: mes };
}

function koef(t) { return ekonomikaV(t == null ? Date.now() : t).koef; }

module.exports = { ekonomikaV, koef, krizeBloku, krizeSum, sezonaV, hernoMesic,
  MONTH_MS, YEAR_MS, SEZONA, SEZONA_PRUMER, KONJ_VLNA,
  KRIZE_BLOK, KRIZE_SANCE, KRIZE_DELKA_MIN, KRIZE_DELKA_MAX, KRIZE_DNO_MIN, KRIZE_DNO_MAX };
