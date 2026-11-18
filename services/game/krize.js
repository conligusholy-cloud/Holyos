// =============================================================================
// Laundromat Tycoon — firmy v nouzi
// =============================================================================
// Půjčky mezi hráči ve hře jsou, splátky se strhávají, zmeškané se počítají
// a zástava propadá. Co chybí, je ta chvíle mezi tím: dlužník ví, že na
// příští splátku nemá, ostatní o tom nevědí, a než se to provalí, je po
// zástavě. Přitom právě tady je ta hra — někdo může přijít s penězi a říct
// si o podmínky.
//
// Tohle počítá, kdo je v nouzi, z toho, co ví server: splatné závazky
// z evidence půjček a hotovost z uloženého stavu. Nic se nikam nehlásí
// a o nic se nežádá — kdo nemá na splátku, ten je vidět. Tak to chodí
// i doopravdy a je to lepší hra než tlačítko „požádat o pomoc", které
// nikdo nestiskne.
//
// Stupně:
//   ok        splátky jsou kryté
//   varovani  na příští splátku zbývá málo (vidí jen dlužník)
//   krize     na splatnou splátku nemá, nebo už jednu zmeškal
//   propadne  další zmeškaná splátka znamená propadlou zástavu
//
// Ve výpisu pro ostatní jsou jen dva poslední stupně. Varování je soukromá
// věc dlužníka — kdyby se vyvěšovalo i to, byla by na nástěnce půlka hry.

'use strict';

const { prisma } = require('../../config/database');

// Musí sedět se ZMESKAT_* v services/game/finance.js.
const ZMESKAT_BEZ_ZASTAVY = 3;
const ZMESKAT_SE_ZASTAVOU = 1;
const zmeskatMax = (p) => ((p.zastava_spot || p.zastava_podil) ? ZMESKAT_SE_ZASTAVOU : ZMESKAT_BEZ_ZASTAVY);
// Co se počítá jako „brzy splatné". Herní měsíc je dvanáct skutečných hodin,
// takže den dopředu je přesně dvě splátky.
const BRZY_MS = 24 * 3600000;

// Stav jednoho dlužníka. Dostane všechny své běžící půjčky a svůj stav hry.
function stav(pujcky, st) {
  const bezici = (pujcky || []).filter((p) => p.stav === 'bezi');
  const hotovost = Math.max(0, Math.round(Number((st || {}).cash) || 0));
  const ted = Date.now();

  let splatneBrzy = 0, zmeskanoCelkem = 0, nejblizsi = null, nejhorsi = 0;
  bezici.forEach((p) => {
    const kdy = new Date(p.dalsi_at).getTime();
    if (kdy - ted <= BRZY_MS) splatneBrzy += Math.max(0, Math.round(p.splatka || 0));
    if (nejblizsi == null || kdy < nejblizsi) nejblizsi = kdy;
    zmeskanoCelkem += Math.max(0, p.zmeskano || 0);
    // Jak blízko je nejbližší propadnutí: zbývající pokusy u téhle půjčky.
    const zbyva = zmeskatMax(p) - Math.max(0, p.zmeskano || 0);
    if (!nejhorsi || zbyva < nejhorsi) nejhorsi = zbyva;
  });

  const chybi = Math.max(0, splatneBrzy - hotovost);
  let stupen = 'ok';
  if (bezici.length) {
    if (nejhorsi <= 1 && (chybi > 0 || zmeskanoCelkem > 0)) stupen = 'propadne';
    else if (chybi > 0 || zmeskanoCelkem > 0) stupen = 'krize';
    else if (hotovost < splatneBrzy * 1.5) stupen = 'varovani';
  }
  return { stupen, chybi, splatne_brzy: splatneBrzy, hotovost,
    zmeskano: zmeskanoCelkem, pujcek: bezici.length,
    dalsi_at: nejblizsi ? new Date(nejblizsi) : null,
    zbyva_pokusu: nejhorsi || null };
}

// Čím může dlužník ručit, když si bude shánět peníze. Prádlomat, který už
// v zástavě je, se nepočítá — ten je slíbený.
async function cimRuci(playerId, zastaveneSpoty, prodanyPodil) {
  // Prázdný seznam zástav se dřív obcházel nemožným id '\u0000'. Jenže nulový
  // bajt není platný text pro Postgres, takže každý takový dotaz skončil
  // chybou „invalid byte sequence for encoding UTF8: 0x00" a hráč, který
  // nemá nic v zástavě, se nedozvěděl, čím může ručit. Když není co vyřadit,
  // se prostě nevyřazuje.
  const kde = { player_id: playerId, model: { not: '' } };
  if (zastaveneSpoty && zastaveneSpoty.length) kde.spot_id = { notIn: zastaveneSpoty };
  const mist = await prisma.gameSpotClaim.count({ where: kde });
  return { volnych_mist: mist, volny_podil: Math.max(0, 1 - (prodanyPodil || 0)) };
}

// Kdo je v nouzi. Jen ti, komu je opravdu zle — varování se nevyvěšuje.
async function seznam() {
  const pujcky = await prisma.gameLoan.findMany({ where: { stav: 'bezi' } });
  if (!pujcky.length) return [];
  const idDluzniku = Array.from(new Set(pujcky.map((p) => p.borrower_id)));
  const hraci = await prisma.gamePlayer.findMany({
    where: { id: { in: idDluzniku }, disabled: false },
    select: { id: true, nick: true, company: true, emblem: true, state: true },
  });
  const podilyRows = await prisma.gameEquity.findMany({
    where: { firma_id: { in: idDluzniku }, stav: 'bezi' },
    select: { firma_id: true, podil: true },
  });
  const prodano = new Map();
  podilyRows.forEach((e) => prodano.set(e.firma_id, (prodano.get(e.firma_id) || 0) + (e.podil || 0)));

  const out = [];
  for (const h of hraci) {
    const moje = pujcky.filter((p) => p.borrower_id === h.id);
    const s = stav(moje, h.state || {});
    if (s.stupen !== 'krize' && s.stupen !== 'propadne') continue;
    const zastavene = moje.map((p) => p.zastava_spot).filter(Boolean);
    const ruceni = await cimRuci(h.id, zastavene, prodano.get(h.id) || 0);
    out.push({
      id: h.id, nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'),
      znak: h.emblem || null,
      stupen: s.stupen, chybi: s.chybi, splatne_brzy: s.splatne_brzy,
      zmeskano: s.zmeskano, pujcek: s.pujcek, dalsi_at: s.dalsi_at,
      zbyva_pokusu: s.zbyva_pokusu,
      volnych_mist: ruceni.volnych_mist, volny_podil: ruceni.volny_podil,
    });
  }
  // Nejhorší nahoře: komu hrozí propadnutí, pak podle toho, kolik chybí.
  out.sort((a, b) => (a.stupen === b.stupen ? b.chybi - a.chybi
    : (a.stupen === 'propadne' ? -1 : 1)));
  return out;
}

module.exports = { stav, seznam, cimRuci, BRZY_MS,
  ZMESKAT_BEZ_ZASTAVY, ZMESKAT_SE_ZASTAVOU };
