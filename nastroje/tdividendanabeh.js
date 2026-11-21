// Dividenda z akcií, která nabíhá.
//
// Fond si odhlasuje sazbu a ta pak běží akcionáři před očima. Peníze se ale
// nepřipisují každou sekundu — nabíhá čas a doúčtuje se při pohledu do hry,
// stejně jako nájmy a provize. Čtyři věci, na kterých to stojí:
//
//  1. Platí se jen z VOLNÝCH peněz fondu. Co je slíbené ve vyvěšené nabídce,
//     se nesmí rozdat podruhé.
//  2. Když fond nemá, dividenda NENABÍHÁ: čas se posune, ale nevyplatí se nic.
//     Žádný skrytý dluh, který členové neodhlasovali.
//  3. Setiny koruny čas NEPOSOUVAJÍ. Jinak by se drobné rozpustily tím, že se
//     hráč dívá často — a kdo kouká každou minutu, nedostal by nikdy nic.
//  4. Zápis je podmíněný počtem i časem: mezi výpočtem a zápisem mohl hráč
//     akcie prodat.
const Module = require('module');
const puvodni = Module.prototype.require;
let AKCIE_RADKY = [];     // co hráč drží
let FONDY = {};           // fondy podle id
let NABIDKY = [];         // vyvěšené nabídky fondu (zamčené peníze)
let UPDATE_MANY = [];     // podmíněné zápisy
let DORUCENKY = [];       // co se hráči připsalo
let SHODA = true;         // trefí se podmíněný zápis?
let POKLADNA_STACI = true;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    const tx = {
      gameAkcie: { updateMany: async (q) => { UPDATE_MANY.push(q); return { count: SHODA ? 1 : 0 }; } },
      gameAliance: { updateMany: async (q) => { UPDATE_MANY.push(q); return { count: POKLADNA_STACI ? 1 : 0 }; } },
      gameDelivery: { create: async (q) => { DORUCENKY.push(q.data); return q.data; } },
    };
    return { prisma: {
      gameAkcie: {
        findMany: async () => AKCIE_RADKY,
        updateMany: tx.gameAkcie.updateMany,
      },
      gameAliance: { findUnique: async (q) => FONDY[q.where.id] || null },
      gameTender: { findMany: async () => NABIDKY },
      $transaction: async (fn) => fn(tx),
    } };
  }
  return puvodni.apply(this, arguments);
};
const DIV = require('../services/game/akcie-dividenda');
const A = require('../services/game/akcie');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const HODINA = 3600000;
const pred = (ms) => new Date(Date.now() - ms);
// Fond: akcie za 10 000 účetně, sazba 12 % za herní rok, pokladna 10 mil.
const fond = (x) => Object.assign({ id: 7, nazev: 'EX ALTO', akcie_sazba: 0.12,
  akcie_ucetni: 10000, pokladna: 10000000 }, x || {});
const drzba = (x) => Object.assign({ id: 1, aliance_id: 7, player_id: 5, pocet: 100,
  dividenda_do: pred(HODINA) }, x || {});
const znovu = (r, f, nab) => {
  AKCIE_RADKY = r ? [r] : []; FONDY = { 7: f }; NABIDKY = nab || [];
  UPDATE_MANY = []; DORUCENKY = []; SHODA = true; POKLADNA_STACI = true;
};
// Za hodinu při 12 % p.a. ze 100 akcií po 10 000: rok je 6 skutečných dní.
const ZA_HODINU = A.dividendaZa(100, 10000, 0.12, HODINA);

(async () => {
  // ─── Normální výplata ──────────────────────────────────────────────────────
  znovu(drzba(), fond());
  let dostal = await DIV.dorovnej(5);
  ok('za hodinu se něco vyplatí', dostal > 0 && dostal === ZA_HODINU, String(dostal));
  ok('a je to doručenka hráči',
    DORUCENKY.length === 1 && DORUCENKY[0].player_id === 5 && DORUCENKY[0].amount === dostal);
  ok('hotovost chodí doručenkou, ne zápisem do stavu', DORUCENKY[0].kind === 'cash');
  // Z pokladny fondu musí odejít přesně tolik, kolik se vyplatilo.
  const ubylo = UPDATE_MANY.filter((q) => q.data && q.data.pokladna);
  ok('fondu ubude přesně to, co vyplatil',
    ubylo.length === 1 && ubylo[0].data.pokladna.decrement === dostal);
  // Krok sem vedle by znamenal, že fond vyplatí i to, co už nemá — proto se
  // podmínka čte opatrně, ať chybějící podmínka propadne jako nález, ne jako pád.
  ok('a jen když na to má', !!(ubylo[0] && ubylo[0].where && ubylo[0].where.pokladna
    && ubylo[0].where.pokladna.gte === dostal));
  // Posun času: od téhle chvíle se počítá další.
  const posun = UPDATE_MANY.filter((q) => q.data && q.data.dividenda_do);
  ok('čas se posune', posun.length === 1);
  ok('zápis je podmíněný počtem i časem',
    posun[0].where.pocet === 100 && !!posun[0].where.dividenda_do);

  // Dvakrát za sebou: podruhé už nic, protože čas je posunutý.
  // (Stub vrací pořád stejný řádek, takže se to ověří zvlášť níž.)

  // ─── Fond nemá ─────────────────────────────────────────────────────────────
  // Celá pokladna je zamčená ve vyvěšené nabídce. Dividenda nenabíhá —
  // ale čas běží dál, aby z toho nebyl dluh, který členové neodhlasovali.
  znovu(drzba(), fond(), [{ fond_id: 7, stav: 'bezi', max_pct: 1, koupeno_pct: 0,
    cena_za_pct: 10000000, do: new Date(Date.now() + HODINA) }]);
  dostal = await DIV.dorovnej(5);
  ok('se zamčenou pokladnou se nevyplatí nic', dostal === 0);
  ok('a žádná doručenka nevznikne', DORUCENKY.length === 0);
  ok('ale čas se posune, aby z toho nebyl dluh',
    UPDATE_MANY.length === 1 && !!UPDATE_MANY[0].data.dividenda_do);

  // Fond má jen část. Vyplatí se jen to, co má.
  znovu(drzba(), fond({ pokladna: 10 }));
  dostal = await DIV.dorovnej(5);
  ok('fond vyplatí nanejvýš to, co má volné', dostal === 10, String(dostal));

  // ─── Setiny koruny ─────────────────────────────────────────────────────────
  // Kdo kouká každou minutu, nesmí přijít o drobné. Čas se neposouvá.
  znovu(drzba({ pocet: 1, dividenda_do: pred(1000) }), fond({ akcie_ucetni: 100 }));
  dostal = await DIV.dorovnej(5);
  ok('ze setin se nevyplatí nic', dostal === 0);
  ok('a čas se NEposune — nabíhá dál', UPDATE_MANY.length === 0);

  // ─── Co se nepočítá ────────────────────────────────────────────────────────
  znovu(drzba(), fond({ akcie_sazba: 0 }));
  ok('bez vyhlášené sazby se nevyplácí nic',
    (await DIV.dorovnej(5)) === 0 && UPDATE_MANY.length === 0);
  znovu(drzba(), fond({ akcie_ucetni: 0 }));
  ok('bez účetní hodnoty taky ne',
    (await DIV.dorovnej(5)) === 0 && UPDATE_MANY.length === 0);
  znovu(null, fond());
  ok('kdo akcie nedrží, nedostane nic', (await DIV.dorovnej(5)) === 0);
  znovu(drzba(), null);
  ok('neznámý fond nic nerozbije', (await DIV.dorovnej(5)) === 0);
  znovu(drzba(), fond());
  ok('nesmyslné id nic nerozbije', (await DIV.dorovnej('nic')) === 0);

  // ─── Souběh ────────────────────────────────────────────────────────────────
  // Mezi výpočtem a zápisem hráč akcie prodal: podmínka se netrefí a
  // nevyplatí se nic. Peníze fondu nesmí odejít za akcie, které už nedrží.
  znovu(drzba(), fond()); SHODA = false;
  dostal = await DIV.dorovnej(5);
  ok('při souběhu se nevyplatí nic', dostal === 0);
  ok('a nevznikne doručenka', DORUCENKY.length === 0);
  // A opačně: pokladna mezitím klesla pod částku.
  znovu(drzba(), fond()); POKLADNA_STACI = false;
  dostal = await DIV.dorovnej(5);
  ok('když pokladna mezitím klesne, nevyplatí se nic', dostal === 0);
  ok('a hráči se nic nepřipíše', DORUCENKY.length === 0);

  // ─── Počítadlo pro hru ─────────────────────────────────────────────────────
  const st = DIV.stav(fond(), 100, pred(HODINA));
  ok('počítadlo zná sazbu', st.sazba === 0.12);
  ok('a co nese jedna akcie za rok', st.na_akcii_rocne === 1200);
  ok('a kolik přibývá za sekundu', st.za_sekundu > 0);
  ok('za sekundu sedí s tím, co se vyplatí',
    Math.abs(st.za_sekundu * (A.ROK_MS / 1000) - A.dividendaZa(100, 10000, 0.12, A.ROK_MS)) < 1);
  ok('bez sazby je počítadlo nula', DIV.stav(fond({ akcie_sazba: 0 }), 100, new Date()).za_sekundu === 0);

  // ─── Zapojení ──────────────────────────────────────────────────────────────
  const fs = require('fs');
  const path = require('path');
  const routy = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
  // Doúčtovat se musí dřív, než se hráč na cokoli podívá — jinak kouká na
  // počítadlo, které běží, ale peníze nikde.
  ok('seznam akcií doúčtuje', /router\.get\('\/trade\/akcie',[\s\S]{0,300}DIV\.dorovnej/.test(routy));
  ok('detail akcie taky', /router\.get\('\/trade\/akcie\/:id',[\s\S]{0,200}DIV\.dorovnej/.test(routy));
  ok('panel fondu taky', /router\.get\('\/trade\/aliance\/fond',[\s\S]{0,300}DIV\.dorovnej/.test(routy));
  // A před obchodem: po prodeji už ty akcie nedrží a nabíhlé by propadlo.
  const obchod = routy.slice(routy.indexOf("router.post('/trade/akcie/:id/obchod'"));
  ok('obchod doúčtuje PŘED změnou držby',
    obchod.indexOf('DIV.dorovnej') > 0
    && obchod.indexOf('DIV.dorovnej') < obchod.indexOf('prisma.$transaction'));
  // Sazba se zapíná hlasováním, ne jedním členem.
  ok('sazba má vlastní druh návrhu', /akcie_sazba: \{ prah: FOND\.prahDruhu\('akcie_sazba'\)/.test(routy));
  const fond_js = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'game', 'fond.js'), 'utf8');
  ok('a má nastavený práh', /akcie_sazba: BEZNE/.test(fond_js));
  // Zapnutí sazby nesmí vyplatit zpětně dobu, kdy žádná neplatila.
  ok('zapnutí sazby posune začátek na teď',
    /akcie_sazba: sazba[\s\S]{0,300}dividenda_do: new Date\(\)/.test(routy));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
  process.exit(chyb ? 1 : 0);
})();
