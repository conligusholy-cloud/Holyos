// Vyrovnání podílů, když jeden z podílníků je fond aliance.
//
// Tohle je past, kterou provoz neohlásí. Peníze za podíl se posílají
// doručenkou na investor_id, jenže u fondového podílu je prázdné a sloupec
// player_id prázdný být nesmí. Vyrovnání celé firmy proto spadne na chybě
// databáze, úklid ji jen zapíše do logu a zkusí to zas — pořád dokola.
// Podíly zůstanou běžet, fondu se nevrátí nic a majitel té firmy si nemůže
// dát čistý štít.
const Module = require('module');
const puvodni = Module.prototype.require;

let EQUITY = [];
const POKLADNY = new Map();
let DORUCENKY = [];
const prazdne = { findMany: async () => [], findFirst: async () => null,
  findUnique: async () => null, update: async () => ({}),
  updateMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) };

function db() {
  const tx = {
    gameEquity: { update: async () => ({}) },
    gameAliance: { update: async (x) => {
      POKLADNY.set(x.where.id, (POKLADNY.get(x.where.id) || 0) + (x.data.pokladna.increment || 0));
      return {}; } },
    gameDelivery: { createMany: async (x) => {
      // Přesně tohle dělá i databáze: prázdné player_id neprojde.
      x.data.forEach(function (d) {
        if (d.player_id == null) throw new Error('player_id nesmí být prázdné');
      });
      DORUCENKY = DORUCENKY.concat(x.data); return { count: x.data.length }; } },
    gamePlayer: { update: async () => ({}) },
    gameAuction: { createMany: async () => ({ count: 0 }) },
    gameLoan: prazdne, gameTrade: prazdne, gameDrazba: prazdne,
  };
  return { prisma: Object.assign({}, prazdne, {
    gameEquity: { findMany: async (q) => {
      const w = (q && q.where) || {};
      if (w.firma_id != null) return EQUITY;
      return [];
    }, update: tx.gameEquity.update },
    gamePlayer: { findUnique: async (q) => ({ id: q.where.id, nick: 'Firma',
      state: { cash: 1000000, units: [] } }) },
    gameAliance: { findMany: async (q) => [{ id: 3, nazev: 'EX ALTO' }].filter(
      (a) => q.where.id.in.indexOf(a.id) >= 0) },
    gameFondVklad: { findMany: async () => [
      { aliance_id: 3, clen_id: 70 }, { aliance_id: 3, clen_id: 71 }] },
    gameLoan: prazdne, gameTrade: prazdne, gameDrazba: prazdne,
    gameDelivery: tx.gameDelivery,
    $transaction: async (fn) => fn(tx),
  }) };
}
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return db();
  return puvodni.apply(this, arguments);
};
const KONEC = require('../services/game/konec');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

(async () => {
  // Firma má milion a drží v ní podíl hráč (za 400 000) a fond (za 600 000).
  EQUITY = [
    { id: 1, investor_id: 50, fond_id: null, firma_id: 9, firma_nick: 'Firma',
      podil: 0.2, cena: 400000, vyplaceno: 0, stav: 'bezi' },
    { id: 2, investor_id: null, fond_id: 3, firma_id: 9, firma_nick: 'Firma',
      podil: 0.3, cena: 600000, vyplaceno: 0, stav: 'bezi' },
  ];
  DORUCENKY = []; POKLADNY.clear();

  let spadlo = null;
  const v = await KONEC.vyrovnejPodilyFirmy({ id: 9, nick: 'Firma',
    state: { cash: 1000000 } }, 'test').catch((e) => { spadlo = e; return null; });

  ok('vyrovnání firmy s fondovým podílníkem doběhne', !spadlo,
    spadlo ? '— ' + spadlo.message : '');
  ok('a uzavřelo oba podíly', !!v && v.podilu === 2, v ? '— ' + v.podilu : '');
  ok('fondu se připsalo do pokladny', POKLADNY.get(3) === 600000,
    '— ' + POKLADNY.get(3));
  ok('hráči přišla hotovostní doručenka',
    DORUCENKY.filter((d) => d.kind === 'cash' && d.player_id === 50).length === 1);
  // Fond zvonek nemá — kdyby mu přišla doručenka, nikdo by si ji nevyzvedl.
  ok('fondu žádná hotovostní doručenka nechodí',
    DORUCENKY.filter((d) => d.kind === 'cash' && d.amount === 600000).length === 0);
  ok('ale členové fondu se to dozvěděli',
    [70, 71].every((id) => DORUCENKY.some((d) => d.player_id === id)),
    '— ' + JSON.stringify(DORUCENKY.filter((d) => d.player_id === 70 || d.player_id === 71)
      .map((d) => d.text_kod)));
  ok('vrácené peníze sedí na hotovost firmy', !!v && v.vraceno === 1000000,
    v ? '— ' + v.vraceno : '');

  // Fond, který mezitím zanikl, nesmí vyrovnání shodit.
  EQUITY = [{ id: 3, investor_id: null, fond_id: 999, firma_id: 9, firma_nick: 'Firma',
    podil: 0.5, cena: 500000, vyplaceno: 0, stav: 'bezi' }];
  DORUCENKY = []; POKLADNY.clear();
  spadlo = null;
  const v2 = await KONEC.vyrovnejPodilyFirmy({ id: 9, nick: 'Firma',
    state: { cash: 500000 } }, 'test').catch((e) => { spadlo = e; return null; });
  ok('podíl zaniklého fondu vyrovnání neshodí', !spadlo && !!v2,
    spadlo ? '— ' + spadlo.message : '');
  ok('a nikomu se nic nepřipsalo', POKLADNY.size === 0 && !DORUCENKY.some((d) => d.kind === 'cash'));
  // Kdyby se firmě stržila hotovost za podíl, který nemá komu dojít,
  // ty peníze by zmizely ze světa.
  ok('a firmě se za něj nestrhla hotovost', !!v2 && v2.vraceno === 0,
    v2 ? '— ' + v2.vraceno : '');

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
