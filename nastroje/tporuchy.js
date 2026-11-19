// Výpadek za poruchu — největší zbývající položka, o které server nevěděl.
//
// Když se stroj porouchá, hra k tomu připíše jednorázovou ztrátu ZPĚTNĚ:
// porucha se stala někdy během doby, co hráč nebyl ve hře, a od té chvíle
// stroj nevydělával. Zpětně to jde až o půl herního roku, takže jedna
// porucha u velkého stroje umaže klidně milion. Server čekal pořád plný
// výdělek — u malé sítě se to ztratí, u velké to v pokladně dělalo miliony.
//
// Od klienta se bere jedině to, CO SE STALO: který stroj a od kdy. Částku si
// server počítá sám, ze své vlastní tržby toho stroje.
const Module = require('module');
const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameSpotClaim: { findMany: async () => [] },
      gameDelivery: { findMany: async () => [] },
      gameOrder: { findMany: async () => [] },
    } };
  }
  return puvodni.apply(this, arguments);
};
const S = require('../services/game/strop');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const MESIC = S.MESIC_MS;
const TED = Date.now();
// Tržby, jak si je spočítal SERVER. Od hry se nebere žádná částka.
const TRZBY = new Map([
  ['a', { plne: 300000, model: 'mini' }],
  ['b', { plne: 300000, model: 'max' }],
]);
const stroj = (id, odPred) => ({ spotId: id, eco: { model: TRZBY.get(id).model },
  porucha: odPred == null ? null : { od: TED - odPred } });

// ── Výpočet jedné poruchy ────────────────────────────────────────────────────
// MINI při poruše nejede vůbec (chod 0): měsíc stání = tržba bez energie.
ok('mini stojící měsíc přijde o tržbu bez energie',
  S.vypadekStroje(300000, 'mini', MESIC) === Math.round(300000 * 0.91),
  '— ' + S.vypadekStroje(300000, 'mini', MESIC));
// MAX při poruše jede na půl (chod 0,5): ztráta je poloviční.
ok('max jede na půl, takže ztrácí půlku',
  S.vypadekStroje(300000, 'max', MESIC) === Math.round(300000 * 0.91 * 0.5),
  '— ' + S.vypadekStroje(300000, 'max', MESIC));
ok('poloviční doba je poloviční ztráta',
  S.vypadekStroje(300000, 'mini', MESIC / 2) * 2 === S.vypadekStroje(300000, 'mini', MESIC));
// Tohle je ta mez, kvůli které jedna porucha nemůže umazat celou historii.
ok('zpětně se počítá nejvýš půl herního roku',
  S.vypadekStroje(300000, 'mini', 50 * MESIC) === S.vypadekStroje(300000, 'mini', 6 * MESIC),
  '— ' + S.vypadekStroje(300000, 'mini', 50 * MESIC));
ok('nulová doba je nulová ztráta', S.vypadekStroje(300000, 'mini', 0) === 0);
ok('záporná doba ztrátu nevyrobí', S.vypadekStroje(300000, 'mini', -MESIC) === 0);
ok('neznámý model se bere jako stojící', S.vypadekStroje(300000, 'xxx', MESIC) > 0);

// ── Server si poruchu počítá sám, ne z toho, co hlásí klient ────────────────
// Tohle je ta změna z 19. 11.: do výpadku už nevstupuje u.porucha.od od
// prohlížeče. Server se zeptá vlastního modulu, které místo se kdy
// porouchalo, a ocení to svou tržbou.
const POR = require('../services/game/poruchy');
const MES = POR.MESIC_MS;
// Najdeme okno, ve kterém se 'a' opravdu porouchalo — ať test nestojí
// na tom, že zrovna tohle číslo vyjde.
let oknoS = null;
for (let w = 900; w < 960 && oknoS == null; w++) if (POR.vOkne('a', w)) oknoS = w;
ok('nějaké okno s poruchou se našlo', oknoS != null, '— ' + oknoS);
const p0 = POR.vOkne('a', oknoS);
const doKdy = p0.od + MES / 2;

let r = S.vypadky({ units: [] }, { units: [] }, TRZBY, doKdy, p0.od - 1);
ok('porucha v okně se započítá i bez hlášení od klienta',
  r.kusu === 1 && r.celkem > 0, '— ' + JSON.stringify(r));
ok('a sedí na vlastní tržbě serveru',
  r.celkem === S.vypadekStroje(300000, 'mini', doKdy - p0.od), '— ' + r.celkem);

// Kdo byl porouchaný už minule, se nepočítá znovu — zrcadlí to hlidejPoruchy.
r = S.vypadky({ units: [{ spotId: 'a', porucha: { od: 1 } }] }, { units: [] },
  TRZBY, doKdy, p0.od - 1);
ok('už porouchaný stroj se nepočítá podruhé', r.celkem === 0, '— ' + r.celkem);

// Okno, ve kterém se nic nestalo.
let oknoBez = null;
for (let w = 900; w < 960 && oknoBez == null; w++) if (!POR.vOkne('a', w)) oknoBez = w;
r = S.vypadky({ units: [] }, { units: [] }, TRZBY,
  oknoBez * MES + MES - 1, oknoBez * MES);
ok('v okně bez poruchy se nezapočítá nic', r.celkem === 0, '— ' + r.celkem);

// Místo, které server nezná, ztrátu nevyrobí — počítá se jen z vlastní evidence.
r = S.vypadky({ units: [] }, { units: [] }, new Map(), doKdy, p0.od - 1);
ok('bez vlastních tržeb se nepočítá nic', r.celkem === 0);
ok('obrácené okno nic nevyrobí', S.vypadky({ units: [] }, { units: [] }, TRZBY, 100, 200).celkem === 0);
ok('prázdné vstupy nic neshodí', S.vypadky(null, null, null, doKdy, 0).celkem === 0);

// ── Proti skutečnému kódu hry ────────────────────────────────────────────────
// Konstanty musí sedět. Kdyby se ve hře změnily a tady ne, server by poruchy
// počítal jinak než hra a v pokladně by z toho byl nevysvětlený rozdíl.
const fs = require('fs');
const path = require('path');
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
function cislo(re, co) {
  const m = hra.match(re);
  if (!m) { ok('v game.js se našlo: ' + co, false); return null; }
  return m[1];
}
ok('ENERGY_SHARE sedí s hrou', cislo(/var ENERGY_SHARE = ([\d.]+)/, 'ENERGY_SHARE') === '0.09');
ok('PORUCHA_CHOD sedí s hrou',
  (hra.match(/var PORUCHA_CHOD = (\{[^}]*\})/) || [])[1] === '{ mini: 0, flex: 0.5, max: 0.5 }');
ok('PORUCHA_ZPETNE_MAX sedí s hrou',
  cislo(/var PORUCHA_ZPETNE_MAX = (\d+) \* MONTH_MS/, 'PORUCHA_ZPETNE_MAX') === '6');

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
