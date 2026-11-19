// =============================================================================
// Laundromat Tycoon — co smí podílník podle velikosti podílu
// =============================================================================
// Prahy jsou schválně tři, ne pět. Víc si nikdo nezapamatuje a hra, které
// hráč nerozumí, není náročná — je jen otravná.
//
//   podíl      vidí do financí firmy a bere svůj díl zisku
//   25 %       blokační menšina: může zakázat zastavení majetku firmy
//   přes 50 %  určuje dividendovou politiku
//
// Platí přitom jedno pravidlo nad všemi ostatními: hlasuje se, neřídí se.
// Nikdo nikdy nesahá na cizí uloženou hru. Majitel si staví, nakupuje
// a prodává sám — podíl dává hlas, ne ruce.
//
// A druhé, stejně důležité: nikdo nečeká na cizí kliknutí. Blokace není
// žádost o souhlas, na kterou majitel čeká tři dny, než se podílník
// přihlásí. Je to přepínač, který podílník nastaví dopředu, a majitel
// rovnou vidí, na čem je.
//
// Většina se počítá na člověka, ne na řádku. Kdo koupil třikrát po dvaceti
// procentech, drží šedesát — a tři řádky v databázi na tom nic nemění.

'use strict';

// Od chvíle, kdy do firem investuje i fond aliance, nestačí sčítat podle
// investor_id: hráč 3 a fond 3 jsou dva různí držitelé. Pracuje se proto
// s klíčem z drzitel.js — 'h:3' versus 'f:3'.
const DRZ = require('./drzitel');

// Volající se ptají svým id hráče. Snese se obojí: číslo i hotový klíč.
const klicZ = (kdo) => (kdo == null ? null
  : (typeof kdo === 'string' && /^[hf]:/.test(kdo) ? kdo : 'h:' + kdo));

// Blokační menšina. Čtvrtina firmy je dost na to, aby se bez ní nedala
// zastavit — zástava je nevratná a týká se přímo jejích peněz.
const BLOKACNI = 0.25;
// Většina je víc než polovina. Rovná polovina nestačí: při přesných
// padesáti procentech nemá navrch nikdo.
const VETSINA = 0.5;

// Podíly sečtené na člověka. Vstupem jsou řádky z databáze, výstupem lidé.
// zakaz je zapnutý, stačí-li ho mít na jedné řádce — kdo si zákaz nastavil,
// nastavil si ho pro celý svůj podíl.
function souhrn(radky) {
  const m = new Map();
  (radky || []).forEach((e) => {
    // Sní­ se obojí: syrový řádek z databáze i už sečtený záznam, který
    // nese hotový klíč. Bez toho nebyl souhrn idempotentní a druhé sečtení
    // by sečtené řádky zahodilo.
    const k = e.drzitel || DRZ.klic(e);
    if (k == null) return;      // podíl bez držitele neexistuje, viz drzitel.js
    const d = m.get(k) || { drzitel: k, investor_id: e.investor_id == null ? null : e.investor_id,
      fond_id: e.fond_id == null ? null : e.fond_id, podil: 0, zakaz: false };
    d.podil += Number(e.podil) || 0;
    d.zakaz = d.zakaz || !!e.zakaz_zastavy || !!e.zakaz;
    m.set(k, d);
  });
  return Array.from(m.values());
}

// Kdo určuje dividendovou politiku: držitel s víc než polovinou. Jinak nikdo.
// Vrací KLÍČ, ne id — jinak by se většina fondu nedala odlišit od většiny
// hráče se stejným číslem.
// Oba se schválně ptá na SOUČET držitele, ne na jednotlivé řádky. Kdo koupil
// třikrát po dvaceti procentech, drží šedesát — a dřív neurčoval nic, protože
// se porovnával každý nákup zvlášť a žádný sám přes polovinu nebyl. Souhrn
// je idempotentní, takže ho sní­ i už sečtený seznam.
function kdoUrcuje(radky) {
  const podily = souhrn(radky);
  let nej = null;
  (podily || []).forEach((e) => {
    const p = Number(e.podil) || 0;
    const k = e.drzitel || DRZ.klic(e);
    if (k == null) return;
    if (p > VETSINA && (!nej || p > nej.podil)) nej = { klic: k, podil: p };
  });
  return nej ? nej.klic : null;
}

// Totéž, ale jako id hráče — pro zápis do databáze a pro zobrazení jména.
// Když většinu drží fond, vrací null: není to hráč a tvářit se tak nesmí.
function kdoUrcujeHrace(podily) {
  const d = DRZ.zKlice(kdoUrcuje(podily));
  return d && d.typ === 'hrac' ? d.id : null;
}

function smiMenit(podily, kdo) {
  const k = klicZ(kdo);
  return k != null && kdoUrcuje(podily) === k;
}

// Smí tenhle člověk zastavení zakázat? Rozhoduje velikost podílu, ne to,
// jestli zákaz zrovna má zapnutý.
function smiBlokovat(podily, kdo) {
  const k = klicZ(kdo);
  if (k == null) return false;
  return (podily || []).some((e) => (e.drzitel || DRZ.klic(e)) === k
    && (Number(e.podil) || 0) >= BLOKACNI - 1e-9);
}

// Kdo zastavení doopravdy blokuje. Vrací největšího z těch, kdo na to mají
// podíl a zákaz si zapnuli — majitel má vědět, s kým se má bavit.
function kdoBlokuje(radky) {
  const podily = souhrn(radky);
  let nej = null;
  (podily || []).forEach((e) => {
    const p = Number(e.podil) || 0;
    const k = e.drzitel || DRZ.klic(e);
    if (k == null) return;
    if (e.zakaz && p >= BLOKACNI - 1e-9 && (!nej || p > nej.podil)) {
      nej = { klic: k, podil: p };
    }
  });
  return nej ? nej.klic : null;
}

// Kdo blokuje, jako id hráče. Fond vrací null — jméno se mu hledá jinde.
function kdoBlokujeHrace(podily) {
  const d = DRZ.zKlice(kdoBlokuje(podily));
  return d && d.typ === 'hrac' ? d.id : null;
}

// Co se o firmě posílá hráči ven. Jeden tvar pro majitele i pro podílníka —
// liší se jen tím, co je v něm pravda pro koho.
// urcuje a blokuje zůstávají id hráče, protože hra podle nich hledá jméno.
// Když drží většinu fond, jsou prázdné a pravda je v klíčích vedle nich.
function proHrace(podily, jaId) {
  const ja = klicZ(jaId);
  return {
    urcuje: kdoUrcujeHrace(podily),
    urcuje_drzitel: kdoUrcuje(podily),
    smim_urcovat: smiMenit(podily, jaId),
    blokuje: kdoBlokujeHrace(podily),
    blokuje_drzitel: kdoBlokuje(podily),
    smim_blokovat: smiBlokovat(podily, jaId),
    muj_zakaz: (podily || []).some((e) => (e.drzitel || DRZ.klic(e)) === ja && e.zakaz),
  };
}

module.exports = { souhrn, kdoUrcuje, kdoUrcujeHrace, smiMenit, smiBlokovat,
  kdoBlokuje, kdoBlokujeHrace, proHrace, BLOKACNI, VETSINA };
