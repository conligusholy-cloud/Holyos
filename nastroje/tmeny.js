#!/usr/bin/env node
// Měna skutečných plateb. Podstatné je, že cena, kterou hráč vidí, vznikla
// stejným výpočtem jako ta, kterou mu strhne Stripe — kdyby se počítaly zvlášť,
// rozešly by se o cent a hráč se bude právem ptát.
'use strict';
const KURZ = 25;
const MENY = { czk: { krok: 100, des: 0 }, eur: { krok: 10, des: 2 } };
const prepocti = (halere, mena, kurz) => {
  const m = MENY[mena];
  const hrube = (Number(halere) || 0) / (mena === 'eur' ? kurz : 1);
  return Math.max(m.krok, Math.ceil(hrube / m.krok) * m.krok);
};
let chyb = 0;
const zkus = (co, p) => { console.log((p ? 'OK   ' : 'CHYBA') + '  ' + co); if (!p) chyb++; };

const CENIK = [4900, 7400, 9900, 29000, 99900, 10000, 20000, 50000, 100000, 200000,
  50000, 100000, 200000, 300000, 500000, 3900, 12900, 7900];

console.log('koruny beze změny:');
CENIK.slice(0, 4).forEach((h) => {
  const v = prepocti(h, 'czk', KURZ);
  zkus((h / 100) + ' Kč zůstává ' + (v / 100) + ' Kč', v === h);
});

console.log('\npřevod na eura:');
[[4900, 200], [7400, 300], [9900, 400], [29000, 1160], [99900, 4000],
 [300000, 12000], [1500000, 60000], [3900, 160]].forEach(([h, ceka]) => {
  const v = prepocti(h, 'eur', KURZ);
  zkus((h / 100) + ' Kč → ' + (v / 100).toFixed(2) + ' €', v === ceka);
});

console.log('\npravidla:');
zkus('nikdy se nezaokrouhluje dolů (neprodáváme pod cenou)',
  CENIK.every((h) => prepocti(h, 'eur', KURZ) >= h / KURZ - 0.001));
zkus('vždycky na celých deset centů',
  CENIK.every((h) => prepocti(h, 'eur', KURZ) % 10 === 0));
zkus('nikdy zadarmo', CENIK.every((h) => prepocti(h, 'eur', KURZ) >= 10));
zkus('větší balíček nikdy nestojí míň než menší', (() => {
  const r = [4900, 7400, 9900, 29000, 99900].map((h) => prepocti(h, 'eur', KURZ));
  return r.every((v, i) => i === 0 || v >= r[i - 1]);
})());
zkus('stejný vstup dává pokaždé stejný výsledek',
  CENIK.every((h) => prepocti(h, 'eur', KURZ) === prepocti(h, 'eur', KURZ)));

console.log('\nkurz z nastavení:');
[20, 24.5, 25, 27].forEach((k) => {
  const v = prepocti(9900, 'eur', k);
  zkus('při kurzu ' + k + ' stojí 99 Kč ' + (v / 100).toFixed(2) + ' € a je to nad holým převodem',
    v / 100 >= 99 / k - 0.001);
});

console.log('\n' + (chyb ? chyb + ' chyb' : 'bez chyb'));
process.exit(chyb ? 1 : 0);
