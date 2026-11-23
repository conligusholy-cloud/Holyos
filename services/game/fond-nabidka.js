// =============================================================================
// Laundromat Tycoon — nabídka podílu fondu
// =============================================================================
// Dosud všechny návrhy ve fondu vznikaly uvnitř: člen něco navrhl, členové
// hlasovali. Tohle je návrh ZVENČÍ — majitel firmy nabídne fondu podíl ve
// své firmě a fond se o tom rozhoduje stejným hlasováním jako o čemkoli
// jiném. Autorem návrhu je tedy člověk, který ve fondu není a hlasovat v něm
// nesmí; proto si nepřipisuje hlas „pro" jako vnitřní navrhovatel.
//
// Smlouvá se jedno kolo: fond může místo přijetí odhlasovat jinou cenu nebo
// jiné procento a nabídka se vrátí majiteli, který ji přijme, nebo odmítne.
// Druhé kolo není — bez stropu by se dalo protinávrhy donekonečna blokovat
// a každé kolo je nové hlasování, tedy další den čekání.
//
// Tenhle modul je jen pravidla a počty. Databáze, doručenky a peníze jsou
// v routes/game-trade.routes.js.
'use strict';

const PODIL_MIN = 0.01;        // míň než procento nemá smysl nabízet
const PODIL_MAX = 1;
const VETSINA = 0.5;
const CENA_MIN = 1000;         // dno za celou nabídku, ne za procento

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const zaokr = (x) => Math.max(0, Math.round(cislo(x)));

// Podmínky, které na stole platí teď: buď původní nabídka, nebo protinávrh
// fondu, když nějaký je. Všechno ostatní se ptá tudy, aby se nikde nepočítalo
// z čísla, které už neplatí.
function naStole(detail) {
  const d = detail || {};
  const p = d.protinavrh;
  if (p && Number.isFinite(Number(p.podil)) && Number.isFinite(Number(p.cena))) {
    return { podil: cislo(p.podil), cena: zaokr(p.cena), protinavrh: true };
  }
  return { podil: cislo(d.podil), cena: zaokr(d.cena), protinavrh: false };
}

// Smí fond ještě protinávrh podat? Jen jednou — viz hlavička.
function smiProtinavrh(detail) {
  return !((detail || {}).protinavrh);
}

// Je nabídka sama o sobě v pořádku? prodano je, kolik firmy už je prodáno
// jinam, volne jsou volné peníze fondu (pokladna mínus to, co je slíbené
// ve vyvěšených nabídkách).
function zkontroluj(podil, cena, prodano, volne) {
  const p = cislo(podil), c = zaokr(cena);
  if (!(p >= PODIL_MIN - 1e-9)) return { ok: false, duvod: 'podil_maly' };
  if (p > PODIL_MAX + 1e-9) return { ok: false, duvod: 'podil_velky' };
  if (c < CENA_MIN) return { ok: false, duvod: 'cena_mala' };
  // Víc než sto procent firmy prodat nejde, ani po kouskách.
  if (cislo(prodano) + p > PODIL_MAX + 1e-9) return { ok: false, duvod: 'uz_prodano' };
  // O penězích, které fond nemá, nemá smysl hlasovat den a pak zjistit,
  // že to nejde provést.
  if (c > zaokr(volne)) return { ok: false, duvod: 'fond_nema' };
  return { ok: true };
}

// ─── Opačný směr: majitel kupuje podíl zpátky od fondu ───────────────────────
// Smlouvá se stejně (jedno kolo protinávrhu), jen se hlídá něco jiného:
// fond nemůže prodat víc, než drží, a majitel musí mít na to, co nabídl.
// Peníze fondu přibydou, takže se nekontroluje jeho pokladna.
function zkontrolujZpet(podil, cena, drziFond, hotovost) {
  const p = cislo(podil), c = zaokr(cena);
  if (!(p >= PODIL_MIN - 1e-9)) return { ok: false, duvod: 'podil_maly' };
  if (c < CENA_MIN) return { ok: false, duvod: 'cena_mala' };
  // Fond víc, než má, prodat nemůže — a nula znamená, že v té firmě není.
  if (!(cislo(drziFond) > 0)) return { ok: false, duvod: 'fond_nedrzi' };
  if (p > cislo(drziFond) + 1e-9) return { ok: false, duvod: 'fond_tolik_nedrzi' };
  // O penězích, které kupující nemá, nemá smysl hlasovat den a pak zjistit,
  // že to nejde provést.
  if (c > zaokr(hotovost)) return { ok: false, duvod: 'majitel_nema' };
  return { ok: true };
}

// Kolik fondu v té firmě zbyde a jestli mu zůstane většina.
function nasledkyZpet(podil, drziTed) {
  const zbyde = Math.max(0, cislo(drziTed) - cislo(podil));
  return { podil_po: Math.round(zbyde * 1000) / 1000, vetsina: zbyde > 0.5 + 1e-9 };
}

// Co se stane, až to projde. drziTed je, kolik té firmy fond drží dnes —
// obě strany mají předem vidět, jestli tím fond získá většinu. Fond rozhoduje
// kolektivně a zpátky se to nekoupí, takže tohle se nesmí dozvědět až potom.
function nasledky(podil, drziTed) {
  const po = cislo(drziTed) + cislo(podil);
  return { podil_po: po, vetsina: po > VETSINA + 1e-9 };
}

module.exports = { naStole, smiProtinavrh, zkontroluj, nasledky,
  zkontrolujZpet, nasledkyZpet,
  PODIL_MIN, PODIL_MAX, VETSINA, CENA_MIN };
