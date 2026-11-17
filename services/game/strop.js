// =============================================================================
// Laundromat Tycoon — strop přírůstku hotovosti
// =============================================================================
// Hra běží v prohlížeči a server zatím ukládá to, co mu přijde. U jednoho
// hráče samotného to nevadí — kdo si dopíše peníze, podvádí jen sám na sobě.
// Jakmile se ale za herní peníze kupují podíly ve firmách jiných hráčů,
// přestává to být neškodné: za vymyšlenou hotovost by šlo koupit něco, co
// někdo stavěl měsíc.
//
// Tohle je první krok k tomu, aby o penězích rozhodoval server. Není to
// výpočet zisku — je to hrubá mez, kterou poctivý hráč nemůže překročit:
//
//   za jeden herní měsíc nevydělá jeden prádlomat víc, než kolik je
//   kapacita stroje × nejvyšší myslitelná návštěvnost × cena praní,
//
// a to ještě bez odečtení energií, servisu a nájmu, které se ve skutečnosti
// platí. Kolik prádlomatů hráč má, ví server sám z GameSpotClaim — to je
// jediný údaj, který klient nemůže ovlivnit.
//
// K tomu se přičte všechno, co hráči poslal server (výplaty podílů, splátky,
// dárky, výhry v dražbě), protože to v těch strojích není, a pevná rezerva
// na drobné příjmy, které tu nemodelujeme.
//
// Zatím se jen loguje. Teprve až bude z provozu vidět, kolik to dělá planých
// poplachů, se z meze stane skutečný strop.

'use strict';

const { prisma } = require('../../config/database');

const MESIC_MS = 43200000;            // herní měsíc = 12 skutečných hodin

// Musí sedět s MODELS v public/compounder/game/game.js: kapacita je počet
// lidí denně, spend tržba na člověka v eurech, EUR kurz herní měny.
const EUR = 24.35;
const DNU_V_MESICI = 30.5;
const STROJE = {
  mini: { kapacita: 7.1, spend: 16.52 },
  flex: { kapacita: 14.3, spend: 11.33 },
  max: { kapacita: 20, spend: 11.33 },
};
// Nejvyšší návštěvnost, jaké jde ve hře dosáhnout, je 1,1 plus trvalé karty
// plus běžící kampaň. Dáváme 2,0 — dvojnásobek stropu — ať se mez nikdy
// netrefí do hráče, který má všechno a ještě má štěstí na konjunkturu.
const NAVSTEVNOST_STROP = 2.0;
// Drobné, které tu nemodelujeme: startovní hotovost, denní odměna, prodej
// stroje ze skladu, vratky. Radši velkoryse — tohle má chytat řádový nesmysl,
// ne optimalizaci.
const REZERVA = 3000000;

// Co nejvíc může jeden stroj vydělat za herní měsíc. Hrubá tržba, bez
// odečtení nákladů — strop má být nedosažitelný, ne přesný.
function stropStroje(model) {
  const m = STROJE[model] || STROJE.mini;
  return m.kapacita * NAVSTEVNOST_STROP * DNU_V_MESICI * m.spend * EUR;
}

// Strop za celou síť a daný čas. Prádlomaty bere ze serverové evidence míst,
// ne ze stavu hry.
function stropSite(claims, odMs) {
  const mesicu = Math.max(0, odMs) / MESIC_MS;
  let zaMesic = 0;
  (claims || []).forEach((c) => { zaMesic += stropStroje(c && c.model); });
  return zaMesic * mesicu;
}

// Kolik hráči poslal sám server. Doručenky jsou výplaty podílů, splátky
// půjček, dárky a výhry — hra si je připisuje na pokyn serveru, takže do
// stropu patří celé. Rozhoduje chvíle vyzvednutí, ne založení: peníze
// přistanou v hotovosti až tehdy, a doručenka může ležet i týden.
async function doruceno(playerId, od, do_) {
  try {
    const rows = await prisma.gameDelivery.findMany({
      where: { player_id: playerId, amount: { gt: 0 },
        claimed_at: { gte: new Date(od - 60000), lte: new Date(do_ + 60000) } },
      select: { amount: true },
    });
    return rows.reduce((a, r) => a + Math.max(0, Number(r.amount) || 0), 0);
  } catch (e) {
    // Doručenky nejsou podmínka: bez nich bude mez jen přísnější a nanejvýš
    // se něco zaloguje zbytečně. Zastavit kvůli tomu ukládání hry by bylo
    // mnohem horší.
    return 0;
  }
}

// Hlavní otázka: je skok hotovosti, který klient poslal, vůbec možný?
// Vrací popis, ne verdikt — rozhodnutí, co s tím, patří tomu, kdo volá.
async function prirustek(p, novaHotovost) {
  const stara = Math.round(Number((p.state || {}).cash) || 0);
  const nova = Math.round(Number(novaHotovost) || 0);
  const rozdil = nova - stara;
  const ted = Date.now();
  const naposledy = p.state_at ? new Date(p.state_at).getTime() : 0;
  // Bez předchozího uložení není co porovnávat — nový hráč, nebo první save
  // po obnovení účtu.
  if (!naposledy || rozdil <= 0) {
    return { sedi: true, rozdil, strop: null, od: 0 };
  }
  const od = Math.max(0, ted - naposledy);
  const claims = await prisma.gameSpotClaim.findMany({
    where: { player_id: p.id }, select: { model: true },
  });
  const zeStroju = stropSite(claims, od);
  const zeServeru = await doruceno(p.id, naposledy, ted);
  const strop = Math.round(zeStroju + zeServeru + REZERVA);
  return {
    sedi: rozdil <= strop,
    rozdil, strop, od,
    pradlomatu: claims.length,
    ze_stroju: Math.round(zeStroju),
    ze_serveru: Math.round(zeServeru),
  };
}

// Zápis do logu. Zvlášť, aby se dal v testu obejít a aby bylo na jednom
// místě vidět, co se o hráči zapisuje.
function zapis(p, v) {
  console.warn('[game-strop] hráč #' + p.id + ' (' + (p.nick || '?') + ') přidal '
    + v.rozdil + ' L$ za ' + Math.round(v.od / 60000) + ' min, strop byl ' + v.strop
    + ' (' + v.pradlomatu + ' prádlomatů, ze strojů ' + v.ze_stroju
    + ', ze serveru ' + v.ze_serveru + ')');
}

// Co se volá z ukládání hry. Nikdy nevyhodí výjimku a nikdy neblokuje —
// zatím jen měří. Vrací true, když je přírůstek v mezích.
async function zkontroluj(p, novaHotovost) {
  try {
    const v = await prirustek(p, novaHotovost);
    if (!v.sedi) zapis(p, v);
    return v.sedi;
  } catch (e) {
    console.warn('[game-strop]', e && e.message);
    return true;
  }
}

module.exports = { zkontroluj, prirustek, stropStroje, stropSite,
  MESIC_MS, NAVSTEVNOST_STROP, REZERVA, STROJE };
