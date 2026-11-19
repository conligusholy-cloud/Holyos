// Vzorky hodnoty fondu — podklad pro graf.
//
// Graf je jediné místo, kde hráč uvidí, jestli fond roste, nebo se jen
// přelévá. Když se vzorky píšou moc často, je z křivky šum a tabulka roste
// zbytečně; když se nepíšou vůbec, graf tiše zmizí a nikdo si toho nevšimne,
// protože prázdný graf vypadá jako „zatím nic".
const Module = require('module');
const puvodni = Module.prototype.require;

let ALIANCE = [], EQUITY = [], HRACI = [], HISTORIE = [];
let SMAZANO = 0;
const prazdne = { findMany: async () => [], groupBy: async () => [],
  createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) };

function db() {
  return { prisma: {
    gameAliance: { findMany: async () => ALIANCE },
    gameAlianceClen: { groupBy: async () => [{ aliance_id: 1, _count: { _all: 2 } }] },
    gameEquity: { findMany: async () => EQUITY },
    gamePlayer: { findMany: async () => HRACI },
    gameSpotClaim: prazdne,
    gameOrder: prazdne,
    gameFondHistorie: {
      findMany: async (q) => {
        const w = (q && q.where) || {};
        let r = HISTORIE.slice();
        if (w.aliance_id && w.aliance_id.in) r = r.filter((x) => w.aliance_id.in.indexOf(x.aliance_id) >= 0);
        if (w.aliance_id && typeof w.aliance_id === 'number') r = r.filter((x) => x.aliance_id === w.aliance_id);
        if (w.kdy && w.kdy.gt) r = r.filter((x) => x.kdy > w.kdy.gt);
        r.sort((a, b) => b.kdy - a.kdy);
        return r.slice(0, (q && q.take) || r.length);
      },
      createMany: async (x) => { HISTORIE = HISTORIE.concat(x.data); return { count: x.data.length }; },
      deleteMany: async (q) => {
        const mez = q.where.kdy.lt;
        const pred = HISTORIE.length;
        HISTORIE = HISTORIE.filter((x) => x.kdy >= mez);
        SMAZANO = pred - HISTORIE.length;
        return { count: SMAZANO };
      },
    },
  } };
}
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return db();
  return puvodni.apply(this, arguments);
};
const H = require('../services/game/fond-historie');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

(async () => {
  const ted = new Date('2026-11-20T20:00:00Z');
  // Fond 1 má dva miliony v pokladně a třicet procent firmy za deset milionů.
  // Fond 2 nemá nic — a přesto do grafu patří.
  ALIANCE = [{ id: 1, nazev: 'Alfa', pokladna: 2000000 },
    { id: 2, nazev: 'Prázdná', pokladna: 0 }];
  EQUITY = [{ fond_id: 1, firma_id: 9, podil: 0.3, cena: 1000000 }];
  HRACI = [{ id: 9, state: { cash: 10000000, loan: 0 } }];

  ok('poprvé se zapíše vzorek každému fondu', await H.vzorkuj(ted) === 2);
  const a = HISTORIE.filter((x) => x.aliance_id === 1)[0];
  ok('hodnota je pokladna plus podíl oceněný jměním firmy',
    a.hodnota === 2000000 + 3000000, '— ' + a.hodnota);
  ok('a rozpad sedí na celek', a.pokladna + a.podily === a.hodnota,
    '— ' + a.pokladna + ' + ' + a.podily);
  // Prázdný fond v žebříčku není, ale v grafu být musí: jinak by křivka
  // fondu, který o všechno přišel, skončila posledním nenulovým bodem.
  ok('prázdný fond se zapíše taky',
    HISTORIE.some((x) => x.aliance_id === 2 && x.hodnota === 0));

  ok('za pět minut se nepřipíše nic',
    await H.vzorkuj(new Date(ted.getTime() + 5 * 60000)) === 0,
    '— řádků ' + HISTORIE.length);
  ok('za hodinu a kousek zase ano',
    await H.vzorkuj(new Date(ted.getTime() + 61 * 60000)) === 2);
  ok('a v tabulce jsou čtyři řádky', HISTORIE.length === 4, '— ' + HISTORIE.length);

  // Křivka se kreslí odleva doprava, tedy od nejstaršího.
  const k = await H.proFond(1);
  ok('křivka chodí od nejstaršího', k.length === 2 && k[0].kdy < k[1].kdy);

  // Čtvrt roku zpátky stačí; starší vzorky by jen rostly. Včerejší ale
  // musí přežít — jinak by úklid seřízl graf na poslední hodinu.
  HISTORIE.push({ aliance_id: 1, kdy: new Date(ted.getTime() - 200 * 86400000),
    pokladna: 1, podily: 0, hodnota: 1, clenu: 1 });
  HISTORIE.push({ aliance_id: 1, kdy: new Date(ted.getTime() - 86400000),
    pokladna: 2, podily: 0, hodnota: 2, clenu: 1 });
  ok('starý vzorek se uklidí', await H.uklid(ted) === 1);
  ok('včerejší zůstane', HISTORIE.some((x) => x.hodnota === 2));
  ok('a nové vzorky zůstanou', HISTORIE.length === 5, '— ' + HISTORIE.length);

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
