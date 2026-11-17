// =============================================================================
// Měna skutečných plateb podle jazyka hráče
// =============================================================================
// Ceny v ceníku jsou v haléřích, protože hra začala v korunách. Kdo hraje
// anglicky, ale nemá platit v korunách — nezná je a kurz si v hlavě nepřepočítá.
//
// Zásadní je, že převod je na JEDNOM místě. Cena, kterou hráč vidí, a cena,
// kterou mu strhne Stripe, musí vzniknout stejným výpočtem; kdyby se počítaly
// zvlášť, dřív nebo později se rozejdou o cent a hráč se bude právem ptát.
//
// Kurz drží nastavení hry (kurz_eur), aby se nemusel kvůli pohybu kurzu
// nasazovat nový kód.
'use strict';

const { prisma } = require('../../config/database');

const KURZ_VYCHOZI = 25;           // Kč za euro, když v nastavení nic není
const MENY = {
  czk: { kod: 'czk', znak: 'Kč', des: 0, krok: 100 },   // zaokrouhluje na celé koruny
  eur: { kod: 'eur', znak: '€',  des: 2, krok: 10 },    // zaokrouhluje na deset centů
};

// Rozhoduje jazyk, ne země. Hráč si ho přepíná sám a je to jediný signál,
// u kterého víme, že ho zvolil vědomě.
function menaProJazyk(jazyk) {
  return String(jazyk || 'cs') === 'cs' ? 'czk' : 'eur';
}

let _kurz = { at: 0, v: KURZ_VYCHOZI };
async function kurzEur() {
  if (Date.now() - _kurz.at < 300e3) return _kurz.v;
  let v = KURZ_VYCHOZI;
  try {
    const r = await prisma.gameSetting.findUnique({ where: { klic: 'kurz_eur' } });
    const n = Number(r && r.hodnota);
    if (isFinite(n) && n > 0) v = n;
  } catch (e) { /* bez nastavení jede výchozí */ }
  _kurz = { at: Date.now(), v };
  return v;
}

// Haléře → nejmenší jednotka cílové měny. Zaokrouhluje se vždycky NAHORU na
// celý krok: dolů by to znamenalo prodávat pod cenou kvůli kurzu, a drobné
// ocásky typu 1,96 € vypadají v ceníku jako chyba.
function prepoctiS(halere, mena, kurz) {
  const m = MENY[mena] || MENY.czk;
  const hrube = (Number(halere) || 0) / (mena === 'eur' ? (kurz || KURZ_VYCHOZI) : 1);
  return Math.max(m.krok, Math.ceil(hrube / m.krok) * m.krok);
}

// Pro jednu cenu. Vrací i částku k zobrazení, ať si ji nikdo nepočítá sám.
async function cenaProJazyk(halere, jazyk) {
  const mena = menaProJazyk(jazyk);
  const kurz = await kurzEur();
  const castka = prepoctiS(halere, mena, kurz);
  return { mena, castka, zobrazit: castka / 100, znak: MENY[mena].znak, des: MENY[mena].des };
}

// Pro celý ceník naráz — jeden dotaz na kurz místo čtyřiceti.
async function prevodnik(jazyk) {
  const mena = menaProJazyk(jazyk);
  const kurz = await kurzEur();
  const m = MENY[mena];
  return {
    mena, znak: m.znak, des: m.des, kurz,
    // halere → částka v nejmenší jednotce cílové měny
    halere: (x) => prepoctiS(x, mena, kurz),
    // halere → číslo k zobrazení (koruny / eura)
    zobraz: (x) => prepoctiS(x, mena, kurz) / 100,
  };
}

module.exports = { MENY, menaProJazyk, kurzEur, cenaProJazyk, prevodnik, KURZ_VYCHOZI };
