// Přeměření škody u běžícího případu.
//
// Škoda se počítala při zahájení kontroly a pak už se jí nikdo neotevřel.
// Jenže řízení trvá dny a podvod mezitím jede dál: provize nabíhají, levné
// nákupy přibývají. Soud pak soudil číslo staré týden a trest z něj vyšel
// jako zlomek toho, co člověk opravdu získal.
//
// Druhá strana téže mince: škoda nesmí klesnout. Kdo by si mezi kontrolou a
// soudem odklidil účty, jinak by si tím sám snížil trest.
const Module = require('module');
const puvodni = Module.prototype.require;

let PRIPAD = null;
let HRAC = { state: { cash: 5000000 } };
let ZMENY = [], DORUCENKY = [], ZPRAVY = [];

function db() {
  return { prisma: {
    gameZlocin: {
      update: async (x) => { ZMENY.push(x.data);
        PRIPAD = Object.assign({}, PRIPAD, x.data); return PRIPAD; },
    },
    gamePlayer: { findUnique: async () => HRAC },
    gameDelivery: { create: async (x) => { DORUCENKY.push(x.data); return x.data; } },
    gameZlocinZprava: { create: async (x) => { ZPRAVY.push(x.data); return x.data; } },
  } };
}
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return db();
  return puvodni.apply(this, arguments);
};
const RIZ = require('../services/game/zlocin-rizeni');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const R = { koef_zabaveni: 0.4, trest_nejnizsi: 1, trest_stredni: 1.2, trest_nejvyssi: 1.3 };
const prisma = require('../config/database').prisma;

(async () => {
  // Kontrola zahájená na pět milionů, mezitím z podvodu naběhlo na dvacet pět.
  PRIPAD = { id: 1, hlavni_id: 2, stav: 'kontrola', skoda: 5000000, zmrazeno: 2000000,
    emblem: '🚓', firma: 'Pinon s.r.o.', hlavni_nick: 'pinon', detail: {} };
  ZMENY = []; DORUCENKY = []; ZPRAVY = [];
  let z = await RIZ.premer(prisma, R, PRIPAD, { id: 2, skoda: 25000000 });
  ok('škoda se přeměří na dnešek', z.skoda === 25000000, '— ' + z.skoda);
  ok('a pamatuje si, s čím se začínalo',
    (z.detail || {}).skoda_pri_zahajeni === 5000000, '— ' + JSON.stringify(z.detail));
  // Cíl zmrazení je 40 % z 25 M = 10 M, zmrazené byly 2 M, v hotovosti má 5 M.
  ok('zmrazí se, na co hráč má', z.zmrazeno === 2000000 + 5000000, '— ' + z.zmrazeno);
  ok('a víc se mu nevezme',
    DORUCENKY.length === 1 && DORUCENKY[0].amount === -5000000, '— ' + JSON.stringify(DORUCENKY));
  ok('v novinách je to vidět', ZPRAVY.length === 1);

  // Přeměření podruhé beze změny nesmí nic dělat — jinak by to při každém
  // tiku posílalo zprávu a strhávalo hotovost.
  ZMENY = []; DORUCENKY = []; ZPRAVY = [];
  z = await RIZ.premer(prisma, R, z, { id: 2, skoda: 25000000 });
  ok('stejná škoda nic nemění', !ZMENY.length && !DORUCENKY.length && !ZPRAVY.length);

  // A škoda nikdy neklesá.
  z = await RIZ.premer(prisma, R, z, { id: 2, skoda: 1000 });
  ok('nižší odhad škodu nesníží', z.skoda === 25000000, '— ' + z.skoda);

  // Po rozsudku se nesahá: odvolání se vede proti číslu, které už padlo.
  PRIPAD = { id: 2, hlavni_id: 2, stav: 'odvolani', skoda: 5000000, zmrazeno: 2000000,
    trest_castka: 6000000, detail: {} };
  ZMENY = []; DORUCENKY = []; ZPRAVY = [];
  z = await RIZ.premer(prisma, R, PRIPAD, { id: 2, skoda: 99000000 });
  ok('po rozsudku se škoda nepřepočítává', z.skoda === 5000000 && !ZMENY.length,
    '— ' + z.skoda);

  // Když o něm vyhodnocení nic neříká, případ se nechá být.
  PRIPAD = { id: 3, hlavni_id: 7, stav: 'soud', skoda: 1000, zmrazeno: 0, detail: {} };
  ZMENY = [];
  z = await RIZ.premer(prisma, R, PRIPAD, null);
  ok('bez řádku z vyhodnocení se nic nemění', z.skoda === 1000 && !ZMENY.length);

  // U soudu se měří dál — porota hlasuje o úrovni, ne o částce.
  PRIPAD = { id: 4, hlavni_id: 2, stav: 'soud', skoda: 5000000, zmrazeno: 10000000, detail: {} };
  HRAC = { state: { cash: 0 } };
  ZMENY = []; DORUCENKY = [];
  z = await RIZ.premer(prisma, R, PRIPAD, { id: 2, skoda: 25000000 });
  ok('u soudu se škoda měří dál', z.skoda === 25000000, '— ' + z.skoda);
  ok('a bez hotovosti se nezmrazí nic navíc',
    z.zmrazeno === 10000000 && !DORUCENKY.length, '— ' + z.zmrazeno);

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
