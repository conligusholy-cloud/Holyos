// =============================================================================
// Laundromat Tycoon — nouzová brzda na burzu
// =============================================================================
// Když se ukáže díra, která se dá zneužít, nebo se něco rozbije uprostřed
// provozu, je potřeba umět zastavit obchod dřív, než se stihne nasadit
// oprava. Zapíná se jedním nastavením (obchod_pozastaven), takže bez
// nasazování a bez zásahu do něčí uložené hry.
//
// Zastaví se jen to, čím vzniká NOVÝ závazek. Rozjeté věci se doběhnout
// nechají: přijmout, odmítnout, splatit, vyzvednout doručenku, stáhnout
// vlastní inzerát, odejít z aliance, vyhlásit konkurz. Jinak by brzda
// zamkla hráče uprostřed rozjednaného obchodu a vypadalo by to jako chyba.
//
// Seznam je tu schválně zvlášť od obsluhy: je to jediné místo, kde se dá
// omylem zastavit něco, co se zastavit nemělo, a dá se to otestovat bez
// databáze.

'use strict';

const CESTY = [
  /^\/trade\/offer$/,                   // nová nabídka, včetně půjček
  /^\/trade\/\d+\/counter$/,            // protinávrh je taky nová nabídka
  /^\/trade\/prevzeti$/,                // vyhlášení nabídky na převzetí
  /^\/trade\/aliance$/,                 // založení aliance
  /^\/trade\/aliance\/pozvat$/,
  /^\/trade\/aliance\/fond\/vklad$/,   // nový vklad do fondu je nový závazek
  /^\/trade\/aliance\/fond\/prevod$/,
  /^\/trade\/aliance\/fond\/navrh$/,  // nový návrh je nový závazek fondu
  /^\/trade\/aliance\/fond\/navrh\/[^/]+\/provest$/,
  // Nabídka podílu fondu zvenču: nová nabídka i protinávrh zakládají závazek,
  // takže se zastavují. Odpověď majitele a stažení vlastní nabídky ne — to
  // už je dokončování rozjednané věci a brzda nemá nikoho zamykat uprostřed.
  /^\/trade\/fond\/nabidka$/,
  // Zpětný odkup podílu od fondu je totéž obráceně: nový závazek na obou
  // stranách — fond pouští kus portfolia, majitel se zavazuje zaplatit.
  /^\/trade\/fond\/odkup-zpet$/,
  /^\/trade\/aliance\/fond\/navrh\/[^/]+\/protinavrh$/,

  // Akcie fondu: obchod je jediná cesta, kterou se hýbe cenou, a mění
  // hotovost i pokladnu fondu. Při díře stojí.
  /^\/trade\/akcie\/[^/]+\/obchod$/,

  /^\/trade\/trh$/,                     // nový inzerát na trhu
  /^\/trade\/trh\/\d+\/koupit$/,
  /^\/trade\/aukce\/[^/]+\/koupit$/,
  /^\/trade\/drazba$/,                  // vypsání dražby
  /^\/trade\/drazba\/prihoz$/,
];

// Platí jen na POST — čtení přehledů brzda nezastavuje, hráč musí pořád
// vidět, co má rozjednané.
function zastavit(metoda, cesta) {
  if (String(metoda || '').toUpperCase() !== 'POST') return false;
  return CESTY.some((re) => re.test(String(cesta || '')));
}

// Je brzda zatažená? Nastavení je text, ne číslo — bere se jen přesná
// jednička, aby se to nedalo zapnout omylem překlepem.
function zataseno(nastaveni) {
  return String((nastaveni || {}).obchod_pozastaven || '') === '1';
}

module.exports = { CESTY, zastavit, zataseno };
