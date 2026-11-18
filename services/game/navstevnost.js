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
// Kampaně z ceníku: kolik přidají a jak dlouho běží.
const KAMPANE = {
  kampan10: { add: 0.10, dnu: 7 }, kampan15: { add: 0.15, dnu: 7 }, kampan25: { add: 0.25, dnu: 7 },
  kampan_sub10: { add: 0.10 }, kampan_sub15: { add: 0.15 }, kampan_sub25: { add: 0.25 },
};

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
  const boost = Math.max(0, Number(v && v.boost) || 0);
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
  const karet = await prisma.gameCard.count({
    where: { player_id: hrac.id, kind: 'traffic', used_at: { not: null } },
  }).catch(() => 0);
  const boost = karet * BOOST_ZA_KARTU;

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

  const p = povest(st);
  return {
    navstevnost: spocti({ refs, boost, kampanAdd, povest: p }, ted),
    refs, boost, kampanAdd, povest: p,
    // Odkud se co vzalo. Dokud je tu pověst z klienta, není návštěvnost
    // serverová — je skoro serverová, a ten rozdíl se nesmí zamlčet.
    zdroje: { refs: 'server', boost: 'server', kampan: 'server', povest: 'klient' },
  };
}

module.exports = { spocti, povestKoef, povest, proHrace,
  TRAFFIC_BASE, TRAFFIC_PER_REF, TRAFFIC_MAX, POVEST_DOLU, POVEST_NAHORU,
  REF_MAX, BOOST_ZA_KARTU, KAMPANE };
