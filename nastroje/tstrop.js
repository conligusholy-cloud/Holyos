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

  // ── Výdaje poznané z rozdílu dvou uložení ──────────────────────────────
  // Průzkum, obhlídky, pobočky a stěhování sídla mají pevnou cenu a server
  // o nich nemá evidenci. Poznají se z toho, co přibylo mezi dvěma uloženími
  // — a to je poctivější než nechat si poslat částku.
  const pred = { areas: { a: 1 }, revealed: { x: 1 }, pobocky: [{}], sidlo: { areaId: 'a' } };
  const po = { areas: { a: 1, b: 1 }, revealed: { x: 1, y: 1, z: 1 },
    pobocky: [{}, {}], sidlo: { areaId: 'b' } };
  const r1 = strop.zRozdiluStavu(pred, po);
  ok('nové město, obhlídky, pobočka i stěhování se sečtou',
    r1.celkem === 20000 + 2 * 5000 + 500000 + 300000,
    String(r1.celkem) + ' · ' + JSON.stringify(r1));
  // Jen pobočka, ať se do toho nepočítá i stěhování sídla zpátky.
  const dvePobocky = { pobocky: [{}, {}], sidlo: { areaId: 'a' } };
  const jednaPobocka = { pobocky: [{}], sidlo: { areaId: 'a' } };
  ok('zrušená pobočka půlku vrátí',
    strop.zRozdiluStavu(dvePobocky, jednaPobocka).celkem === -250000,
    String(strop.zRozdiluStavu(dvePobocky, jednaPobocka).celkem));
  ok('přesun sídla tam a zpátky stojí pokaždé',
    strop.zRozdiluStavu(po, pred).celkem === 300000 - 250000,
    String(strop.zRozdiluStavu(po, pred).celkem));
  ok('beze změny se neúčtuje nic', strop.zRozdiluStavu(pred, pred).celkem === 0);
  ok('prázdný stav nespadne', strop.zRozdiluStavu(null, null).celkem === 0
    && strop.zRozdiluStavu(undefined, { areas: { a: 1 } }).celkem === 20000);
  // Stěhování se pozná jen podle změny adresy, ne podle prvního zápisu sídla.
  ok('první zapsané sídlo není stěhování',
    strop.zRozdiluStavu({ sidlo: null }, { sidlo: { areaId: 'a' } }).celkem === 0);

  // Režie musí doopravdy dojít až do otisku, ne jen umět spočítat sebe.
  CLAIMS = [{ model: 'max' }];
  DORUCENKY = []; OBJEDNAVKY = []; OTISKY = [];
  // Pobočky má hráč i v minulém uložení — jinak by se do rozdílu připočetlo
  // i jejich pořízení (milion) a o režii by nebylo vidět nic.
  await strop.zkontroluj(
    { id: 31, nick: 'Rezie', state: { cash: 1000000, loan: 0, pobocky: [{}, {}] },
      state_at: new Date(Date.now() - MESIC / 2) },
    { cash: 1100000, loan: 0, units: [{}], pobocky: [{}, {}] });
  const sRezii = (OTISKY[0] || {}).ocekavano;
  OTISKY = [];
  await strop.zkontroluj(
    { id: 32, nick: 'BezRezie', state: { cash: 1000000, loan: 0 },
      state_at: new Date(Date.now() - MESIC / 2) },
    { cash: 1100000, loan: 0, units: [{}] });
  const bezRezii = (OTISKY[0] || {}).ocekavano;
  ok('měsíční režie se do čekané změny opravdu promítne',
    sRezii != null && bezRezii != null && Math.abs((bezRezii - sRezii) - 15000) < 2,
    'rozdíl ' + (bezRezii - sRezii) + ', čekáno 15000 (dvě pobočky za půl měsíce)');

  // ── Měsíční režie ──────────────────────────────────────────────────────
  // Zisk ze sítě je jen za prádlomaty. Pobočky, četa a pojištění běží dál,
  // ať se staví nebo ne — bez nich by čekaná změna vycházela výš u každého,
  // kdo má pobočku.
  const bezRezie = strop.rezieZaMesic({ units: [] });
  ok('nic z toho = žádná režie', bezRezie.celkem === 0);
  const sPobockami = strop.rezieZaMesic({ pobocky: [{}, {}], units: [] });
  ok('dvě pobočky stojí třicet tisíc měsíčně', sPobockami.celkem === 30000,
    String(sPobockami.celkem));
  const sCetou = strop.rezieZaMesic({ ceta: { od: 1 }, units: [] });
  ok('četa stojí mzdy', sCetou.celkem === 80000, String(sCetou.celkem));
  const sShanecem = strop.rezieZaMesic({ ceta: { od: 1, shanec: true, phm: 3000 }, units: [] });
  ok('sháněč a nafta se připočtou', sShanecem.celkem === 80000 + 50000 + 3000,
    String(sShanecem.celkem));
  const sPojistenim = strop.rezieZaMesic({ pojisteni: true,
    units: [{ eco: { model: 'max' } }, { eco: { model: 'mini' } }] });
  ok('pojištění se počítá z ceny strojů', sPojistenim.celkem > 0
    && sPojistenim.celkem < 30000, String(sPojistenim.celkem));
  ok('bez pojistky se neplatí nic',
    strop.rezieZaMesic({ units: [{ eco: { model: 'max' } }] }).celkem === 0);
  // Pořízení čety je jednorázová velká položka a pozná se z rozdílu uložení.
  ok('pořízení čety se započte jednou',
    strop.zRozdiluStavu({ ceta: null }, { ceta: { od: 1 } }).celkem === 1530000
    && strop.zRozdiluStavu({ ceta: { od: 1 } }, { ceta: { od: 1 } }).celkem === 0);

  // Ceny musí sedět s hrou — jinak se počítá jiný výdaj, ne menší díra.
  const hraSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
  const zHry = (re) => { const m = hraSrc.match(re); return m ? Number(m[1]) : null; };
  const ceny = [
    ['SCOUT_COST', zHry(/var SCOUT_COST = (\d+)/), 20000],
    ['REVEAL_COST', zHry(/var REVEAL_COST = (\d+)/), 5000],
    ['POBOCKA_CENA', zHry(/var POBOCKA_CENA = (\d+)/), 500000],
    ['SIDLO_STEHOVANI', zHry(/var SIDLO_STEHOVANI = (\d+)/), 300000],
    ['POBOCKA_MESICNE', zHry(/var POBOCKA_MESICNE = (\d+)/), 15000],
    ['CETA_MZDY', zHry(/var CETA_MZDY = (\d+)/), 80000],
    ['SHANEC_MZDA', zHry(/var SHANEC_MZDA = (\d+)/), 50000],
    ['POJISTNE_PODIL', zHry(/var POJISTNE_PODIL = ([\d.]+)/), 0.004],
  ];
  ceny.forEach(([nazev, vHre, vServeru]) => {
    ok('cena ' + nazev + ' sedí s hrou', vHre === vServeru,
      'hra ' + vHre + ' / server ' + vServeru);
  });

  // ── Výpadek databáze ukládání hry nesmí shodit ─────────────────────────
  const puvodniClaims = CLAIMS;
  CLAIMS = null;   // findMany vrátí null → reduce spadne
  const pad = await strop.zkontroluj(hrac(0, MESIC), { cash: 999999999 });
  ok('chyba uvnitř kontroly nezastaví ukládání', pad === true);
  CLAIMS = puvodniClaims;

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
