// =============================================================================
// Laundromat Tycoon — aliance jako fond
// =============================================================================
// Dosud je aliance hlasovací blok: podíly členů v jedné firmě se sečtou a za
// blok jedná mluvčí. Zadání ale mluví o něčem jiném — o fondu, do kterého
// členové skládají peníze a podle vložené částky z něj mají díl.
//
// Rozdíl není kosmetický. V bloku drží každý svůj podíl sám a odchodem si ho
// odnese. Ve fondu drží podíl FOND a člen drží díl fondu, takže:
//
//   kdo vloží víc, má větší slovo i větší výplatu,
//   kdo odejde, nedostává zpátky svůj vklad, ale svůj díl dnešní hodnoty,
//   a nový vklad ředí ostatní — stejně jako kapitálový vstup do firmy.
//
// Tohle je samotný výpočet, bez databáze a bez obsluhy. Je oddělený schválně:
// počítají se tu cizí peníze, a to je přesně ten druh kódu, který musí jít
// otestovat do koruny, ne odhadnout z provozu.
//
// Zbytek fondu — vlastní účet, nákup podílů ve firmách, účetnictví — čeká na
// firemní pokladnu. Bez ní nemá fond kam peníze uložit.

'use strict';

// Prahy jsou stejné jako u firem, ať se hráč neučí dvoje pravidlo.
const BEZNE = 0.5;        // běžné rozhodnutí: víc než polovina
const ZASADNI = 0.75;     // zásadní: tři čtvrtiny

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

// Kolik kdo do fondu vložil. Vstupem jsou řádky vkladů, výstupem lidé —
// jeden člověk může vkládat opakovaně a pořád je to jeden podílník.
function vklady(radky) {
  const m = new Map();
  (radky || []).forEach((r) => {
    const id = r && r.clen_id;
    if (id == null) return;
    const v = Math.max(0, Math.round(cislo(r.castka)));
    m.set(id, (m.get(id) || 0) + v);
  });
  return m;
}

// Podíl každého člena = jeho vklad ku všem vkladům. Žádné zvláštní ředění
// se nepočítá: nový vklad zvedne jmenovatele a tím naředí ostatní sám.
function podily(radky) {
  const v = vklady(radky);
  let celkem = 0;
  v.forEach((x) => { celkem += x; });
  const out = [];
  v.forEach((castka, id) => {
    out.push({ clen_id: id, vklad: castka, podil: celkem > 0 ? castka / celkem : 0 });
  });
  // Největší první — v přehledech i při hlasování se na pořadí spoléhá.
  out.sort((a, b) => b.vklad - a.vklad || a.clen_id - b.clen_id);
  out.celkem = celkem;
  return out;
}

// ─── Rozdělení zisku ─────────────────────────────────────────────────────────
// Past je v zaokrouhlení: tři členové po třetině a sto korun k rozdělení dá
// třikrát 33 a jedna koruna zmizí. U jednoho měsíce je to jedno, u dvou set
// výplat do roka už ne — a hlavně by se účet fondu rozešel se součtem toho,
// co dostali členové.
//
// Proto se rozděluje po celých korunách a zbytek dostanou ti, komu
// zaokrouhlením nejvíc ubylo. Součet výplat se tak VŽDY rovná rozdělované
// částce, ať je dělitelná, nebo ne.
function rozdeleni(castka, radky) {
  const p = podily(radky);
  const k = Math.round(cislo(castka));
  if (!p.length || !p.celkem) return [];
  // Ztráta se dělí stejně jako zisk — kdo má podíl, nese i mínus.
  const znamenko = k < 0 ? -1 : 1;
  const abs = Math.abs(k);
  const hrube = p.map((x) => {
    const presne = abs * x.podil;
    const dolu = Math.floor(presne);
    return { clen_id: x.clen_id, podil: x.podil, castka: dolu, zbytek: presne - dolu };
  });
  let rozdano = hrube.reduce((a, x) => a + x.castka, 0);
  // Zbývající koruny podle toho, komu zaokrouhlením nejvíc ubylo. Při shodě
  // rozhoduje větší podíl a pak nižší id, ať je to pokaždé stejně.
  const poradi = hrube.slice().sort((a, b) => b.zbytek - a.zbytek
    || b.podil - a.podil || a.clen_id - b.clen_id);
  let i = 0;
  while (rozdano < abs && poradi.length) {
    poradi[i % poradi.length].castka++;
    rozdano++; i++;
  }
  return hrube.map((x) => ({ clen_id: x.clen_id, podil: x.podil,
    castka: x.castka * znamenko }));
}

// ─── Hlasování ───────────────────────────────────────────────────────────────
// Váhou je podíl ve fondu. Měří se proti VŠEM podílům, ne proti odevzdaným
// hlasům: kdyby stačila většina z těch, kdo zrovna hlasovali, prošlo by
// zásadní rozhodnutí dvěma procenty fondu jen proto, že ostatní spali.
// Mlčení je tedy „ne" — a kdo chce rozhodovat, musí se ozvat.
function hlasovani(radky, hlasy, prah) {
  const p = podily(radky);
  const mez = cislo(prah) || BEZNE;
  const h = hlasy || {};
  let pro = 0, proti = 0, mlci = 0;
  p.forEach((x) => {
    const v = h[x.clen_id];
    if (v === true || v === 'pro') pro += x.podil;
    else if (v === false || v === 'proti') proti += x.podil;
    else mlci += x.podil;
  });
  // Jak se čte rovnost, se liší podle prahu a není to libovůle:
  // „většina" znamená VÍC než polovina — při přesné půlce nemá navrch nikdo.
  // „tři čtvrtiny" jsou naopak dosažené, když jich je přesně tolik.
  const staciRovnost = mez >= ZASADNI - 1e-9;
  const proslo = staciRovnost ? pro >= mez - 1e-9 : pro > mez + 1e-9;
  return { pro, proti, mlci, prah: mez, proslo,
    chybi: Math.max(0, mez - pro) };
}

// Kdo sám o sobě rozhodne běžnou věc, a kdo i zásadní. Vrací id, ne true —
// členovi se má říct, s kým se má bavit.
function kdoRozhoduje(radky, prah) {
  const mez = cislo(prah) || BEZNE;
  let nej = null;
  podily(radky).forEach((x) => {
    if (x.podil > mez + 1e-9 && (!nej || x.podil > nej.podil)) nej = x;
  });
  return nej ? nej.clen_id : null;
}

// ─── Odchod a převod ─────────────────────────────────────────────────────────
// Odcházející nedostává zpátky vklad, ale svůj díl dnešní hodnoty fondu. To
// je na fondu to podstatné: kdo vložil, když se dařilo, odnáší si víc; kdo
// vložil před ztrátou, míň. Vracet vklady by znamenalo, že riziko nese jen
// ten, kdo zůstal.
function odchod(radky, clenId, hodnotaFondu) {
  const p = podily(radky);
  const muj = p.filter((x) => x.clen_id === clenId)[0];
  if (!muj) return { vyplatit: 0, podil: 0, zbyli: p };
  const vyplatit = Math.round(Math.max(0, cislo(hodnotaFondu)) * muj.podil);
  const zbyli = podily((radky || []).filter((r) => r && r.clen_id !== clenId));
  return { vyplatit, podil: muj.podil, vklad: muj.vklad, zbyli };
}

// Převod dílu mezi členy. Nepřevádí se procento, ale vklad, ze kterého to
// procento vychází — jinak by se po převodu nesečetlo na sto.
function prevod(radky, zKoho, komu, castka) {
  const p = podily(radky);
  const muj = p.filter((x) => x.clen_id === zKoho)[0];
  const k = Math.max(0, Math.round(cislo(castka)));
  if (!muj || !k) return { ok: false, duvod: 'nemá co převádět' };
  if (k > muj.vklad) return { ok: false, duvod: 'tolik nedrží' };
  if (zKoho === komu) return { ok: false, duvod: 'sám sobě' };
  // Skládá se nový seznam po lidech, ne po řádcích: záporný vklad by se
  // v součtu choval jinak, než jak vypadá, a v evidenci by zůstal navždy.
  const v = vklady(radky);
  v.set(zKoho, (v.get(zKoho) || 0) - k);
  v.set(komu, (v.get(komu) || 0) + k);
  const slozene = [];
  v.forEach((castkaC, id) => { if (castkaC > 0) slozene.push({ clen_id: id, castka: castkaC }); });
  return { ok: true, radky: slozene, podily: podily(slozene) };
}

// Který práh na co. Je to herní pravidlo, ne detail obsluhy, a patří sem
// vedle prahů samotných: nákup podílu je běžné rozhodnutí, výplata z fondu
// zásadní. Rozdávat peníze má být těžší než je investovat — investice se dá
// prodat zpátky, vyplacené peníze se z cizí kapsy neberou.
const PRAHY = { koupit: BEZNE, vyplatit: ZASADNI };
const prahDruhu = (druh) => (PRAHY[druh] == null ? null : PRAHY[druh]);

// ─── Žebríček fondů ──────────────────────────────────────────────
// Kolik fond doopravdy drží: hotovost v pokladně plus podíly ve firmách
// oceněné jměním těch firem. Oceňuje se stejným číslem, jakým žebříček měří
// firmy samotné — kdyby si fond počítal hodnotu po svém, byla by ve hře dvě
// různá „kolik ta firma stojí" a hráč by nevěděl, kterému věřit.
//
// Firma bez uloženého stavu se ocení pořizovací cenou podílu. Nula by tvrdila,
// že ten podíl nestojí nic, a to je horší odhad než to, co se za něj zaplatilo.
function zebricek(aliance, clenu, drzene, jmeniFirmy) {
  const dej = (m, k) => (m && typeof m.get === 'function' ? m.get(k) : (m || {})[k]);
  const drzi = new Map();
  (drzene || []).forEach((e) => {
    if (!e || e.fond_id == null) return;
    const r = drzi.get(e.fond_id) || { hodnota: 0, firmy: new Set() };
    // Ceníme jměním firmy krát podíl. Když firmu neznáme, bereme to, co se
    // za ten podíl zaplatilo — to je cena celého podílu, ne celé firmy, takže
    // se už ničím nenásobí.
    const jm = dej(jmeniFirmy, e.firma_id);
    r.hodnota += Number.isFinite(Number(jm))
      ? Math.max(0, cislo(jm)) * Math.max(0, cislo(e.podil))
      : Math.max(0, cislo(e.cena));
    r.firmy.add(e.firma_id);
    drzi.set(e.fond_id, r);
  });
  return (aliance || []).map((a) => {
    const d = drzi.get(a.id);
    const pokl = Math.max(0, Math.round(cislo(a.pokladna)));
    return { id: a.id, nazev: a.nazev,
      clenu: Math.max(0, Math.round(cislo(dej(clenu, a.id)))),
      pokladna: pokl, firem: d ? d.firmy.size : 0,
      hodnota: Math.round(pokl + (d ? d.hodnota : 0)) };
  })
    // Prázdná aliance do žebříčku fondů nepatří — fond je to, co něco drží.
    .filter((f) => f.hodnota > 0)
    .sort((a, b) => b.hodnota - a.hodnota || a.id - b.id);
}

module.exports = { vklady, podily, rozdeleni, hlasovani, kdoRozhoduje, odchod, prevod,
  prahDruhu, PRAHY, BEZNE, ZASADNI, zebricek };
