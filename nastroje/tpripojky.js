// Přípojky: server proti skutečnému kódu hry.
//
// Přípojky se platí při každé stavbě a jsou největší výdaj, o kterém server
// dosud nevěděl — bez nich vycházela čekaná změna hotovosti soustavně výš,
// než jak to doopravdy chodí. Server si je proto počítá sám z otisku místa.
//
// „Sám" ale znamená „stejně jako hra", jinak by z toho byl jiný výdaj, ne
// menší díra. Proto se tu neporovnává s mým výpočtem, ale se SKUTEČNOU
// funkcí connPrice vytaženou z game.js a spuštěnou s podstrčeným okolím.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../services/game/pozemky');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

const hra = fs.readFileSync(path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
// Vytáhneme samotnou funkci i konstanty, se kterými počítá. Kdyby se
// v game.js přejmenovaly, test spadne tady — a to je správně.
function vytahni(re, co) {
  const m = hra.match(re);
  if (!m) { ok('v game.js se našlo: ' + co, false); return null; }
  return m[0];
}
const kusy = [
  vytahni(/var CONN_MIN = [\s\S]*?\n/, 'CONN_MIN a CONN_MAX'),
  vytahni(/var CONN_MAX_MULT = [^\n]*\n/, 'CONN_MAX_MULT'),
  vytahni(/var CETA_PODIL = [^\n]*\n/, 'CETA_PODIL'),
  vytahni(/var INSTALACE_PODIL = [^\n]*\n/, 'INSTALACE_PODIL'),
  vytahni(/var POZEMEK_STAVBA = [^\n]*\n/, 'POZEMEK_STAVBA'),
  vytahni(/function connPrice\(sp, modelKey\) \{[\s\S]*?\n\}/, 'connPrice'),
];
if (kusy.some((x) => !x)) { console.log('\n' + chyb + ' chyb'); process.exit(1); }

// Okolí, které connPrice potřebuje. Nastaveno tak, jak vypadá běžná stavba:
// žádný pronájem připravené plochy, žádný plán, žádná četa, žádná karta.
const sandbox = {
  S: { leases: {}, connDiscount: 0 },
  planMista: () => null,
  jePozemek: (sp) => !!sp.pozemek,
  mamPozemek: () => false,
  jeZasitovane: (sp) => !!sp.zasitovane,
  cetaZvladne: () => false,
  spotHash: P.spotHash,
  Math,
};
vm.createContext(sandbox);
vm.runInContext(kusy.join('\n'), sandbox);

// ── Mřížka: místa × modely × druh místa ──────────────────────────────────────
const mista = ['kolin-4', 'praha-0', 'olomouc-3', 'breclav-10', 'salzburg-5',
  'usti-nad-labem-2', 'jihlava-6', 'louny-8', 'miura-shi-12', 'dvur-kralove-nad-labem-0'];
let kolik = 0, sedi = 0; const rozdily = [];
mista.forEach((id) => {
  ['mini', 'flex', 'max'].forEach((model) => {
    [{}, { pozemek: true }, { zasitovane: true }].forEach((druh) => {
      const sp = Object.assign({ id }, druh);
      const zHry = sandbox.connPrice(sp, model);
      const zeServeru = P.pripojky(id, model, druh);
      kolik++;
      if (zHry === zeServeru) sedi++;
      else if (rozdily.length < 6) {
        rozdily.push(id + ' · ' + model + ' · ' + (JSON.stringify(druh) || '{}')
          + ' · hra ' + zHry + ' / server ' + zeServeru);
      }
    });
  });
});
ok('server počítá přípojky stejně jako hra', sedi === kolik,
  sedi + ' z ' + kolik + ' kombinací');
rozdily.forEach((r) => console.log('      ' + r));

// ── Co z toho plyne ──────────────────────────────────────────────────────────
ok('MAX má přípojky dražší než MINI',
  P.pripojky('kolin-4', 'max', {}) > P.pripojky('kolin-4', 'mini', {}));
ok('na zasíťovaném místě se platí zlomek',
  P.pripojky('kolin-4', 'flex', { zasitovane: true }) < P.pripojky('kolin-4', 'flex', {}) / 5);
ok('příprava zelené louky je dražší než běžné přípojky',
  P.pripojky('kolin-4', 'flex', { pozemek: true }) > P.pripojky('kolin-4', 'flex', {}));
ok('stejné místo dává vždy stejnou cenu',
  P.pripojky('kolin-4', 'flex', {}) === P.pripojky('kolin-4', 'flex', {}));
ok('různá místa se liší',
  new Set(mista.map((id) => P.pripojky(id, 'flex', {}))).size > 3);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
