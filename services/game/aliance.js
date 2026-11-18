// =============================================================================
// Laundromat Tycoon — investiční aliance
// =============================================================================
// Práva ve firmě visí na prazích: čtvrtina blokuje zástavu, půlka určuje
// výplatu zisku, tři čtvrtiny smí nabídnout menšině odchod. Jenže na takové
// podíly sám nedosáhne skoro nikdo — a čím míň je hráčů, tím míň.
//
// Aliance je odpověď: podíly členů se v jedné firmě sčítají a prahy se počítají
// za blok. Tři lidé po deseti procentech dohromady blokují; sami nezmůžou nic.
//
// Co aliance vědomě NENÍ:
//
//   Není společná pokladna. Hotovost žije ve stavu hry v prohlížeči, takže
//   peníze členů nejde držet ani zamknout. Až bude pokladna na serveru,
//   dá se o tom bavit znovu.
//
//   Není hlasování. Za blok jedná jediný člověk — ten, kdo v té firmě drží
//   nejvíc. Kdyby se hlasovalo, čekal by majitel i ostatní na někoho, kdo se
//   přihlásí za tři dny, a to je přesně to, čemu se celá hra vyhýbá.
//
//   Není tajná. Majitel firmy vidí jméno aliance i to, kolik drží dohromady.
//   Skrytý kartel by byl past: majitel by nechápal, proč mu najednou někdo
//   mluví do firmy, a neměl by se jak zařídit.
//
// Cena za vstup je skutečná a musí být řečená předem: kdo vstoupí, přenechává
// svůj hlas mluvčímu. Člen s šestadvaceti procenty měl blokaci sám za sebe;
// v alianci ji má blok, ne on.

'use strict';

const MAX_CLENU = 5;
const NAZEV_MIN = 2, NAZEV_MAX = 24;

// Kdo mluví za alianci v téhle konkrétní firmě: člen s největším podílem.
// Při shodě rozhoduje nižší id — ať je to pokaždé stejné a nezávisí to na
// pořadí, v jakém databáze vrátí řádky.
function mluvci(clenove, podily) {
  const drzi = new Map();
  (podily || []).forEach((e) => {
    drzi.set(e.investor_id, (drzi.get(e.investor_id) || 0) + (Number(e.podil) || 0));
  });
  let nej = null;
  (clenove || []).slice().sort((a, b) => a - b).forEach((id) => {
    const p = drzi.get(id) || 0;
    if (p > 0 && (!nej || p > nej.podil)) nej = { id, podil: p };
  });
  return nej ? nej.id : null;
}

// Podíly přepsané tak, aby celý blok držel mluvčí a ostatní členové nula.
//
// Dělá se to takhle schválně: všechno ostatní ve hře — prahy, dividenda,
// blokace, výstupní nabídka — pak funguje beze změny a bez výjimek pro
// aliance. Právo má ten, kdo za blok jedná, a nikde se nemusí řešit, co
// dělat, když se dva členové neshodnou.
//
// clenstvi je mapa hráč → id aliance. Kdo v ní není, zůstává sám za sebe.
function slucPodily(podily, clenstvi) {
  const kam = (id) => (clenstvi && (clenstvi.get ? clenstvi.get(id) : clenstvi[id])) || null;
  const bloky = new Map();
  (podily || []).forEach((e) => {
    const a = kam(e.investor_id);
    if (!a) return;
    const d = bloky.get(a) || { clenove: new Set(), podil: 0, zakaz: false };
    d.clenove.add(e.investor_id);
    d.podil += Number(e.podil) || 0;
    d.zakaz = d.zakaz || !!e.zakaz;
    bloky.set(a, d);
  });
  // Mluvčí se hledá z původních podílů, ne ze sloučených.
  const mluvciBloku = new Map();
  bloky.forEach((d, a) => {
    mluvciBloku.set(a, mluvci(Array.from(d.clenove), podily));
  });
  // Součet bloku se položí na JEDNU řádku mluvčího, ne na každou jeho.
  // Kdo má ve firmě koupeno nadvakrát, má řádky dvě — a kdyby obě nesly
  // celý blok, sečetlo by se to dvakrát a blok by měl dvojnásobnou moc.
  const uzPolozeno = new Set();
  return (podily || []).map((e) => {
    const a = kam(e.investor_id);
    if (!a) return Object.assign({}, e);
    const d = bloky.get(a);
    const nese = e.investor_id === mluvciBloku.get(a) && !uzPolozeno.has(a);
    if (nese) uzPolozeno.add(a);
    return Object.assign({}, e, {
      podil: nese ? d.podil : 0,
      zakaz: nese ? d.zakaz : false,
      aliance_id: a,
      za_blok: nese,
    });
  });
}

// Kolik která aliance v téhle firmě drží — pro majitele i pro podílníky.
// Majitel musí vidět, že proti němu stojí blok, ne pět nesouvisejících lidí.
function souhrn(podily, clenstvi) {
  const kam = (id) => (clenstvi && (clenstvi.get ? clenstvi.get(id) : clenstvi[id])) || null;
  const out = new Map();
  (podily || []).forEach((e) => {
    const a = kam(e.investor_id);
    if (!a) return;
    const d = out.get(a) || { aliance_id: a, podil: 0, clenu: new Set() };
    d.podil += Number(e.podil) || 0;
    d.clenu.add(e.investor_id);
    out.set(a, d);
  });
  return Array.from(out.values())
    .map((d) => ({ aliance_id: d.aliance_id, podil: d.podil, clenu: d.clenu.size,
      mluvci: mluvci(Array.from(d.clenu), podily) }))
    .sort((a, b) => b.podil - a.podil);
}

// Název aliance. Hráč si ho píše sám, takže se ořezává a hlídá délka;
// o escapování se stará ten, kdo ho vypisuje.
function nazevOk(x) {
  const n = String(x == null ? '' : x).trim().replace(/\s+/g, ' ');
  return n.length >= NAZEV_MIN && n.length <= NAZEV_MAX ? n : null;
}

// Vejde se ještě jeden člen?
function jeMisto(pocetClenu) {
  return (Number(pocetClenu) || 0) < MAX_CLENU;
}

module.exports = { mluvci, slucPodily, souhrn, nazevOk, jeMisto,
  MAX_CLENU, NAZEV_MIN, NAZEV_MAX };
