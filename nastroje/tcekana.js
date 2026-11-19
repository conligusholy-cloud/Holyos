// Čekaná změna: denní odměna a zaplacené opravy.
//
// Tohle jsou dvě díry, které se našly při auditu pohybů hotovosti ve hře.
// Denní odměna je PŘÍJEM, o kterém server nevěděl — poctivý hráč, který si ji
// vyzvedl, vypadal, že mu hotovost přibyla odnikud. Oprava po poruše je
// VÝDAJ, o kterém server nevěděl — ten naopak dělal v čekané změně místo,
// pod kterým se dala schovat hotovost navíc.
//
// Databáze se neptáme: prisma se podstrčí, aby test běžel všude a rychle.
const Module = require('module');
const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameSpotClaim: { findMany: async () => [] },
      gameDelivery: { findMany: async () => [] },
      gameOrder: { findMany: async () => [] },
      gameSnapshot: { create: async (x) => x.data },
    } };
  }
  return puvodni.apply(this, arguments);
};
const strop = require('../services/game/strop');
const CENY = require('../services/game/jmeni').CENY_STROJU;
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Denní odměna: dno versus podíl ze zisku ──────────────────────────────────
ok('první den bez zisku je na dně', strop.denniOdmena(1, 0) === 5000,
  '— ' + strop.denniOdmena(1, 0));
ok('sedmý den bez zisku je na svém dně', strop.denniOdmena(7, 0) === 100000,
  '— ' + strop.denniOdmena(7, 0));
ok('u velké sítě přebije podíl dno', strop.denniOdmena(7, 4000000) === 1000000,
  '— ' + strop.denniOdmena(7, 4000000));
ok('u malé sítě zůstane dno', strop.denniOdmena(7, 100000) === 100000,
  '— ' + strop.denniOdmena(7, 100000));
ok('podíl roste s dnem', strop.denniOdmena(7, 10000000) > strop.denniOdmena(1, 10000000));
// Nesmyslný den nesmí shodit výpočet ani vyrobit obří částku.
ok('den nula spadne na první den', strop.denniOdmena(0, 0) === strop.denniOdmena(1, 0));
ok('den mimo řadu spadne na poslední', strop.denniOdmena(99, 0) === strop.denniOdmena(7, 0));
ok('záporný zisk se bere jako nula', strop.denniOdmena(3, -5000000) === 15000,
  '— ' + strop.denniOdmena(3, -5000000));

// ── Vyzvednutí se pozná z rozdílu dvou uložení ───────────────────────────────
const bezOdmeny = { denni: { den: 3, kdy: '2026-11-18' } };
const sOdmenou = { denni: { den: 4, kdy: '2026-11-19' } };

let p = strop.prijmyZeStavu(bezOdmeny, bezOdmeny, 0);
ok('beze změny data se nic nepřipisuje', p.celkem === 0, '— ' + p.celkem);

p = strop.prijmyZeStavu(bezOdmeny, sOdmenou, 0);
ok('po vyzvednutí se připíše odměna za nový den', p.celkem === 20000 && p.den === 4,
  '— ' + p.celkem + ' za den ' + p.den);

p = strop.prijmyZeStavu({}, sOdmenou, 0);
ok('první odměna vůbec se taky pozná', p.celkem === 20000, '— ' + p.celkem);

// Tohle je ta podstatná vlastnost: podíl se počítá ze zisku, který si spočítal
// server. Kdyby se bral od hry, šlo by si odměnu nafouknout.
const maly = strop.prijmyZeStavu(bezOdmeny, sOdmenou, 0).celkem;
const velky = strop.prijmyZeStavu(bezOdmeny, sOdmenou, 8000000).celkem;
ok('částku určuje zisk podaný serverem, ne stav od hry', velky > maly,
  '— ' + maly + ' vs ' + velky);

// ── Opravy po poruše ─────────────────────────────────────────────────────────
const stroj = (k) => ({ spotId: 'praha-1', eco: { model: 'max' }, katastrofa: k });
const CENA_MAX = CENY.max;

let o = strop.opravyZeStavu({ units: [stroj({ platim: 300000, hotovo: null })] },
  { units: [stroj({ platim: 300000, hotovo: null })] });
ok('nezaplacená oprava se nepočítá', o.celkem === 0, '— ' + o.celkem);

o = strop.opravyZeStavu({ units: [stroj({ platim: 300000, hotovo: null })] },
  { units: [stroj({ platim: 300000, hotovo: Date.now() + 60000 })] });
ok('zaplacená oprava se počítá', o.celkem === 300000 && o.kusu === 1, '— ' + o.celkem);

// Když oprava mezi dvěma uloženími i doběhne, porucha ze stavu zmizí celá.
o = strop.opravyZeStavu({ units: [stroj({ platim: 250000, hotovo: null })] },
  { units: [{ spotId: 'praha-1', eco: { model: 'max' } }] });
ok('oprava, která mezitím i doběhla, se počítá taky', o.celkem === 250000, '— ' + o.celkem);

// Nafouknutá částka by zvedla výdaje a udělala místo pro hotovost navíc.
o = strop.opravyZeStavu({ units: [stroj({ platim: 99000000, hotovo: null })] },
  { units: [stroj({ platim: 99000000, hotovo: Date.now() + 60000 })] });
ok('nafouknutá oprava se zastropuje cenou stroje', o.celkem === CENA_MAX,
  '— ' + o.celkem + ' / strop ' + CENA_MAX);

// Pojištěná oprava je pětina ceny — pod stropem, takže projde v hlášené výši.
o = strop.opravyZeStavu({ units: [stroj({ platim: 407862, pojisteno: true, hotovo: null })] },
  { units: [stroj({ platim: 407862, pojisteno: true, hotovo: Date.now() + 60000 })] });
ok('pojištěná oprava projde v hlášené výši', o.celkem === 407862, '— ' + o.celkem);

o = strop.opravyZeStavu({ units: [] },
  { units: [stroj({ platim: 300000, hotovo: Date.now() + 60000 })] });
ok('stroj, který dřív nebyl, nic nepřidá', o.celkem === 0, '— ' + o.celkem);

o = strop.opravyZeStavu({ units: [stroj({ platim: 300000, hotovo: 1 })] },
  { units: [stroj({ platim: 300000, hotovo: 1 })] });
ok('už dřív zaplacená oprava se nepočítá podruhé', o.celkem === 0, '— ' + o.celkem);

o = strop.opravyZeStavu({ units: [stroj({ platim: -5000, hotovo: null })] },
  { units: [stroj({ platim: -5000, hotovo: Date.now() })] });
ok('záporná oprava hotovost nepřidá', o.celkem === 0, '— ' + o.celkem);

o = strop.opravyZeStavu(null, null);
ok('prázdný stav nic neshodí', o.celkem === 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
