// Stínová pokladna — hotovost, jak ji vede server sám.
//
// Dvě vlastnosti, na kterých to celé stojí, a obě se dají snadno rozbít:
// pokladna se nesmí srovnávat sama (jinak zahodí přesně to, co má měřit)
// a musí počítat od svého posledního kroku, ne od minulého uložení hry
// (jinak jí vynechané intervaly propadnou).
//
// Databáze se neptáme: prisma se podstrčí.
const Module = require('module');
const puvodni = Module.prototype.require;

const RADKY = new Map();
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameDelivery: { findMany: async () => [] },
      gameOrder: { findMany: async () => [] },
      gameSpotClaim: { findMany: async () => [] },
      gameSnapshot: { create: async (x) => x.data },
      gamePokladna: {
        findUnique: async (q) => RADKY.get(q.where.player_id) || null,
        create: async (x) => { const r = Object.assign(
          { kroku: 0, srovnano_o: 0, srovnano_at: null }, x.data);
          RADKY.set(r.player_id, r); return r; },
        update: async (x) => { const r = Object.assign(
          RADKY.get(x.where.player_id) || {}, x.data);
          RADKY.set(x.where.player_id, r); return r; },
        findMany: async () => Array.from(RADKY.values()),
      },
    } };
  }
  return puvodni.apply(this, arguments);
};
// Strop se musí načíst ještě pod podstrčenou prisma: pokladna si ho bere
// až uvnitř posunu, kdy už je hák sundaný, a dostala by ten skutečný.
require('../services/game/strop');
const POK = require('../services/game/pokladna');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const MINUTA = 60000;
// Pokladna počítá ve skutečném čase, takže se režie za pár milisekund
// projeví jako drobné desetinné místo. Porovnáváme proto na koruny.
const blizko = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1 : tol);
function hrac(id, stav, predMs) {
  return { id, nick: 'H' + id, state: stav,
    state_at: new Date(Date.now() - (predMs || MINUTA)) };
}

(async () => {
  // ── Otisk stavu: ukládá se jen to, co do výpočtu vstupuje ──────────────────
  const plny = {
    cash: 1000000, loan: 0,
    areas: { praha: 1, brno: 1 }, revealed: { a: 1, b: 1, c: 1 },
    pobocky: [{}, {}], sidlo: { areaId: 'praha', jmeno: 'sídlo' },
    denni: { den: 2, kdy: '2026-11-19' },
    units: [
      { spotId: 'a', eco: { model: 'max' } },
      { spotId: 'b', eco: { model: 'mini' }, katastrofa: { platim: 50000, hotovo: null } },
    ],
  };
  const o = POK.otiskStavu(plny);
  ok('města a obhlídky se ukládají jako počty', o.areas === 2 && o.revealed === 3,
    '— ' + o.areas + ' / ' + o.revealed);
  ok('stroje bez poruchy se neukládají', o.units.length === 1 && o.units[0].spotId === 'b');
  ok('sídlo si nechá jen adresu', o.sidlo && o.sidlo.areaId === 'praha' && !o.sidlo.jmeno);
  ok('prázdný stav nic neshodí', POK.otiskStavu(null).areas === 0);

  // ── První posun založí řádek a uvěří hře ───────────────────────────────────
  RADKY.clear();
  let r = await POK.posun(hrac(1, plny), plny, { server: 0 }, null);
  ok('první posun založí pokladnu na čísle hry',
    r.zalozeno === true && r.hotovost === 1000000 && r.rozdil === 0, '— ' + r.hotovost);

  // ── Druhý posun jde o čekanou změnu, ne o číslo hry ────────────────────────
  // Hra tvrdí, že má o milion víc. Server pro to nemá důvod, takže si drží svoje.
  const poMilionu = Object.assign({}, plny, { cash: 2000000 });
  r = await POK.posun(hrac(1, plny), poMilionu, { server: 0 }, null);
  ok('pokladna si drží svoje číslo, ne to od hry',
    blizko(r.hotovost, 1000000) && r.hra === 2000000,
    '— ' + Math.round(r.hotovost) + ' vs ' + r.hra);
  ok('a rozdíl je vidět', blizko(r.rozdil, -1000000), '— ' + Math.round(r.rozdil));

  // ── Rozdíl se sčítá ────────────────────────────────────────────────────────
  const jesteMilion = Object.assign({}, plny, { cash: 3000000 });
  r = await POK.posun(hrac(1, poMilionu), jesteMilion, { server: 0 }, null);
  ok('rozdíl se přes kroky sčítá, nesmaže',
    blizko(r.rozdil, -2000000), '— ' + Math.round(r.rozdil));
  ok('kroky se počítají', r.kroku >= 2, '— ' + r.kroku);

  // ── Ruční srovnání ─────────────────────────────────────────────────────────
  const s = await POK.srovnej(1);
  ok('srovnání vezme číslo hry', s.ok && s.hotovost === 3000000, '— ' + s.hotovost);
  ok('a zapíše, o kolik se srovnalo', blizko(s.o, 2000000), '— ' + Math.round(s.o));
  const po = RADKY.get(1);
  ok('v řádku zůstane, že se srovnávalo',
    !!po.srovnano_at && blizko(po.srovnano_o, 2000000), '— ' + Math.round(po.srovnano_o));
  ok('neznámý hráč srovnat nejde', !(await POK.srovnej(999)).ok);

  // ── To podstatné: vynechaný interval nesmí propadnout ──────────────────────
  // Pokladna krokovala před hodinou. Mezitím hra ukládala několikrát a hráč
  // si zřídil pobočku. Minulé uložení ji už nevidí — pokladna ano, protože
  // porovnává proti svému vlastnímu stavu.
  RADKY.clear();
  const pred = { cash: 5000000, areas: {}, revealed: {}, pobocky: [], units: [] };
  await POK.posun(hrac(2, pred), pred, { server: 0 }, null);
  RADKY.get(2).at = new Date(Date.now() - 60 * MINUTA);

  const sPobockou = { cash: 5000000, areas: {}, revealed: {}, pobocky: [{}], units: [] };
  // p.state je mezitímní uložení, které pobočku UŽ MÁ — kdyby se počítalo
  // proti němu, pobočka by se nezaúčtovala vůbec.
  r = await POK.posun(hrac(2, sPobockou, MINUTA), sPobockou, { server: 0 }, null);
  ok('pobočka z vynechaného intervalu se zaúčtuje',
    r.cek && r.cek.zeStavu.pobockyNove === 1, '— ' + JSON.stringify(r.cek && r.cek.zeStavu));
  ok('a sníží hotovost pokladny o její cenu',
    r.hotovost < 5000000, '— ' + Math.round(r.hotovost));

  // ── Přehled ────────────────────────────────────────────────────────────────
  const pr = await POK.prehled(10);
  ok('přehled řadí podle rozdílu', pr.pocet === 1 && pr.radky.length === 1);

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
