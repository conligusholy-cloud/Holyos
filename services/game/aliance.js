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
//   Nebyla společná pokladna. To už neplatí: od 19. 11. má aliance fond
//   (services/game/fond.js) s vlastní pokladnou, vklady a hlasováním.
//   Aliance a fond jsou ale dvě různé věci — aliance sčítá podíly, které
//   členové drží sami, fond drží podíly za ně.
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

// Kolik lidí smí být v jedné alianci. Zadání mluvilo o deseti, dlouho tu
// stálo pět: při pár desítkách hráčů by pětičlenný blok sečetl většinu
// skoro v každé firmě a prahy by přestaly něco znamenat. 19. 11. padlo
// rozhodnutí jít na deset podle zadání — hráčů je víc a aliance má nově
// fond, do kterého se vkládá, takže velký blok není zadarmo.
const MAX_CLENU = 10;
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
  const kamHrac = (id) => (clenstvi && (clenstvi.get ? clenstvi.get(id) : clenstvi[id])) || null;
  // Podíl, který drží fond aliance, patří do bloku té aliance rovnou —
  // fond JE ta aliance, nemusí se hledat přes členství.
  const kam = (e) => (e && e.fond_id != null ? e.fond_id : kamHrac(e && e.investor_id));
  const bloky = new Map();
  (podily || []).forEach((e) => {
    const a = kam(e);
    if (!a) return;
    const d = bloky.get(a) || { clenove: new Set(), podil: 0, zakaz: false };
    // Fond vlastního mluvčího nepotřebuje: za blok mluví on sám.
    if (e.fond_id == null) d.clenove.add(e.investor_id);
    d.podil += Number(e.podil) || 0;
    d.zakaz = d.zakaz || !!e.zakaz;
    bloky.set(a, d);
  });
  // Které bloky drží fond. Tam mluvčího nepotřebujeme.
  const maFond = new Set();
  (podily || []).forEach((e) => { if (e && e.fond_id != null) maFond.add(e.fond_id); });
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
    const a = kam(e);
    if (!a) return Object.assign({}, e);
    const d = bloky.get(a);
    // Blok nese jeho mluvčí — ledaže v něm je fond. Pak ho nese fond,
    // protože o fondu rozhodují členové společně a mluvčí za něj nemluví.
    const nese = (maFond.has(a)
      ? e.fond_id === a
      : e.investor_id === mluvciBloku.get(a)) && !uzPolozeno.has(a);
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
  const kamHrac = (id) => (clenstvi && (clenstvi.get ? clenstvi.get(id) : clenstvi[id])) || null;
  // Fondův podíl patří do bloku své aliance rovnou — fond JE ta aliance.
  const kam = (e) => (e && e.fond_id != null ? e.fond_id : kamHrac(e && e.investor_id));
  const out = new Map();
  (podily || []).forEach((e) => {
    const a = kam(e);
    if (!a) return;
    const d = out.get(a) || { aliance_id: a, podil: 0, clenu: new Set() };
    d.podil += Number(e.podil) || 0;
    if (e.fond_id == null) d.clenu.add(e.investor_id);
    else d.fond = true;
    out.set(a, d);
  });
  return Array.from(out.values())
    .map((d) => ({ aliance_id: d.aliance_id, podil: d.podil, clenu: d.clenu.size,
      // Když za blok drží podíl fond, nejedná za něj mluvčí: rozhodují
      // o něm členové společně a majitel firmy se baví s aliancí.
      fond: !!d.fond,
      mluvci: d.fond ? null : mluvci(Array.from(d.clenu), podily) }))
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
