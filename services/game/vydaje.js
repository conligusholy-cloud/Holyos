// =============================================================================
// Laundromat Tycoon — výdaje, o kterých server ví ze svého
// =============================================================================
// Tři položky, které hra strhává z hotovosti, ale server je nikam nezapisoval:
// výměna stroje, poplatek za neúspěšné vyjednávání a odstupné při výpovědi.
// U všech tří obsluhuje požadavek server, takže je nemusí nechat hlásit od
// klienta — spočítá si je sám a zapíše.
//
// Proč na tom záleží: čekaná změna i stínová pokladna odečítají výdaje. Když
// výdaj chybí, čeká server víc hotovosti, než se opravdu stane, a ten rozdíl
// je místo, pod kterým se dá schovat hotovost odnikud.
//
// Čtvrtá položka, poplatek za změnu splatnosti úvěru, sem nepatří: ta se
// odehraje celá v prohlížeči a server o ní ví jen z rozdílu dvou uložení —
// počítá ji strop.js.
'use strict';

const { prisma } = require('../../config/database');
const POZ = require('./pozemky');

// Musí sedět s konstantami v public/compounder/game/game.js.
const DOPRAVA_PAUSAL = 8000;       // výjezd party, ať je to blízko nebo daleko
const DOPRAVA_KM = 120;            // za kilometr
const SILNICE = 1.3;               // silnice nejsou vzdušnou čarou
const BID_FEE = 5000;              // neúspěšné vyjednávání o cizí místo
const PRODLOUZENI_POPLATEK = 0.005; // za přepsání smlouvy, z nesplacené jistiny

function kmMezi(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lon == null || b.lon == null) return 0;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Sídlo a pobočky ze stavu hry. Souřadnice posílá klient, ale zneužít se to
// nedá: čím dál je nejbližší základna, tím DRAŽŠÍ doprava, a dražší doprava
// znamená menší čekanou hotovost. Kdo by si základnu posunul, ublíží si.
function zakladny(st) {
  const s = st || {};
  const out = [];
  if (s.sidlo && s.sidlo.lat != null) out.push({ lat: s.sidlo.lat, lon: s.sidlo.lon });
  (Array.isArray(s.pobocky) ? s.pobocky : []).forEach((b) => {
    if (b && b.lat != null) out.push({ lat: b.lat, lon: b.lon });
  });
  return out;
}

function doprava(st, misto, model) {
  const z = zakladny(st);
  if (!z.length || !misto || misto.lat == null) return 0;
  let km = null;
  z.forEach((b) => {
    const d = kmMezi(b, misto) * SILNICE;
    if (km == null || d < km) km = d;
  });
  let cena = DOPRAVA_PAUSAL + km * DOPRAVA_KM;
  if (model === 'max') cena *= 1.5;      // MAX je rozměrný, potřebuje větší vůz
  return Math.round(cena / 100) * 100;
}

// Výměna stroje: doprava nového stroje plus doplatek přípojek, když nový
// model potřebuje silnější. Levnější model se nevrací — přípojky zůstanou.
function vymena(st, claim, stary, novy) {
  const spot = claim && claim.spot_id;
  const opts = { pozemek: !!(claim && claim.pozemek) };
  const doNovy = POZ.pripojky(spot, novy, opts);
  const doStary = POZ.pripojky(spot, stary, opts);
  const doplatek = Math.max(0, Math.round(doNovy - doStary));
  const dop = doprava(st, claim, novy);
  return { celkem: dop + doplatek, doprava: dop, doplatek };
}

// Zápis do knihy. Nikdy nevyhazuje — na zapsaném výdaji ukládání hry nestojí.
async function zapis(playerId, druh, castka, spotId, detail) {
  const c = Math.round(Number(castka) || 0);
  if (!(c > 0)) return null;
  try {
    return await prisma.gameVydaj.create({ data: {
      player_id: playerId, druh, castka: c, spot_id: spotId || null, detail: detail || null,
    } });
  } catch (e) { console.warn('[game-vydaje]', e && e.message); return null; }
}

// Součet za okno — bere si ho strop.utraceno.
// Nespadne ani tehdy, když tabulka ještě není (nasazení předběhne migraci).
// Nula je tu bezpečná odpověď: výdaj se nezapočítá a čekaná změna vyjde
// o něco výš, což je směr, který se stejně nehlídá.
async function zaObdobi(playerId, od, do_) {
  try {
    const rows = await prisma.gameVydaj.findMany({
      where: { player_id: playerId, created_at: { gte: new Date(od), lte: new Date(do_) } },
      select: { castka: true },
    });
    return rows.reduce((a, x) => a + Math.max(0, Number(x.castka) || 0), 0);
  } catch (e) { return 0; }
}

// Poplatek za změnu splatnosti úvěru. Tenhle server neobsluhuje — pozná se
// jen z rozdílu dvou uložení: u úvěru vyskočí počítadlo přepsání. Platí se
// podíl z nesplacené jistiny, a bere se ta ze STARÉHO stavu, protože z ní se
// poplatek počítal.
function poplatkySplatnosti(stary, novy) {
  const sez = (x) => (Array.isArray((x || {}).loans) ? x.loans : []);
  const stare = new Map();
  sez(stary).forEach((l) => { if (l && l.id != null) stare.set(String(l.id), l); });
  let celkem = 0, kolik = 0;
  sez(novy).forEach((l) => {
    if (!l || l.id == null) return;
    const s = stare.get(String(l.id));
    if (!s) return;
    const pridano = (Number(l.prepsano) || 0) - (Number(s.prepsano) || 0);
    if (pridano <= 0) return;
    celkem += Math.round(Math.max(0, Number(s.zbyva) || 0) * PRODLOUZENI_POPLATEK) * pridano;
    kolik += pridano;
  });
  return { celkem, kolik };
}

module.exports = { doprava, vymena, zapis, zaObdobi, poplatkySplatnosti,
  BID_FEE, PRODLOUZENI_POPLATEK, DOPRAVA_PAUSAL, DOPRAVA_KM, SILNICE };
