// Výplata podílu, který drží fond aliance.
//
// Fond nemá doručenky — peníze mu chodí rovnou do pokladny, odkud si je
// členové rozdělují. Tohle je to místo, kde se dá nejsnáz ztratit cizí
// peníze: kdyby se fondu poslala doručenka, nikdo by si ji nevyzvedl,
// a kdyby se mu nepřipsalo nic, výplata by zmizela úplně.
const Module = require('module');
const puvodni = Module.prototype.require;

let EQUITY = [];
const POKLADNY = new Map();
const DORUCENKY = [];
const ZMENY = [];
const prazdne = { findMany: async () => [], findFirst: async () => null,
  findUnique: async () => null, update: async () => ({}), updateMany: async () => ({ count: 0 }) };
function db() {
  const tx = {
    gameAliance: { update: async (x) => {
      const id = x.where.id;
      POKLADNY.set(id, (POKLADNY.get(id) || 0) + (x.data.pokladna.increment || 0));
      return {}; } },
    gameDelivery: { create: async (x) => { DORUCENKY.push(x.data); return x.data; } },
    gameEquity: { update: async (x) => { ZMENY.push(x); return {}; } },
  };
  return { prisma: Object.assign({}, {
    gameEquity: { findMany: async (q) => (q && q.where && q.where.stav === 'bezi' ? EQUITY : []),
      update: tx.gameEquity.update },
    gamePlayer: { findUnique: async (q) => ({ id: q.where.id, nick: 'H' + q.where.id,
      state: { cash: 9000000, units: [] }, dividenda_pct: 1, dividenda_min: 0 }) },
    gameLoan: prazdne, gameSpotClaim: prazdne, gameZlocin: prazdne,
    gameAliance: tx.gameAliance,
    gameDelivery: tx.gameDelivery,
    $transaction: async (fn) => fn(tx),
  }) };
}
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return db();
  if (/game-account\.routes$/.test(co)) return { _zbydeMesicne: () => 1000000 };
  // Úklid mrtvých podílů sem nepatří — testuje se výplata, ne úklid.
  if (/\/konec$/.test(co)) return { uklidMrtvePodily: async () => {} };
  return puvodni.apply(this, arguments);
};
const FIN = require('../services/game/finance');
// Hák se schválně NEodstraňuje: finance si berou jak databázi, tak modul
// s výpočtem měsíčního zisku až uvnitř volání, kdy by jim jinak propadl
// ten skutečný — a test by pak tiše počítal s nulovým ziskem.

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

(async () => {
  const vcera = new Date(Date.now() - 86400000);
  EQUITY = [
    { id: 1, investor_id: 50, investor_nick: 'Hráč', fond_id: null,
      firma_id: 9, firma_nick: 'Firma', podil: 0.2, vyplaceno: 0, nedoplatek: 0,
      stav: 'bezi', dalsi_at: vcera },
    { id: 2, investor_id: null, investor_nick: 'Fond', fond_id: 3,
      firma_id: 9, firma_nick: 'Firma', podil: 0.3, vyplaceno: 0, nedoplatek: 0,
      stav: 'bezi', dalsi_at: vcera },
  ];
  await FIN.tik();

  // Firma vydělá milion měsíčně, takže hráč bere 200 tisíc a fond 300.
  const proHrace = DORUCENKY.filter((d) => d.player_id === 50 && d.kind === 'cash');
  ok('hráč dostane svou výplatu doručenkou',
    proHrace.length === 1 && proHrace[0].amount === 200000,
    '— ' + JSON.stringify(proHrace));

  ok('fondu se připíše do pokladny', POKLADNY.get(3) === 300000, '— ' + POKLADNY.get(3));
  // Tohle je ta past: doručenka pro fond by zůstala ležet navždycky.
  ok('a nechodí mu žádná doručenka',
    !DORUCENKY.some((d) => d.player_id === 3 && d.kind === 'cash'));
  ok('fond se nevydává za hráče',
    !DORUCENKY.some((d) => d.player_id === null || d.player_id === undefined));

  // Firma musí přijít o obojí — svoje peníze nevydává jen hráčům.
  const odFirmy = DORUCENKY.filter((d) => d.player_id === 9 && d.kind === 'cash');
  ok('firmě se strhne i to, co šlo fondu',
    odFirmy.reduce((a, d) => a + d.amount, 0) === -500000,
    '— ' + odFirmy.reduce((a, d) => a + d.amount, 0));

  ok('oba podíly se posunuly na další měsíc', ZMENY.length === 2, '— ' + ZMENY.length);
  ok('a oběma se zapsalo vyplaceno',
    ZMENY.every((z) => z.data.vyplaceno > 0), '— ' + JSON.stringify(ZMENY.map((z) => z.data.vyplaceno)));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
