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
    const id = e.investor_id;
    const d = m.get(id) || { investor_id: id, podil: 0, zakaz: false };
    d.podil += Number(e.podil) || 0;
    d.zakaz = d.zakaz || !!e.zakaz_zastavy;
    m.set(id, d);
  });
  return Array.from(m.values());
}

// Kdo určuje dividendovou politiku: podílník s víc než polovinou. Jinak nikdo.
function kdoUrcuje(podily) {
  let nej = null;
  (podily || []).forEach((e) => {
    const p = Number(e.podil) || 0;
    if (p > VETSINA && (!nej || p > nej.podil)) nej = { id: e.investor_id, podil: p };
  });
  return nej ? nej.id : null;
}

function smiMenit(podily, kdoId) {
  return kdoUrcuje(podily) === kdoId && kdoId != null;
}

// Smí tenhle člověk zastavení zakázat? Rozhoduje velikost podílu, ne to,
// jestli zákaz zrovna má zapnutý.
function smiBlokovat(podily, kdoId) {
  if (kdoId == null) return false;
  return (podily || []).some((e) => e.investor_id === kdoId
    && (Number(e.podil) || 0) >= BLOKACNI - 1e-9);
}

// Kdo zastavení doopravdy blokuje. Vrací největšího z těch, kdo na to mají
// podíl a zákaz si zapnuli — majitel má vědět, s kým se má bavit.
function kdoBlokuje(podily) {
  let nej = null;
  (podily || []).forEach((e) => {
    const p = Number(e.podil) || 0;
    if (e.zakaz && p >= BLOKACNI - 1e-9 && (!nej || p > nej.podil)) {
      nej = { id: e.investor_id, podil: p };
    }
  });
  return nej ? nej.id : null;
}

// Co se o firmě posílá hráči ven. Jeden tvar pro majitele i pro podílníka —
// liší se jen tím, co je v něm pravda pro koho.
function proHrace(podily, jaId) {
  return {
    urcuje: kdoUrcuje(podily),
    smim_urcovat: smiMenit(podily, jaId),
    blokuje: kdoBlokuje(podily),
    smim_blokovat: smiBlokovat(podily, jaId),
    muj_zakaz: (podily || []).some((e) => e.investor_id === jaId && e.zakaz),
  };
}

module.exports = { souhrn, kdoUrcuje, smiMenit, smiBlokovat, kdoBlokuje, proHrace,
  BLOKACNI, VETSINA };
