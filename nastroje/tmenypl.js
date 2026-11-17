#!/usr/bin/env node
// Měny ceníku: dolary a zloté jsou připravené dřív, než se pustí další řeč.
// Nejde jen o kurz — hlídá se hlavně to, aby se nikdy neukázalo číslo v jedné
// měně se značkou jiné a aby jazyk neuměl ukázat na měnu, za kterou Stripe
// nic nestrhne. Jede proti opravdovému modulu, ne proti kopii výpočtu.
'use strict';
const M = require('../services/game/meny-jadro');

let chyb = 0;
const zkus = (co, p) => { console.log((p ? 'OK   ' : 'CHYBA') + '  ' + co); if (!p) chyb++; };

const KURZY = { czk: 1, eur: 25, usd: 23, pln: 6 };
// Ceník: balíky peněz, karty, předplatné, rámec. V haléřích.
const CENIK = [4900, 7400, 9900, 29000, 99900, 10000, 20000, 50000, 100000,
  200000, 300000, 500000, 1500000, 3900, 12900, 7900, 19500];

console.log('tabulka měn:');
zkus('jsou všechny čtyři (czk, eur, usd, pln)',
  ['czk', 'eur', 'usd', 'pln'].every((k) => !!M.MENY[k]));
zkus('nic nechybí a nic nepřebývá', M.potize(KURZY, null).join(' | ') === '');
zkus('dolar má značku před číslem', M.MENY.usd.pred === true);
zkus('zlotý má značku za číslem', M.MENY.pln.pred === false);
zkus('zlotý je zł, ne zl ani PLN', M.MENY.pln.znak === 'zł');
zkus('koruna se nepřepočítává (kurz 1)', M.KURZY_VYCHOZI.czk === 1);

console.log('\njazyk → měna:');
[['cs', 'czk'], ['en', 'eur'], ['pl', 'pln']].forEach(([j, m]) => {
  zkus(j + ' platí v ' + m, M.menaZMapy(j, null) === m);
});
zkus('neznámá řeč platí v eurech, ne v korunách', M.menaZMapy('hu', null) === 'eur');
zkus('nastavení přemapuje en na dolary', M.menaZMapy('en', { en: 'usd' }) === 'usd');
zkus('nesmysl v nastavení se zahodí a jede výchozí měna',
  M.menaZMapy('pl', { pl: 'rub' }) === 'pln');
zkus('a nahlásí se jako potíž',
  M.potize(KURZY, { pl: 'rub' }).some((x) => /neznámou měnu rub/.test(x)));
zkus('měna bez kurzu se nahlásí',
  M.potize({ czk: 1, eur: 25, usd: 23 }, null).some((x) => /pln nemá kurz/.test(x)));

console.log('\npřevod — zloté (kurz 6):');
[[4900, 820], [7400, 1240], [9900, 1650], [29000, 4840], [99900, 16650]].forEach(([h, ceka]) => {
  const v = M.prepoctiS(h, 'pln', KURZY);
  zkus((h / 100) + ' Kč → ' + (v / 100).toFixed(2) + ' zł', v === ceka);
});
console.log('\npřevod — dolary (kurz 23):');
[[4900, 220], [9900, 440], [29000, 1270], [99900, 4350]].forEach(([h, ceka]) => {
  const v = M.prepoctiS(h, 'usd', KURZY);
  zkus((h / 100) + ' Kč → $' + (v / 100).toFixed(2), v === ceka);
});

console.log('\npravidla pro všechny cizí měny:');
['eur', 'usd', 'pln'].forEach((m) => {
  const k = KURZY[m];
  zkus(m + ': nikdy dolů (neprodáváme pod cenou)',
    CENIK.every((h) => M.prepoctiS(h, m, KURZY) >= h / k - 0.001));
  zkus(m + ': vždycky na celých deset centů',
    CENIK.every((h) => M.prepoctiS(h, m, KURZY) % 10 === 0));
  zkus(m + ': nikdy zadarmo', CENIK.every((h) => M.prepoctiS(h, m, KURZY) >= 10));
  zkus(m + ': dražší balík nikdy nestojí míň',
    (() => { const r = [4900, 7400, 9900, 29000, 99900].map((h) => M.prepoctiS(h, m, KURZY));
      return r.every((v, i) => i === 0 || v >= r[i - 1]); })());
});
zkus('koruny zůstávají beze změny', CENIK.every((h) => M.prepoctiS(h, 'czk', KURZY) === h));

console.log('\nsoučty v adminu:');
zkus('100 zł se sečte jako 600 Kč', M.naKoruny(10000, 'pln', KURZY) === 600);
zkus('100 $ se sečte jako 2 300 Kč', M.naKoruny(10000, 'usd', KURZY) === 2300);
zkus('100 Kč zůstává 100 Kč', M.naKoruny(10000, 'czk', KURZY) === 100);
zkus('neznámá měna se bere jako koruny, ne jako nula', M.naKoruny(10000, 'xxx', KURZY) === 100);

console.log(chyb ? '\n' + chyb + ' CHYB' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
