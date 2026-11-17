// =============================================================================
// Laundromat Tycoon — čisté jmění počítané serverem
// =============================================================================
// Dosud se jmění četlo z uloženého stavu hry, tedy z toho, co poslal
// prohlížeč. Pro samotné hraní to stačilo, ale žebříček a hodnosti mají být
// záruka, ne jmenovka — a jakmile se za herní peníze začnou kupovat podíly
// ve firmách jiných hráčů, přestane být únosné i to první.
//
// Tohle počítá jmění z toho, co o hráči ví server sám:
//
//   stroje na místech   z evidence míst (GameSpotClaim)
//   koupená zem         z evidence míst, cena spočítaná při nákupu
//   sklad a zboží na cestě  z objednávek (GameOrder), které nejsou postavené
//   hotovost a dluh     ze stavu hry — zatím jediné, co server nepočítá sám;
//                       hlídá to mez přírůstku v services/game/strop.js
//
// Čemu se vědomě vyhýbáme: přípravy ploch, pobočky a četa. Server o nich
// neví a doplňovat je znamená další dvě evidence. Rozdíl proti dřívějšímu
// číslu je u většiny hráčů malý a platí pro všechny stejně, takže žebříček
// zůstává poctivý. Hodnosti se při přechodu zmrazí, aby o ně kvůli tomu
// nikdo nepřišel.

'use strict';

const { prisma } = require('../../config/database');
const POZEMKY = require('./pozemky');

// Musí sedět s CENY_STROJU v routes/game-account.routes.js.
const CENY_STROJU = {
  mini: Math.round(35000 * 24.35 * 1.25),
  flex: Math.round(52000 * 24.35 * 1.25),
  max: Math.round(67000 * 24.35 * 1.25),
};

function hotovostADluh(st) {
  return Math.round(Number((st || {}).cash) || 0) - Math.round(Number((st || {}).loan) || 0);
}

// Majetek jednoho hráče ze serverových dat. Claims a objednávky se předávají
// už načtené, aby šlo spočítat celý žebříček dvěma dotazy místo pěti set.
function majetekZ(claims, objednavky) {
  let stroje = 0, zeme = 0, sklad = 0;
  (claims || []).forEach((c) => {
    if (c.model && CENY_STROJU[c.model]) stroje += CENY_STROJU[c.model];
    if (c.pozemek) zeme += (c.cena != null ? c.cena : POZEMKY.odhad(c.spot_id));
  });
  (objednavky || []).forEach((o) => {
    sklad += (o.cena != null && o.cena > 0) ? o.cena : (CENY_STROJU[o.model] || 0);
  });
  return { stroje, zeme, sklad, celkem: stroje + zeme + sklad };
}

// Rozpad pro jednoho hráče — hodí se do administrace, když se někdo ptá,
// z čeho se to číslo skládá.
async function rozpad(playerId, st) {
  const [claims, objednavky] = await Promise.all([
    prisma.gameSpotClaim.findMany({ where: { player_id: playerId },
      select: { spot_id: true, model: true, pozemek: true, cena: true } }),
    prisma.gameOrder.findMany({ where: { player_id: playerId, postaveno_at: null, zruseno_at: null },
      select: { model: true, cena: true } }),
  ]);
  const m = majetekZ(claims, objednavky);
  const penize = hotovostADluh(st);
  return Object.assign({}, m, { hotovost_dluh: penize, jmeni: m.celkem + penize });
}

async function proHrace(playerId, st) {
  return (await rozpad(playerId, st)).jmeni;
}

// Celý žebříček najednou: dva dotazy na všechno, pak už jen sčítání.
// Vrací mapu id → { stroje, zeme, sklad, celkem }, hotovost si každý
// volající přičte ze stavu, který stejně drží v ruce.
async function majetekVsech() {
  const [claims, objednavky] = await Promise.all([
    prisma.gameSpotClaim.findMany({
      select: { player_id: true, spot_id: true, model: true, pozemek: true, cena: true } }),
    prisma.gameOrder.findMany({ where: { postaveno_at: null, zruseno_at: null },
      select: { player_id: true, model: true, cena: true } }),
  ]);
  const poHraci = new Map();
  const dej = (id) => {
    let a = poHraci.get(id);
    if (!a) { a = { claims: [], objednavky: [] }; poHraci.set(id, a); }
    return a;
  };
  claims.forEach((c) => dej(c.player_id).claims.push(c));
  objednavky.forEach((o) => dej(o.player_id).objednavky.push(o));

  const out = new Map();
  poHraci.forEach((v, id) => out.set(id, majetekZ(v.claims, v.objednavky)));
  return out;
}

module.exports = { proHrace, rozpad, majetekZ, majetekVsech, hotovostADluh, CENY_STROJU };
