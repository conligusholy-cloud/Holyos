// =============================================================================
// HolyOS — Laundromat Tycoon: test výkonu mapy
// =============================================================================
// Hráč s třemi sty stroji hlásil, že se hra seká při hledání a stavění.
// Mapa se překresluje po každé stavbě i po každém průzkumu a dělala přitom
// dvě zbytečné práce: pro KAŽDÉ místo hledala stroj průchodem celého pole
// strojů (dva tisíce míst × tři sta strojů = statisíce kroků) a stavěla HTML
// ikonu i pro špendlíky, které se pak schovaly do shluku a nenakreslily.
//
// Test pouští opravdový drawMap nad velkou sítí a počítá, kolikrát sáhne
// na pole strojů a kolik ikon postaví.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  let h = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') h++;
    else if (zdroj[j] === '}') { h--; if (!h) return zdroj.slice(i, j + 1); }
  }
  throw new Error('konec se nenašel');
}

const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');

// ─── Velká síť: 2 000 míst, 300 strojů ──────────────────────────────────────
const MEST = 100, MIST = 20, STROJU = 300;
const areas = {}, units = [];
for (let a = 0; a < MEST; a++) {
  const spots = [];
  for (let i = 0; i < MIST; i++) {
    spots.push({ id: 'm' + a + '-' + i, lat: 50 + a * 0.01, lon: 15 + i * 0.01, score: 60 });
  }
  areas['mesto' + a] = { name: 'Město ' + a, spots: spots };
}
for (let u = 0; u < STROJU; u++) {
  units.push({ spotId: 'm' + u + '-0', lat: 50, lon: 15, areaId: 'mesto' + u,
    eco: { model: 'flex', profit: 1000 }, score: 60 });
}

// Pole strojů si počítá sáhnutí: filter přes celé pole je to drahé.
let scanu = 0, pruchodu = 0;
const sledovanePole = units.slice();
sledovanePole.filter = function (f) { scanu++; return Array.prototype.filter.call(this, f); };
sledovanePole.forEach = function (f) { pruchodu++; return Array.prototype.forEach.call(this, f); };
sledovanePole.some = function (f) { scanu++; return Array.prototype.some.call(this, f); };

let ikon = 0, markeru = 0, kruhu = 0;
const kruh = () => { kruhu++; return { addTo: () => ({ bindTooltip: () => ({ on: () => {} }) }) }; };
const ctx = {
  layer: { clearLayers: () => {} },
  map: { getZoom: () => 9, latLngToContainerPoint: (ll) => ({ x: ll[1] * 100, y: ll[0] * 100 }) },
  L: { marker: () => { markeru++; return { addTo: () => ({ on: () => {} }) }; }, circle: kruh },
  S: { areas: areas, units: sledovanePole, revealed: {}, pozemky: [], pobocky: [], sidlo: null,
    startedAt: Date.now() },
  CLAIMS: {},
  MAPA_MOJE: false, MISTA_OD_ZOOMU: 13, SHLUK_OD_ZOOMU: 14, SHLUK_PX: 44, MONTH_MS: 2592000000,
  trhPodleMist: () => ({}),
  pozemky: () => [],
  jePozemek: () => false,
  unitIcon: () => { ikon++; return {}; },
  trhIcon: () => { ikon++; return {}; },
  ciziPozemekIcon: () => { ikon++; return {}; },
  rivalIcon: () => { ikon++; return {}; },
  pozemekIcon: () => { ikon++; return {}; },
  pozemekSkoreIcon: () => { ikon++; return {}; },
  skoreIcon: () => { ikon++; return {}; },
  pinIcon: () => { ikon++; return {}; },
  shlukIcon: () => { ikon++; return {}; },
  domIcon: () => { ikon++; return {}; },
  spotSheet: () => {}, rivalSheet: () => {}, trhKoupitSheet: () => {}, cizi: () => {},
  unitSheet: () => {}, zakladnaSheet: () => {},
  paintServis: () => {}, paintTrhBadge: () => {},
  esc: (x) => String(x), tx: () => '', $: () => ({ textContent: '', classList: { add: () => {}, remove: () => {} } }),
  // Vrstva území (Unie). Výchozí stav je vypnutá — tak ji má drtivá většina
  // hráčů a právě ten průchod se měří.
  UZEMI_VRSTVA: false, UZEMI_MAPA: null, UZEMI_R: 7000,
  uzemiNaMapeSheet: () => {}, sheet: () => {},
  Object, Math, String, Date, console,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(telo(zdroj, 'shlukuj') + '\n' + telo(zdroj, 'vykresliShluky') + '\n'
  + telo(zdroj, 'kresliUzemi') + '\n' + telo(zdroj, 'drawMap'), ctx);

console.log('\nPřekreslení mapy u sítě o ' + (MEST * MIST) + ' místech a ' + STROJU + ' strojích');
const start = Date.now();
ctx.drawMap();
const trvalo = Date.now() - start;

ma(scanu === 0, 'stroj se pro každé místo nehledá průchodem celého pole', scanu + '× scan');
ma(pruchodu <= 3, 'polem strojů se projde jen několikrát', pruchodu + '× průchod');
ma(markeru > 0, 'něco se nakreslilo', markeru + ' markerů');
ma(ikon <= markeru, 'ikona se staví jen pro to, co se opravdu kreslí',
  ikon + ' ikon / ' + markeru + ' markerů');
// Shluk schová většinu špendlíků — tolik ikon, kolik je míst, by znamenalo,
// že se staví i pro schované.
ma(ikon < MEST * MIST / 2, 'schované špendlíky ikonu nedostanou', ikon + ' < ' + (MEST * MIST / 2));
console.log('  (překreslení trvalo ' + trvalo + ' ms)');

ma(kruhu === 0, 'vypnutá vrstva území nekreslí nic', kruhu + ' kruhů');

// Vrstva území musí stát jeden kruh na území, ne na místo — jinak by se u
// stovky měst kreslilo dva tisíce tvarů a mapa by se sekla stejně jako dřív.
console.log('\nTáž mapa se zapnutou vrstvou území');
ctx.UZEMI_VRSTVA = true;
ctx.UZEMI_MAPA = [
  { area_key: 'mesto0', nazev: 'Město 0', lat: 50, lon: 15, master_nick: 'ja', moje: true, poplatek_pct: 100 },
  { area_key: 'mesto1', nazev: 'Město 1', lat: 50.1, lon: 15.1, master_nick: 'kdosi', moje: false, poplatek_pct: 120 },
];
kruhu = 0; markeru = 0; ikon = 0;
const start2 = Date.now();
ctx.drawMap();
const trvalo2 = Date.now() - start2;
ma(kruhu === 2, 'jeden kruh na území, ne na místo', kruhu + ' kruhů na ' + (MEST * MIST) + ' míst');
ma(trvalo2 < trvalo + 60, 'vrstva území překreslení znatelně neprodraží',
  trvalo2 + ' ms proti ' + trvalo + ' ms');
ctx.UZEMI_VRSTVA = false; ctx.UZEMI_MAPA = null;

console.log('\nV kódu po sobě nesmí zůstat ani jedno hledání v poli');
const vnitrek = telo(zdroj, 'drawMap');
ma(!/S\.units\.filter/.test(vnitrek), 'drawMap nehledá stroje filtrem');
ma(/var strojNaMiste = \{\}/.test(vnitrek), 'místo toho si je srovná podle místa');
ma(!/mamPozemek\(sp\.id\)/.test(vnitrek), 'a stejně tak koupené pozemky');
ma(/icon: dejIkonu\(\)/.test(vnitrek), 'ikona se staví až při kreslení');

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
