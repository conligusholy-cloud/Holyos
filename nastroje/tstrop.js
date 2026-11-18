// Mez přírůstku hotovosti — počítá se z toho, co ví server, ne z toho,
// co pošle prohlížeč.
//
// Tohle je první kámen serverového počítání peněz. Zatím se jen měří, ale
// až se z meze stane strop, bude na tomhle testu stát, jestli se poctivému
// hráči nezastaví hra.
//
// Databáze se neptáme: prisma se podstrčí, aby test běžel všude a rychle.
const Module = require('module');
const puvodni = Module.prototype.require;

let CLAIMS = [];
let DORUCENKY = [];
let OTISKY = [];
let OBJEDNAVKY = [];
// Co se naposledy ptalo na doručenky — potřebujeme vidět, že se mezi ně
// dostaly i ty vyzvedávané v tomhle uložení.
let POSLEDNI_DOTAZ = null;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameSpotClaim: { findMany: async (q) => {
        // Pozemky si bere očekávaná změna, prádlomaty strop.
        if (q && q.where && q.where.pozemek) return [];
        return CLAIMS;
      } },
      gameDelivery: { findMany: async (q) => { POSLEDNI_DOTAZ = q; return DORUCENKY; } },
      gameOrder: { findMany: async () => OBJEDNAVKY },
      gameSnapshot: { create: async (x) => { OTISKY.push(x.data); return x.data; } },
    } };
  }
  return puvodni.apply(this, arguments);
};

const strop = require('../services/game/strop');
Module.prototype.require = puvodni;

const MESIC = strop.MESIC_MS;
let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

function hrac(hotovost, predMs) {
  return { id: 1, nick: 'Test', state: { cash: hotovost },
    state_at: new Date(Date.now() - predMs) };
}

(async () => {
  // ── Jeden MAX stroj za jeden herní měsíc ───────────────────────────────
  // 20 lidí denně × návštěvnost 2,0 × 30,5 dne × 11,33 € × 24,35 = ~337 tis.
  const zaMesic = strop.stropStroje('max');
  ok('strop jednoho MAXu za měsíc je kolem 337 tisíc',
    Math.abs(zaMesic - 336800) < 2000, '— vyšlo ' + Math.round(zaMesic));

  // ── Poctivý hráč projde ────────────────────────────────────────────────
  CLAIMS = [{ model: 'max' }, { model: 'max' }, { model: 'flex' }];
  DORUCENKY = [];
  let v = await strop.prirustek(hrac(1000000, MESIC), 1000000 + 400000);
  ok('poctivý přírůstek se vejde', v.sedi,
    '— přidal ' + v.rozdil + ', strop ' + v.strop);

  // ── Dopsaná miliarda neprojde ──────────────────────────────────────────
  v = await strop.prirustek(hrac(1000000, MESIC), 1000000000);
  ok('dopsaná miliarda se nevejde', !v.sedi,
    '— přidal ' + v.rozdil + ', strop ' + v.strop);

  // ── Víc prádlomatů = vyšší mez ─────────────────────────────────────────
  const maly = await strop.prirustek(hrac(0, MESIC), 5000000);
  CLAIMS = new Array(40).fill({ model: 'max' });
  const velky = await strop.prirustek(hrac(0, MESIC), 5000000);
  // Porovnáváme příspěvek strojů, ne celou mez: v té je i pevná rezerva,
  // která u malé sítě převáží všechno ostatní.
  ok('velká síť má vyšší mez než malá', velky.ze_stroju > maly.ze_stroju * 5,
    '— ze strojů ' + maly.ze_stroju + ' vs ' + velky.ze_stroju);
  ok('velké síti projde, co malé neprojde', velky.sedi && !maly.sedi);

  // ── Čas hraje roli ─────────────────────────────────────────────────────
  CLAIMS = [{ model: 'max' }];
  const hodina = await strop.prirustek(hrac(0, 3600000), 1);
  const tyden = await strop.prirustek(hrac(0, 7 * 86400000), 1);
  ok('delší nepřítomnost zvedá mez', tyden.strop > hodina.strop,
    '— hodina ' + hodina.strop + ', týden ' + tyden.strop);

  // ── Co poslal server, se počítá ────────────────────────────────────────
  CLAIMS = [];
  DORUCENKY = [];
  const bezVyplaty = await strop.prirustek(hrac(0, 60000), 50000000);
  DORUCENKY = [{ amount: 48000000 }, { amount: 2000000 }];
  const sVyplatou = await strop.prirustek(hrac(0, 60000), 50000000);
  ok('výplata podílu se do meze započte', !bezVyplaty.sedi && sVyplatou.sedi,
    '— bez ní strop ' + bezVyplaty.strop + ', s ní ' + sVyplatou.strop);

  // ── Hráč bez prádlomatů má aspoň rezervu ───────────────────────────────
  DORUCENKY = [];
  const novy = await strop.prirustek(hrac(0, 60000), 1000000);
  ok('nový hráč bez prádlomatů se vejde do rezervy', novy.sedi,
    '— strop ' + novy.strop);

  // ── Ubývání hotovosti se neřeší ────────────────────────────────────────
  const utratil = await strop.prirustek(hrac(5000000, MESIC), 10000);
  ok('utracení hotovosti mez neřeší', utratil.sedi && utratil.rozdil < 0);

  // ── První uložení nemá s čím porovnávat ────────────────────────────────
  // ── Půjčka není vydělané ───────────────────────────────────────────────────
  // Hráč se sítí má velký úvěrový rámec a čerpá z něj miliony jedním
  // klepnutím. Kdyby to mez neuměla, vyskočila by na každém velkém hráči,
  // který si sáhl do banky — a to je přesně ten planý poplach, kvůli kterému
  // se strop dodnes nezapnul.
  const pujcil = await strop.prirustek(hrac(1000000, 60000),
    { cash: 11000000, loan: 10000000 });
  ok('čerpání úvěru mez nepřeteče', pujcil.sedi,
    '— přidal ' + pujcil.rozdil + ', strop ' + pujcil.strop + ', půjčeno ' + pujcil.pujceno);

  // Tentýž skok bez dluhu je vymyšlená hotovost.
  const vymyslel = await strop.prirustek(hrac(1000000, 60000), { cash: 11000000 });
  ok('stejný skok bez dluhu mez přeteče', !vymyslel.sedi,
    '— přidal ' + vymyslel.rozdil + ', strop ' + vymyslel.strop);

  // Půjčka kryje jen sama sebe, ne cokoli navíc.
  const pujcilAPridal = await strop.prirustek(hrac(1000000, 60000),
    { cash: 60000000, loan: 10000000 });
  ok('půjčka nekryje vymyšlené peníze nad ni', !pujcilAPridal.sedi,
    '— přidal ' + pujcilAPridal.rozdil + ', strop ' + pujcilAPridal.strop);

  // Splátka dluh i hotovost snižuje — nesmí z toho vzniknout povolenka.
  const splatil = await strop.prirustek(
    { id: 9, state: { cash: 5000000, loan: 8000000 }, state_at: new Date(Date.now() - 60000) },
    { cash: 1000000, loan: 4000000 });
  ok('splátka úvěru nedá povolenku na nic', splatil.sedi && splatil.rozdil < 0,
    '— rozdíl ' + splatil.rozdil + ', půjčeno ' + (splatil.pujceno || 0));

  // Splácení dluhu nesmí povolovat přírůstek hotovosti. Kdyby se počítal
  // rozdíl dluhu v absolutní hodnotě, stačilo by splatit úvěr a pod tím si
  // přidat stejnou částku.
  const splatilAPridal = await strop.prirustek(
    { id: 9, state: { cash: 1000000, loan: 8000000 }, state_at: new Date(Date.now() - 60000) },
    { cash: 6000000, loan: 4000000 });
  ok('splacený dluh nepovoluje přírůstek', !splatilAPridal.sedi,
    '— přidal ' + splatilAPridal.rozdil + ', strop ' + splatilAPridal.strop
    + ', půjčeno ' + (splatilAPridal.pujceno || 0));

  // Chybějící údaj o dluhu se musí brát jako nula, ne jako nekonečná povolenka.
  const bezDluhu = await strop.prirustek(hrac(1000000, 60000), { cash: 60000000, loan: null });
  ok('chybějící dluh nic nepovolí', !bezDluhu.sedi, '— strop ' + bezDluhu.strop);

  const prvni = await strop.prirustek({ id: 2, state: null, state_at: null }, 999999999);
  ok('bez předchozího uložení se nehlásí nic', prvni.sedi);

  // ── Otisk hry v čase ───────────────────────────────────────────────────
  CLAIMS = [{ model: 'max' }];
  DORUCENKY = [];
  OTISKY = [];
  const stav = { cash: 1200000, units: [{}, {}, {}] };
  await strop.zkontroluj({ id: 77, nick: 'Otisk', state: { cash: 1000000 },
    state_at: new Date(Date.now() - MESIC) }, stav);
  ok('při ukládání se zapíše otisk', OTISKY.length === 1,
    OTISKY.length ? '— hotovost ' + OTISKY[0].hotovost + ', přírůstek ' + OTISKY[0].prirustek : '');
  ok('otisk nese počet prádlomatů z evidence, ne ze stavu',
    OTISKY.length === 1 && OTISKY[0].pradlomatu === 1);

  // Druhé uložení hned po sobě už otisk nepíše — jinak by byl řádek
  // při každém uložení a tabulka by za týden měla miliony řádků.
  await strop.zkontroluj({ id: 77, nick: 'Otisk', state: { cash: 1200000 },
    state_at: new Date(Date.now() - 60000) }, { cash: 1250000, units: [] });
  ok('druhé uložení hned po sobě otisk nepřidá', OTISKY.length === 1,
    '— otisků ' + OTISKY.length);

  // Nesedící přírůstek se zapíše vždycky, i hned po předchozím otisku.
  await strop.zkontroluj({ id: 77, nick: 'Otisk', state: { cash: 1200000 },
    state_at: new Date(Date.now() - 60000) }, { cash: 999999999, units: [] });
  ok('nesedící přírůstek se zapíše i mimo odstup', OTISKY.length === 2
    && OTISKY[1].sedi === false, '— otisků ' + OTISKY.length);

  // ── Doručenky vyzvednuté v tomtéž uložení ──────────────────────────────
  // Potvrzují se až v transakci, která zapisuje stav — tedy po téhle
  // kontrole. Kdyby se do meze nezapočítaly, vypadaly by peníze z balíku
  // vyzvednutého v jednom kole se stavbou jako peníze odnikud.
  CLAIMS = [{ model: 'mini' }];
  DORUCENKY = [{ amount: 4000000 }];
  OTISKY = [];
  const sVyzvednutim = await strop.prirustek(
    { id: 9, nick: 'Vyzvedavac', state: { cash: 1000000 }, state_at: new Date(Date.now() - 30000) },
    { cash: 4500000, units: [] }, [11, 12]);
  ok('vyzvedávané doručenky se do meze započítají',
    sVyzvednutim.ze_serveru === 4000000 && sVyzvednutim.sedi,
    'ze serveru ' + sVyzvednutim.ze_serveru + ', sedí ' + sVyzvednutim.sedi);
  const vetve = ((POSLEDNI_DOTAZ || {}).where || {}).OR || [];
  ok('dotaz hledá i nepotvrzené doručenky z tohohle uložení',
    vetve.length === 2 && vetve[1].claimed_at === null
    && JSON.stringify(vetve[1].id) === JSON.stringify({ in: [11, 12] }),
    JSON.stringify(vetve[1] || null));
  DORUCENKY = [];
  const bezVyzvednuti = await strop.prirustek(
    { id: 9, nick: 'Vyzvedavac', state: { cash: 1000000 }, state_at: new Date(Date.now() - 30000) },
    { cash: 4500000, units: [] });
  ok('bez vyzvednutí se na nepotvrzené neptáme',
    (((POSLEDNI_DOTAZ || {}).where || {}).OR || []).length === 1
    && !bezVyzvednuti.sedi, 'sedí ' + bezVyzvednuti.sedi);

  // ── Čekaná změna hotovosti ─────────────────────────────────────────────
  // Druhý krok k pokladně: ne „co ještě jde", ale „co mělo být".
  CLAIMS = [{ model: 'max' }];
  DORUCENKY = [{ amount: 50000 }];
  OBJEDNAVKY = [{ cena: 200000 }];
  OTISKY = [];
  await strop.zkontroluj(
    { id: 21, nick: 'Cekana', state: { cash: 1000000, loan: 0 },
      state_at: new Date(Date.now() - MESIC / 2) },
    { cash: 1100000, loan: 100000, units: [{}] });
  const o = OTISKY[0] || {};
  ok('otisk nese čekanou změnu i nákupy', o.ocekavano != null && o.nakupy === 200000,
    'čekáno ' + o.ocekavano + ', nákupy ' + o.nakupy);
  // Půl měsíce zisku + doručenky − nákupy + čerpání úvěru. Zisk serveru je
  // z jednoho maxu, takže se tu nekontroluje na korunu, ale na skladbu:
  // bez doručenek a nákupů by vyšlo o 150 tisíc jinak.
  OBJEDNAVKY = [];
  DORUCENKY = [];
  OTISKY = [];
  await strop.zkontroluj(
    { id: 22, nick: 'Cekana2', state: { cash: 1000000, loan: 0 },
      state_at: new Date(Date.now() - MESIC / 2) },
    { cash: 1100000, loan: 100000, units: [{}] });
  const o2 = OTISKY[0] || {};
  ok('bez nákupů a doručenek vyjde čekaná změna o 150 tisíc jinak',
    o2.ocekavano != null && o.ocekavano != null
    && Math.abs((o2.ocekavano - o.ocekavano) - 150000) < 2,
    'rozdíl ' + (o2.ocekavano - o.ocekavano));
  ok('čerpání úvěru se do čekané změny počítá',
    o2.ocekavano >= 100000, 'čekáno ' + o2.ocekavano);
  OBJEDNAVKY = [];

  // ── Výpadek databáze ukládání hry nesmí shodit ─────────────────────────
  const puvodniClaims = CLAIMS;
  CLAIMS = null;   // findMany vrátí null → reduce spadne
  const pad = await strop.zkontroluj(hrac(0, MESIC), { cash: 999999999 });
  ok('chyba uvnitř kontroly nezastaví ukládání', pad === true);
  CLAIMS = puvodniClaims;

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
