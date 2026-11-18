// =============================================================================
// Laundromat Tycoon — pověst počítaná serverem
// =============================================================================
// Poslední vstup návštěvnosti, který server bral od klienta. Pověst násobí
// tržbu celé sítě v rozsahu 0,8 až 1,1 — kdo si ji nastaví na sto, přilepší
// si o třetinu proti tomu, kdo ji má na dně.
//
// Celou infolinku na server stěhovat nemusíme, a to je na tom to hezké:
// scénáře i váhy odpovědí tu server už dávno má (services/game/texty/
// linka.*.json). Stačí tedy, aby hra hlásila, CO hráč vybral — který scénář,
// který krok, kterou odpověď — a váhu si server najde sám. Vymyslet si ji
// nejde; vymyslet si jde nanejvýš to, že hovor proběhl.
//
// Proto je tu i mez: hovory chodí v určitém tempu, takže se za hodinu nedá
// stihnout víc než pár. Kdo hlásí víc, počítá se mu jen tolik, kolik se
// stihnout dalo — a zapíše se to.
//
// Tři druhy událostí, všechny se stejnými konstantami jako ve hře:
//   hovor      součet vah vybraných odpovědí
//   odmitnut   hovor, který hráč nevzal a nemá zaplacenou linku
//   zmeskano   hovory, které proběhly, když byl hráč pryč

'use strict';

const { prisma } = require('../../config/database');

// Musí sedět s game.js.
const POVEST_RUST = 0.5;           // kladná odpověď zvedá pomalu
const POVEST_PAD = 3;              // záporná sráží šestkrát rychleji
const HOVOR_ODMITNUTI = -2;        // co stojí nebraný hovor, než projde přes váhu
const OFF_POVEST_MAX = 6;          // strop ztráty za jednu nepřítomnost
const OFF_POVEST_DEN = 12;         // a za celý den
const POVEST_MIN = -100, POVEST_MAX = 100;
// Nejrychlejší možné tempo hovorů: pět minut mezi nimi. Víc než to hráč
// stihnout nemohl, ať má poboček kolik chce.
const HOVOR_MIN_ODSTUP = 300000;

function omez(p) {
  return Math.max(POVEST_MIN, Math.min(POVEST_MAX, Number(p) || 0));
}

// Co jedna odpověď udělá s pověstí. Kladná zvedá pomalu, záporná sráží
// rychle — špatná pověst se roznese dřív než dobrá.
function zaOdpoved(b) {
  const x = Number(b) || 0;
  return x > 0 ? x * POVEST_RUST : x * POVEST_PAD;
}

// Váha celého hovoru podle toho, co hráč vybral. Scénář i odpovědi se berou
// z katalogu serveru, z klienta jen indexy.
function vahaHovoru(scenar, volby) {
  if (!scenar || !Array.isArray(scenar.kroky)) return null;
  const v = Array.isArray(volby) ? volby : [];
  let soucet = 0;
  for (let i = 0; i < scenar.kroky.length; i++) {
    const krok = scenar.kroky[i];
    const o = krok && Array.isArray(krok.o) ? krok.o[v[i]] : null;
    // Nedohraný hovor pověst nemění — ve hře se mění až na konci.
    if (!o) return null;
    soucet += zaOdpoved(o.b);
  }
  return soucet;
}

// Dnešek jako klíč, stejně jako ve hře: podle toho se resetuje denní strop.
function denKlic(ted) {
  const d = new Date(ted == null ? Date.now() : ted);
  return d.toISOString().slice(0, 10);
}

// Kolik hovorů se vůbec mohlo stihnout od posledního započteného. Pět minut
// na hovor je ve hře nejrychlejší možné tempo, ať má hráč poboček kolik chce;
// kdo hlásí víc, dostane započteno jen tolik, kolik se do času vešlo.
// Prvnímu hlášení se nebrání — bez předchozího času není co měřit.
function kolikSeVeslo(odKdy, ted) {
  if (!odKdy) return Infinity;
  const od = new Date(odKdy).getTime();
  if (!isFinite(od)) return Infinity;
  return Math.max(0, Math.floor((ted - od) / HOVOR_MIN_ODSTUP));
}

// Jedna událost z infolinky. Vrací, co se má zapsat — nic nezapisuje samo,
// ať se to dá zkoušet bez databáze.
//
// `hrac` jsou sloupce povest*, `udalost` to, co hlásí hra, `scenar` scénář
// z katalogu serveru (u hovoru), `ted` čas.
function zmena(hrac, udalost, scenar, ted) {
  const kdy = ted == null ? Date.now() : ted;
  const u = udalost || {};
  const typ = String(u.typ || '');
  const stara = omez(hrac && hrac.povest != null ? hrac.povest : (u.vychozi || 0));
  const den = denKlic(kdy);
  // Denní strop ztráty za nepřítomnost se o půlnoci nuluje.
  const offDnes = (hrac && hrac.povest_den === den) ? (Number(hrac.povest_off) || 0) : 0;

  let delta = 0, duvod = typ, zahozeno = null;
  if (typ === 'hovor') {
    const v = vahaHovoru(scenar, u.volby);
    if (v == null) return { chyba: 'nedohraný nebo neznámý hovor' };
    const veslo = kolikSeVeslo(hrac && hrac.povest_at, kdy);
    if (veslo < 1) { zahozeno = 'hovor přišel dřív, než se mohl stihnout'; }
    else delta = v;
  } else if (typ === 'odmitnut') {
    const veslo = kolikSeVeslo(hrac && hrac.povest_at, kdy);
    if (veslo < 1) zahozeno = 'hovor přišel dřív, než se mohl stihnout';
    else delta = zaOdpoved(HOVOR_ODMITNUTI);
  } else if (typ === 'zmeskano') {
    // Za jednu nepřítomnost nejvýš šest bodů, za den dvanáct — a nikdy víc,
    // než kolik hovorů se za tu dobu vešlo.
    const kolik = Math.max(0, Math.floor(Number(u.kolik) || 0));
    const veslo = kolikSeVeslo(hrac && hrac.povest_at, kdy);
    const lze = Math.min(kolik, OFF_POVEST_MAX, Math.max(0, OFF_POVEST_DEN - offDnes),
      isFinite(veslo) ? veslo : kolik);
    if (lze < kolik) zahozeno = 'hlášeno ' + kolik + ', započteno ' + lze;
    delta = -lze;
    duvod = 'zmeskano';
    return { nova: omez(stara + delta), delta, duvod, zahozeno,
      povest_den: den, povest_off: offDnes + lze, povest_at: new Date(kdy) };
  } else {
    return { chyba: 'neznámý druh události' };
  }
  return { nova: omez(stara + delta), delta, duvod, zahozeno,
    povest_den: den, povest_off: offDnes, povest_at: new Date(kdy) };
}

module.exports = { omez, zaOdpoved, vahaHovoru, zmena, denKlic, kolikSeVeslo,
  POVEST_RUST, POVEST_PAD, HOVOR_ODMITNUTI, OFF_POVEST_MAX, OFF_POVEST_DEN,
  POVEST_MIN, POVEST_MAX, HOVOR_MIN_ODSTUP };
