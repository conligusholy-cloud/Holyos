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

// ── Pozná se jen NOVÁ porucha ────────────────────────────────────────────────
let r = S.vypadky({ units: [stroj('a', null)] }, { units: [stroj('a', MESIC)] }, TRZBY, TED);
ok('nově naskočená porucha se započítá', r.kusu === 1 && r.celkem > 0, '— ' + r.celkem);

r = S.vypadky({ units: [stroj('a', MESIC)] }, { units: [stroj('a', MESIC)] }, TRZBY, TED);
ok('porucha, která běžela už minule, se nepočítá podruhé',
  r.celkem === 0, '— ' + r.celkem);

r = S.vypadky({ units: [stroj('a', null)] }, { units: [stroj('a', null)] }, TRZBY, TED);
ok('stroj bez poruchy nic nepřidá', r.celkem === 0);

// Server počítá ze SVÉ tržby — stroj, o kterém neví, mu ztrátu nevyrobí.
r = S.vypadky({ units: [] }, { units: [{ spotId: 'neznamy', porucha: { od: TED - MESIC } }] },
  TRZBY, TED);
ok('místo, které server nezná, ztrátu nevyrobí', r.celkem === 0, '— ' + r.celkem);

// Dvě poruchy najednou se sečtou.
r = S.vypadky({ units: [stroj('a', null), stroj('b', null)] },
  { units: [stroj('a', MESIC), stroj('b', MESIC)] }, TRZBY, TED);
ok('dvě nové poruchy se sečtou',
  r.kusu === 2 && r.celkem === S.vypadekStroje(300000, 'mini', MESIC)
    + S.vypadekStroje(300000, 'max', MESIC), '— ' + r.celkem);

ok('prázdný stav nic neshodí', S.vypadky(null, null, null, TED).celkem === 0);
ok('chybějící tržby nic neshodí',
  S.vypadky({ units: [] }, { units: [stroj('a', MESIC)] }, null, TED).celkem === 0);

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
