// Návrat do fondu po vlastní akci.
//
// Panel fondu se otevírá jako překryv. closeSheet() schválně zahazuje cíl
// návratu (FOND_KAM): když hráč zavře okno sám, má se vrátit na záložku, kde
// byl. Jenže po hlasování, novém návrhu nebo vkladu se okno zavírá SAMO a
// hráč chce zůstat ve fondu — tam, kde klikl. Dokud se to nerozlišovalo,
// vyhodilo ho to z fondu na mapu.
//
// Testuje se SKUTEČNÝ kód vytažený z game.js, ne jeho opis.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const kusy = [
  (hra.match(/function closeSheet\(\)[^\n]*\n/) || [''])[0],
  (hra.match(/function fondZnovu\(\)[^\n]*\n/) || [''])[0],
  (hra.match(/function fondZavriAZnovu\(pak\) \{[\s\S]*?\n\}/) || [''])[0],
];
ok('v game.js se našlo: fondZavriAZnovu', !!kusy[2]);
if (!kusy[2]) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }

const box = { FOND: {}, FOND_KAM: null, kam: [],
  $: () => ({ classList: { add: () => {}, remove: () => {} } }),
  loadFond: function (f) { box.kam.push(f === box.paintMe ? 'zalozka' : 'fond'); },
  paintMe: function () {} };
box.fondSheetPaint = function () {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);

// ─── Ruční zavření ───────────────────────────────────────────────────────────
// Zavřu okno sám → příští překreslení patří záložce, ne fondu.
box.FOND_KAM = box.fondSheetPaint; box.kam = [];
box.closeSheet();
ok('ruční zavření zahodí cíl návratu', box.FOND_KAM === null);
box.fondZnovu();
ok('a překreslí se záložka', box.kam.join() === 'zalozka');

// ─── Zavření po vlastní akci ─────────────────────────────────────────────────
// Tohle je ten případ, kvůli kterému to vzniklo.
box.FOND_KAM = box.fondSheetPaint; box.kam = [];
box.fondZavriAZnovu();
ok('po hlasování se cíl návratu zachová', box.FOND_KAM === box.fondSheetPaint);
ok('a překreslí se fond, ne záložka', box.kam.join() === 'fond');

// Z panelu na záložce (ne z překryvu) se nikam vracet nemá — tam cíl není.
box.FOND_KAM = null; box.kam = [];
box.fondZavriAZnovu();
ok('ze záložky to zůstane na záložce',
  box.FOND_KAM === null && box.kam.join() === 'zalozka');

// Varianta s vlastním pokračováním: cíl se musí vrátit DŘÍV, než pokračování
// doběhne — jinak by si doručenky překreslily záložku.
box.FOND_KAM = box.fondSheetPaint; box.kam = [];
let kamVPokracovani = 'nenastaveno';
box.fondZavriAZnovu(function () { kamVPokracovani = box.FOND_KAM; });
ok('pokračování vidí cíl návratu už vrácený',
  kamVPokracovani === box.fondSheetPaint);
ok('a samo si překreslení řídí', box.kam.length === 0);

// ─── Zapojení ────────────────────────────────────────────────────────────────
// Po akci ve fondu se nesmí volat holé closeSheet(); fondZnovu().
ok('nikde nezbylo holé zavření s překreslením fondu',
  hra.indexOf('closeSheet(); fondZnovu();') < 0);
const pocet = (hra.match(/fondZavriAZnovu\(/g) || []).length;
ok('a používá se na všech místech, kde se zavíralo', pocet >= 5, pocet + ' volání');

// ─── Posun v okně ────────────────────────────────────────────────────────────
// Panel fondu je dlouhý; překreslení ho vracelo na začátek a hráč hledal,
// kde to byl.
const paint = hra.slice(hra.indexOf('function fondSheetPaint()'));
const usek = paint.slice(0, paint.indexOf('function fondSheet()'));
ok('posun se před překreslením schová', /var kde = telo \? telo\.scrollTop : 0;/.test(usek));
ok('a po vykreslení vrátí', /scrollTop = kde;/.test(usek));
ok('vrací se až za bindAliance — dřív nemá obsah výšku',
  usek.indexOf('bindAliance') < usek.indexOf('scrollTop = kde'));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
