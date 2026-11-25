// =============================================================================
// Laundromat Tycoon — kniha příkazů (burza akcií mezi hráči)
// =============================================================================
// Akcie fondu mají dvě patra, stejně jako doopravdy:
//
//   1. ÚPIS. Fond odhlasuje počet kusů a cenu a ty kusy rozprodá. Cena je po
//      celý úpis pevná — fond neprodává dráž tomu, kdo přišel později.
//   2. BURZA. Co je jednou upsané, se obchoduje mezi akcionáři. Fond je z toho
//      venku: nevykupuje a nedoprodává. Cenu dělá nabídka a poptávka.
//
// Dřív byl protistranou vždycky fond a cena se posouvala podle objemu obchodu.
// Bylo to pohodlné — koupit i prodat šlo kdykoli — ale nebyl to trh: nikdo
// nikomu nic nenabízel a cena byla vzoreček, ne dohoda dvou lidí.
//
// Jak se tu obchoduje:
//
//   • Příkaz je limitní. „Koupím 50 kusů, nejvýš za 1 200" nebo „prodám 50,
//     nejméně za 1 400". Nic jako příkaz za jakoukoli cenu tu není — jednou
//     se tím dala položit nabídka za deset korun a vypadalo to divně.
//   • Páruje se za cenu STARŠÍHO příkazu. Kdo byl v knize dřív, určuje cenu;
//     rozdíl si odnáší ten, kdo přišel později. Tak to chodí na burze a je to
//     jediná odměna za to, že někdo nabídku položil jako první.
//   • Cena akcie je poslední uzavřený obchod. Žádný umělý posun podle objemu.
//   • Cenové pásmo: příkaz dál než PASMO od poslední ceny se nepřijme. Pásmo
//     se posouvá s každým obchodem, takže cena může jít kamkoli — jen ne
//     skokem a ne proto, že se někdo ukliknul o nulu.
//   • Sám se sebou hráč neobchoduje. Svoje vlastní příkazy se při párování
//     přeskakují: jinak by si cenu hnul, kam by chtěl, a nic by ho to nestálo.
//
// Tenhle modul je jen pravidla a počty. Databáze, peníze a doručenky jsou
// v routes/game-trade.routes.js.
'use strict';

const CENA_MIN = 1;
const CENA_MAX = 1000000000;
const POCET_MIN = 1;
const POCET_MAX = 1000000;
// Jak daleko od poslední ceny smí příkaz ležet. Třicet procent je dost na to,
// aby se cena za pár obchodů dostala kamkoli, a málo na to, aby ji jeden
// překlep poslal na měsíc.
const PASMO = 0.3;
// Kolik příkazů od hráče může v knize jednoho fondu ležet. Bez stropu by se
// kniha dala zaplavit stovkou kusů po jednom.
const PRIKAZU_MAX = 10;

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const kusy = (x) => Math.max(0, Math.floor(cislo(x)));
const penize = (x) => Math.max(0, Math.round(cislo(x)));

// Co jeden příkaz stojí (nebo vynese) celý.
function castka(cena, pocet) {
  return penize(cena) * kusy(pocet);
}

// Meze cenového pásma kolem dnešní ceny. Bez ceny (fond ještě neupsal) nemá
// pásmo od čeho měřit a nepouští se nic — příkaz by stejně neměl protistranu.
function mez(cenaTed) {
  const c = penize(cenaTed);
  if (!(c > 0)) return null;
  return {
    min: Math.max(CENA_MIN, Math.round(c * (1 - PASMO))),
    max: Math.min(CENA_MAX, Math.round(c * (1 + PASMO))),
  };
}

// Smí ten příkaz do knihy?
//
// stav: { cenaTed, volna_hotovost, volne_akcie, mych_prikazu }
// Kontroluje se tu všechno, co se dá spočítat předem. Souběh (někdo koupil
// mezitím) hlídá až zápis do databáze — ten má poslední slovo.
function zkontroluj(prikaz, stav) {
  const p = prikaz || {};
  const s = stav || {};
  const smer = p.smer === 'koupit' ? 'koupit' : (p.smer === 'prodat' ? 'prodat' : null);
  const n = kusy(p.pocet);
  const c = penize(p.cena);
  if (!smer) return { ok: false, duvod: 'smer' };
  if (n < POCET_MIN) return { ok: false, duvod: 'pocet_maly' };
  if (n > POCET_MAX) return { ok: false, duvod: 'pocet_velky' };
  if (c < CENA_MIN) return { ok: false, duvod: 'cena_mala' };
  if (c > CENA_MAX) return { ok: false, duvod: 'cena_velka' };
  const m = mez(s.cenaTed);
  if (!m) return { ok: false, duvod: 'bez_ceny' };
  if (c < m.min || c > m.max) return { ok: false, duvod: 'mimo_pasmo', mez: m };
  if (kusy(s.mych_prikazu) >= PRIKAZU_MAX) return { ok: false, duvod: 'prikazu_moc' };
  if (smer === 'koupit') {
    // Pod nákupním příkazem musí ležet peníze. Je to slib: kdokoli mi do něj
    // může prodat a já musím zaplatit. Jedněmi penězi se deset příkazů
    // podložit nedá.
    if (castka(c, n) > penize(s.volna_hotovost)) return { ok: false, duvod: 'nemas_hotovost' };
  } else {
    // A pod prodejním musí ležet akcie — ty, co nejsou pod jiným příkazem.
    if (n > kusy(s.volne_akcie)) return { ok: false, duvod: 'tolik_nedrzis' };
  }
  return { ok: true, smer, pocet: n, cena: c, castka: castka(c, n), mez: m };
}

// Protistrana seřazená tak, jak se má odbavovat: nejdřív nejvýhodnější cena,
// při shodě ten, kdo přišel dřív. Tohle pořadí je celé pravidlo přednosti —
// cena, pak čas.
function serad(prikazy, smerNoveho) {
  const l = (prikazy || []).slice();
  const kdy = (p) => new Date(p.created_at || 0).getTime() || 0;
  l.sort((a, b) => {
    // Kupující chce nejlevnějšího prodávajícího, prodávající nejdražšího kupce.
    const rozdil = smerNoveho === 'koupit'
      ? penize(a.cena) - penize(b.cena)
      : penize(b.cena) - penize(a.cena);
    if (rozdil) return rozdil;
    const cas = kdy(a) - kdy(b);
    if (cas) return cas;
    return (a.id || 0) - (b.id || 0);
  });
  return l;
}

// Spáruj nový příkaz s knihou. Vrací seznam obchodů, co z příkazu zbylo
// a za kolik se naposledy obchodovalo — to je nová cena akcie.
//
// kniha jsou příkazy OPAČNÉHO směru; seřadí se tu, ať na pořadí nezáleží.
function sparuj(novy, kniha) {
  const p = novy || {};
  const smer = p.smer === 'koupit' ? 'koupit' : 'prodat';
  const limit = penize(p.cena);
  const ja = cislo(p.player_id);
  let zbyva = kusy(p.pocet);
  const obchody = [];
  serad(kniha, smer).forEach((o) => {
    if (zbyva <= 0) return;
    // Sám se sebou hráč neobchoduje: byl by to posun ceny zadarmo.
    if (ja && cislo(o.player_id) === ja) return;
    const c = penize(o.cena);
    const sejde = smer === 'koupit' ? c <= limit : c >= limit;
    if (!sejde) return;
    const n = Math.min(zbyva, kusy(o.pocet));
    if (n <= 0) return;
    // Obchod se uzavře za cenu toho, kdo byl v knize dřív.
    obchody.push({ prikaz_id: o.id, player_id: cislo(o.player_id), pocet: n, cena: c });
    zbyva -= n;
  });
  const zobchodovano = obchody.reduce((a, o) => a + o.pocet, 0);
  return {
    obchody,
    zbyva,
    zobchodovano,
    castka: obchody.reduce((a, o) => a + castka(o.cena, o.pocet), 0),
    // Poslední obchod je nová cena akcie. Bez obchodu se cena nehýbe.
    cena_po: obchody.length ? obchody[obchody.length - 1].cena : 0,
  };
}

// Hloubka knihy pro hru: kusy sečtené po cenách, od nejlepší nabídky dolů.
// Hráč nepotřebuje vidět, kdo co zadal — potřebuje vidět, kde je trh.
function hloubka(prikazy, kolik) {
  const l = (prikazy || []).filter((p) => kusy(p.pocet) > 0);
  const sloz = (smer) => {
    const mapa = new Map();
    l.filter((p) => p.smer === smer).forEach((p) => {
      const c = penize(p.cena);
      mapa.set(c, (mapa.get(c) || 0) + kusy(p.pocet));
    });
    const radky = Array.from(mapa.entries()).map(([cena, pocet]) => ({ cena, pocet }));
    // Poptávka od nejvyšší ceny, nabídka od nejnižší — nahoře je vždycky to,
    // co se zobchoduje jako první.
    radky.sort((a, b) => (smer === 'koupit' ? b.cena - a.cena : a.cena - b.cena));
    return radky.slice(0, Math.max(1, kolik || 8));
  };
  const poptavka = sloz('koupit');
  const nabidka = sloz('prodat');
  return {
    poptavka,
    nabidka,
    // Nejlepší cena na každé straně. Mezi nimi je rozpětí — tam se trh potkává.
    nejlepsi_poptavka: poptavka.length ? poptavka[0].cena : 0,
    nejlepsi_nabidka: nabidka.length ? nabidka[0].cena : 0,
  };
}

// Kolik akcií má hráč pod prodejními příkazy. O ty se nesmí opřít další
// příkaz — jinak by jedny kusy prodal dvakrát.
function zamceneAkcie(prikazy) {
  return (prikazy || []).filter((p) => p.smer === 'prodat')
    .reduce((a, p) => a + kusy(p.pocet), 0);
}

// Kolik peněz je slíbeno pod nákupními příkazy. Tohle si bere rezervace.js
// a odečítá to z volné hotovosti.
function zamcenePenize(prikazy) {
  return (prikazy || []).filter((p) => p.smer === 'koupit')
    .reduce((a, p) => a + castka(p.cena, p.pocet), 0);
}

module.exports = { castka, mez, zkontroluj, serad, sparuj, hloubka,
  zamceneAkcie, zamcenePenize,
  CENA_MIN, CENA_MAX, POCET_MIN, POCET_MAX, PASMO, PRIKAZU_MAX };
