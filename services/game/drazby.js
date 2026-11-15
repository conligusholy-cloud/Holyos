// =============================================================================
// Laundromat Tycoon — dražby na tržišti
// =============================================================================
// Pravidla jsou schválně obrácená proti běžné aukci: příhozy cenu SNIŽUJÍ.
// Prodávající si řekne vyvolávací cenu, dražba běží minutu a každý příhoz ji
// prodlouží o tři vteřiny. Vyhrává ten, kdo přihodil naposledy, a zaplatí
// |vyvolávací cena − součet všech příhozů|. Čím víc se přihazuje, tím levněji
// vítěz kupuje — dokud součet nepřeroste vyvolávací cenu. Pak cena zase roste
// a prodávající dostává víc, než si původně řekl.
//
// Všechny příhozy padají prodávajícímu, i ty prohrané. Kdo přihodí a nevyhraje,
// zaplatil za nic — to je ta past i to napětí. Proto je minimální příhoz nízký
// a hráč pořád vidí, kolik už v téhle dražbě utratil.
'use strict';

const { prisma } = require('../../config/database');

const DRAZBA_MS = 60000;        // základní odpočet
const PRIHOZ_MS = 3000;         // co přidá jeden příhoz
const PRIHOZ_MIN = 1000;        // nejmenší příhoz
const VYVOLAVACI_MIN = 10000;   // pod tím nemá dražba smysl
const PREDMETY = ['stroj', 'pradlomat', 'pobocka', 'karta', 'podil', 'prevod'];
// Rychlé předvolby pro tlačítka v okně dražby.
const PREDVOLBY = [1000, 5000, 25000, 100000];

// Cena, kterou zaplatí vítěz. Dole se odráží od nuly.
function cenaZa(vyvolavaci, suma) {
  return Math.abs(Math.round(vyvolavaci) - Math.round(suma));
}
// Kolik dražba vynese prodávajícímu celkem: příhozy plus doplatek vítěze.
function vynosProdavajiciho(vyvolavaci, suma) {
  return Math.round(suma) + cenaZa(vyvolavaci, suma);
}

// Co se o dražbě posílá do hry. Konec posíláme jako čas, ne jako „zbývá X" —
// hodiny v prohlížeči se rozcházejí a odpočet si hra dopočítá sama.
function verejna(d, jaId) {
  if (!d) return null;
  return {
    id: d.id,
    predmet: d.predmet, model: d.model, spot_id: d.spot_id, card_kind: d.card_kind,
    data: d.data || null, nazev: d.nazev,
    vyvolavaci: d.vyvolavaci, suma: d.suma, prihozu: d.prihozu,
    cena: cenaZa(d.vyvolavaci, d.suma),
    vedouci_id: d.vedouci_id || null, vedouci_nick: d.vedouci_nick || null,
    prodavajici_id: d.prodavajici_id, prodavajici_nick: d.prodavajici_nick,
    konec: d.konec, stav: d.stav,
    vitez_id: d.vitez_id || null, vitez_nick: d.vitez_nick || null,
    moje: jaId != null && d.prodavajici_id === jaId,
    vedu: jaId != null && d.vedouci_id === jaId,
  };
}

async function bezici() {
  return prisma.gameDrazba.findFirst({ where: { stav: 'bezi' }, orderBy: { id: 'desc' } });
}

// ─── Kdo se zrovna dívá ──────────────────────────────────────────────────────
// Při běžící dražbě se každý otevřený klient ptá serveru po dvou vteřinách.
// Víc k tomu netřeba: kdo se ozval za posledních šest vteřin, ten u dražby je.
// Drží se to jen v paměti — po restartu se do šesti vteřin zaplní znovu.
const DIVAK_MS = 6000;
const divaci = new Map();          // drazba_id -> Map(player_id -> ms)
function divak(drazbaId, playerId) {
  if (!drazbaId || !playerId) return;
  let m = divaci.get(drazbaId);
  if (!m) divaci.set(drazbaId, m = new Map());
  m.set(Number(playerId), Date.now());
  // Doběhlé dražby ať v paměti neleží navěky.
  if (divaci.size > 20) {
    const ted = Date.now();
    for (const [id, mm] of divaci) {
      let ziva = false;
      for (const t of mm.values()) if (ted - t < 60000) { ziva = true; break; }
      if (!ziva) divaci.delete(id);
    }
  }
}
function divaku(drazbaId) {
  const m = divaci.get(drazbaId);
  if (!m) return 0;
  const lim = Date.now() - DIVAK_MS;
  let n = 0;
  for (const [id, t] of m) { if (t >= lim) n++; else m.delete(id); }
  return n;
}

// Doběhlou dražbu vypořádá i to, že se na ni někdo zeptá — tohle je pojistka
// pro případ, že se zrovna nikdo nedívá. Jinak by vítěz čekal na svou věc,
// dokud někdo neotevře tržiště.
let bezi = false;
async function tik() {
  if (bezi) return;
  bezi = true;
  try {
    const d = await prisma.gameDrazba.findFirst({
      where: { stav: 'bezi', konec: { lte: new Date() } }, orderBy: { id: 'asc' } });
    if (!d) return;
    // Načítáme až tady: trasa i tahle služba na sebe navzájem odkazují.
    await require('../../routes/game-trade.routes')._vyporadejDrazbu(d.id);
  } catch (e) {
    console.warn('[game-drazba] tik:', e && e.message);
  } finally { bezi = false; }
}
function start() {
  setInterval(tik, 5000);
  console.log('[game-drazba] hlídač dražeb běží');
}

module.exports = {
  DRAZBA_MS, PRIHOZ_MS, PRIHOZ_MIN, VYVOLAVACI_MIN, PREDMETY, PREDVOLBY,
  cenaZa, vynosProdavajiciho, verejna, bezici, start, divak, divaku,
};
