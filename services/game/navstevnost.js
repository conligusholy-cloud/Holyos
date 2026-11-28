// =============================================================================
// Laundromat Tycoon — návštěvnost, počítaná serverem
// =============================================================================
// Poslední vstup firemní pokladny, který si server bral z prohlížeče. Tržba
// se jím násobí, takže kdo si ho nafoukne, nafoukne si rovnou příjem celé
// sítě — a dokud se na něj server ptá klienta, nemá smysl stěhovat hotovost.
//
// Návštěvnost se skládá ze čtyř věcí a každá je jinak důvěryhodná:
//
//   přivedení hráči  server si je počítá sám (game_refs), klient je jen
//                    zobrazuje — tenhle údaj je jeho a nikdy nebyl klientův
//   trvalý boost     z karty; karta se zahazuje na serveru, takže se dá
//                    sečíst z použitých karet
//   kampaň           předplatné i jednorázová karta jsou nákupy, o kterých
//                    server ví včetně data; dobu běhu zná z ceníku
//   pověst           JEDINÁ věc, která žije výhradně ve stavu hry
//
// Pověst je tedy zbývající díra a je tu schválně pojmenovaná: dokud se bere
// z klienta, je návštěvnost „skoro serverová". Zavřít ji znamená přesunout
// infolinku, což je samostatná práce. Do té doby je v návratové hodnotě
// příznak, odkud se pověst vzala, aby si na to nikdo nezvykl jako na hotovou
// věc.
//
// Krize a sezóna jsou v konjunktura.js — ty nepatří hráči vůbec.

'use strict';

const { prisma } = require('../../config/database');
const KONJ = require('./konjunktura');

const TRAFFIC_BASE = 0.45, TRAFFIC_PER_REF = 0.05, TRAFFIC_MAX = 1.1;
const POVEST_DOLU = 0.2;           // při nejhorší pověsti spadne návštěvnost o pětinu
const POVEST_NAHORU = 0.1;         // při nejlepší stoupne o desetinu
const REF_MAX = 500;               // musí sedět s routes/game.routes.js
const BOOST_ZA_KARTU = 0.15;       // EFFECTS.traffic v routes/game-account.routes.js
// Strop na trvalý boost z karet. Týdenní kampaně se nikdy nesčítaly — běží
// vždycky jedna a další ji nahradí — ale trvalá karta tohle ošetření nikdy
// nedostala a sčítala se bez omezení. Třicet karet znamenalo devítinásobnou
// návštěvnost oproti hráči bez nich, a protože návštěvnost násobí tržbu celé
// sítě, rozhodila jedna karta žebříček víc než sto prádlomatů.
const BOOST_KARET_MAX = 6;
const BOOST_MAX = BOOST_KARET_MAX * BOOST_ZA_KARTU;
// Kampaně z ceníku: kolik přidají a jak dlouho běží.
const KAMPANE = {
  kampan10: { add: 0.10, dnu: 7 }, kampan15: { add: 0.15, dnu: 7 }, kampan25: { add: 0.25, dnu: 7 },
  kampan_sub10: { add: 0.10 }, kampan_sub15: { add: 0.15 }, kampan_sub25: { add: 0.25 },
};

// ─── Náhrada za karty nad strop ──────────────────────────────────────────────
// Strop přišel později než karty. Kdo si jich koupil třicet, měl najednou
// dvacet čtyři kusů, které nedělají nic — a ty nepoužité nejde ani použít.
// Strop je správně (návštěvnost násobí tržbu celé sítě, takže jedna karta
// rozhodila žebříček víc než sto prádlomatů), ale co si hráč zaplatil, mu
// propadnout nesmí.
//
// Vrací se to, co za kartu dal, v herních penězích — ne to, co mu rozbitý
// vzorec stačil vydělat. A přepočítává se nejlepším kurzem, jaký v obchodě
// je: tohle není obchod, tohle je omluva.
const NAD_STROP = 'strop';        // značka na kartě: započtena jako náhrada
const KARTA_CENA_HAL = 9900;      // 99 Kč — cena trvalé kampaně v ceníku
// Nejlepší kurz z ceníku hotovosti (haléře → laundry). Drží se tu jako číslo,
// ať služba nemusí sahat do rout; musí sedět s CASH v game-account.routes.js.
const KURZ_LAUNDRY_ZA_HALER = 23; // cash2000: 200 000 hal → 4 600 000 L$
const NAHRADA_ZA_KARTU = Math.round(KARTA_CENA_HAL * KURZ_LAUNDRY_ZA_HALER);

// Které karty hráči zemřely. Nejdřív nepoužité — ty jsou celé a hráč je
// nikdy nespálil; teprve pak ty použité nad strop.
function mrtveKarty(pouzite, nepouzite) {
  const zive = Math.min(BOOST_KARET_MAX, pouzite.length);
  const mrtvePouzite = pouzite.slice(zive);
  return nepouzite.concat(mrtvePouzite).slice(0,
    Math.max(0, pouzite.length + nepouzite.length - BOOST_KARET_MAX));
}

let NAHRAZENO = false;
async function nahradKartyNadStrop() {
  if (NAHRAZENO) return 0;
  NAHRAZENO = true;
  const vse = await prisma.gameCard.findMany({
    where: { kind: 'traffic', NOT: { used_on: NAD_STROP } },
    select: { id: true, player_id: true, used_at: true },
    orderBy: { id: 'asc' },
  }).catch(() => []);
  const dle = new Map();
  vse.forEach((c) => {
    if (!dle.has(c.player_id)) dle.set(c.player_id, { pouzite: [], nepouzite: [] });
    (c.used_at ? dle.get(c.player_id).pouzite : dle.get(c.player_id).nepouzite).push(c);
  });
  let kolik = 0;
  for (const [playerId, k] of dle) {
    const mrtve = mrtveKarty(k.pouzite, k.nepouzite);
    if (!mrtve.length) continue;
    const castka = NAHRADA_ZA_KARTU * mrtve.length;
    // Značka a zároveň zámek: nepoužitá karta se tím zavře, ať ji hráč
    // nepoužije podruhé a nechce náhradu dvakrát.
    await prisma.gameCard.updateMany({ where: { id: { in: mrtve.map((c) => c.id) } },
      data: { used_on: NAD_STROP, used_at: new Date() } }).catch(() => {});
    await prisma.gameDelivery.create({ data: { player_id: playerId, kind: 'cash',
      amount: castka, spot_id: 'karta:strop:' + mrtve[mrtve.length - 1].id,
      text_kod: 'dor.karta_nad_strop',
      text_data: { p1: mrtve.length, p2: BOOST_KARET_MAX, penize: castka },
      popis: 'Náhrada za trvalé kampaně nad strop (' + mrtve.length + ' ks)' } }).catch(() => {});
    kolik += mrtve.length;
  }
  if (kolik) console.log('[game] náhrada za trvalé kampaně nad strop, karet:', kolik);
  return kolik;
}
// Na čtecí cestě se na to nečeká: sahá to na všechny karty a běží to stejně
// jen jednou.
function nahradaNaPozadi() {
  if (NAHRAZENO) return false;
  Promise.resolve().then(nahradKartyNadStrop).catch((e) => {
    console.warn('[game] náhrada za kampaně selhala:', e && e.message);
  });
  return true;
}

function povest(st) {
  return Math.max(-100, Math.min(100, Number((st || {}).povest) || 0));
}
function povestKoef(p) {
  const x = Math.max(-100, Math.min(100, Number(p) || 0));
  return 1 + (x < 0 ? (x / 100) * POVEST_DOLU : (x / 100) * POVEST_NAHORU);
}

// Samotný vzorec. Strop se zvedá o boost i kampaň — jinak by si je hráč na
// stropu koupil zbytečně a nepoznal to.
function spocti(v, t) {
  const refs = Math.max(0, Math.min(REF_MAX, Math.round(Number(v && v.refs) || 0)));
  // Strop se drží tady, v jediném vzorci — ať se boost spočítal z karet na
  // serveru, nebo přišel ze stavu hry, výš než na BOOST_MAX se nedostane.
  const boost = Math.min(BOOST_MAX, Math.max(0, Number(v && v.boost) || 0));
  const kampan = Math.max(0, Number(v && v.kampanAdd) || 0);
  const strop = TRAFFIC_MAX + boost + kampan;
  const zaklad = TRAFFIC_BASE + refs * TRAFFIC_PER_REF + boost + kampan;
  return Math.min(strop, zaklad) * povestKoef(v && v.povest) * KONJ.koef(t);
}

// Co o hráči ví server sám. Pověst se bere ze stavu hry, protože jinde není.
async function proHrace(hrac, st, t) {
  const ted = t == null ? Date.now() : t;
  const refs = hrac && hrac.ref_id
    ? Math.min(REF_MAX, await prisma.gameRef.count({ where: { ref_id: hrac.ref_id } }).catch(() => 0))
    : 0;

  // Trvalý boost: každá zahozená karta na návštěvnost přidala svůj díl.
  // Karty nad strop se nepočítají — hráč za ně dostal náhradu a počítat je
  // znovu by znamenalo, že má obojí.
  const karet = await prisma.gameCard.count({
    where: { player_id: hrac.id, kind: 'traffic', used_at: { not: null },
      NOT: { used_on: NAD_STROP } },
  }).catch(() => 0);
  const boost = Math.min(BOOST_MAX, karet * BOOST_ZA_KARTU);

  // Kampaň: běžící předplatné, nebo jednorázová karta, která ještě neodběhla.
  // Bere se ta silnější, stejně jako ve hře.
  let kampanAdd = 0;
  // Stejný filtr jako tam, odkud si předplatné bere hra: aktivní i po
  // splatnosti (Stripe ji opraví sám), a jen dokud platí.
  const subs = await prisma.gameSubscription.findMany({
    where: { player_id: hrac.id, status: { in: ['active', 'past_due'] } },
    select: { kind: true, plati_do: true },
  }).catch(() => []);
  subs.forEach((s) => {
    const k = KAMPANE[s.kind];
    if (!k) return;
    if (s.plati_do && new Date(s.plati_do).getTime() <= ted) return;
    kampanAdd = Math.max(kampanAdd, k.add);
  });
  const karty = await prisma.gameCard.findMany({
    where: { player_id: hrac.id, kind: { in: ['kampan10', 'kampan15', 'kampan25'] },
      used_at: { not: null } },
    select: { kind: true, used_at: true },
  }).catch(() => []);
  karty.forEach((c) => {
    const k = KAMPANE[c.kind];
    if (!k) return;
    const konec = new Date(c.used_at).getTime() + k.dnu * 86400000;
    if (konec > ted) kampanAdd = Math.max(kampanAdd, k.add);
  });

  // Pověst: od zavedení hlášení z infolinky si ji server počítá sám z toho,
  // co hráč v hovoru vybral. Dokud ji u hráče nikdy nepočítal (NULL), bere se
  // ta ze stavu hry — jinak by hráči, který zrovna nevolal, spadla na nulu.
  const zeServeru = hrac && hrac.povest != null;
  const p = zeServeru ? Math.max(-100, Math.min(100, Number(hrac.povest))) : povest(st);
  return {
    navstevnost: spocti({ refs, boost, kampanAdd, povest: p }, ted),
    refs, boost, kampanAdd, povest: p,
    // Odkud se co vzalo. U pověsti to platí na hráče, ne na celou hru:
    // kdo od nasazení nevolal, má ji pořád z klienta.
    zdroje: { refs: 'server', boost: 'server', kampan: 'server',
      povest: zeServeru ? 'server' : 'klient' },
  };
}

module.exports = { spocti, povestKoef, povest, proHrace,
  mrtveKarty, nahradKartyNadStrop, nahradaNaPozadi, NAD_STROP, NAHRADA_ZA_KARTU,
  TRAFFIC_BASE, TRAFFIC_PER_REF, TRAFFIC_MAX, POVEST_DOLU, POVEST_NAHORU,
  REF_MAX, BOOST_ZA_KARTU, BOOST_KARET_MAX, BOOST_MAX, KAMPANE };
