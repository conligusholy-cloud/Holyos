#!/usr/bin/env node
// Zkouška vyrovnání při ukončení hry — bez databáze. Ověřuje, že se rozdělí
// přesně to, co hráč má, a že nic nevzniká z ničeho.
'use strict';
const cele = (x) => Math.max(0, Math.round(Number(x) || 0));

// Rozdělení je vytažené z konec.js doslova — obě cesty (ukončení hry i úklid
// podílů v mrtvé firmě) používají jednu funkci, takže ji stačí zkoušet jednou.
function rozdel(kDeleni, naroky) {
  const suma = naroky.reduce((a, b) => a + b, 0);
  let rozdano = 0;
  return naroky.map((dluh, i) => {
    const posledni = i === naroky.length - 1;
    const navrh = suma <= 0 ? 0
      : (posledni ? (kDeleni - rozdano) : Math.round(kDeleni * (dluh / suma)));
    const dam = Math.max(0, Math.min(navrh, dluh, kDeleni - rozdano));
    rozdano += dam;
    return dam;
  });
}

// Stejný výpočet jako v konec.js, jen nad daty v paměti.
function vyrovnej(hotovost, pujcky, podily) {
  let zbyva = cele(hotovost);
  const out = { lenderum: 0, odepsanoPujcky: 0, investorum: 0, odepsanoPodily: 0 };
  pujcky.forEach((p) => {
    const dluh = cele(p.splatka * Math.max(0, p.mesicu - p.splaceno));
    const dam = Math.min(zbyva, dluh);
    zbyva -= dam;
    out.lenderum += dam;
    out.odepsanoPujcky += dluh - dam;
  });
  const nevraceno = podily.map((e) => Math.max(0, cele(e.cena) - cele(e.vyplaceno)));
  const suma = nevraceno.reduce((a, b) => a + b, 0);
  const kDeleni = suma > 0 ? Math.min(zbyva, suma) : 0;
  zbyva -= kDeleni;
  const dily = rozdel(kDeleni, nevraceno);
  nevraceno.forEach((d, i) => {
    out.investorum += dily[i];
    out.odepsanoPodily += d - dily[i];
  });
  zbyva += kDeleni - dily.reduce((a, b) => a + b, 0);
  out.zbylo = zbyva;
  return out;
}

let chyb = 0;
const zkus = (co, podm) => { console.log((podm ? 'OK   ' : 'CHYBA') + '  ' + co); if (!podm) chyb++; };

// 1) Dost na všechno
let v = vyrovnej(1000000, [{ splatka: 100000, mesicu: 3, splaceno: 0 }], [{ cena: 400000, vyplaceno: 100000 }]);
console.log('1)', JSON.stringify(v));
zkus('věřitel dostal celou půjčku 300 000', v.lenderum === 300000);
zkus('investor dostal nevrácených 300 000', v.investorum === 300000);
zkus('nic se neodepsalo', v.odepsanoPujcky === 0 && v.odepsanoPodily === 0);
zkus('zbylo 400 000', v.zbylo === 400000);

// 2) Nedost: půjčka má přednost před podílem
v = vyrovnej(200000, [{ splatka: 100000, mesicu: 3, splaceno: 0 }], [{ cena: 500000, vyplaceno: 0 }]);
console.log('2)', JSON.stringify(v));
zkus('věřiteli šlo všech 200 000', v.lenderum === 200000);
zkus('na podíl nezbylo nic', v.investorum === 0);
zkus('odepsáno 100 000 z půjčky a 500 000 z podílu', v.odepsanoPujcky === 100000 && v.odepsanoPodily === 500000);

// 3) Dva investoři, dělí se poměrně
v = vyrovnej(300000, [], [{ cena: 400000, vyplaceno: 0 }, { cena: 200000, vyplaceno: 0 }]);
console.log('3)', JSON.stringify(v));
zkus('rozdělilo se přesně 300 000', v.investorum === 300000);
zkus('nic nezbylo', v.zbylo === 0);

// 4) Nula hotovosti — nikomu nic, ale všechno se odepíše (nic nevisí)
v = vyrovnej(0, [{ splatka: 50000, mesicu: 4, splaceno: 1 }], [{ cena: 100000, vyplaceno: 0 }]);
console.log('4)', JSON.stringify(v));
zkus('nikomu nic nepřišlo', v.lenderum === 0 && v.investorum === 0);
zkus('odepsalo se 150 000 a 100 000', v.odepsanoPujcky === 150000 && v.odepsanoPodily === 100000);

// 5) Podíl už se vrátil celý — nemá nárok na nic
v = vyrovnej(500000, [], [{ cena: 300000, vyplaceno: 400000 }]);
console.log('5)', JSON.stringify(v));
zkus('investorovi nic (už dostal víc, než dal)', v.investorum === 0);
zkus('hotovost zůstala nedotčená', v.zbylo === 500000);

// 6) Nic nevzniká z ničeho — vyplacené nikdy nepřekročí hotovost
for (let i = 0; i < 500; i++) {
  const h = Math.floor(Math.random() * 2000000);
  const p = Array.from({ length: Math.floor(Math.random() * 4) }, () => ({
    splatka: Math.floor(Math.random() * 90000) + 1000, mesicu: Math.floor(Math.random() * 24) + 1, splaceno: 0 }));
  const e = Array.from({ length: Math.floor(Math.random() * 4) }, () => ({
    cena: Math.floor(Math.random() * 900000), vyplaceno: Math.floor(Math.random() * 300000) }));
  const r = vyrovnej(h, p, e);
  if (r.lenderum + r.investorum + r.zbylo !== h) {
    console.log('CHYBA  nesedí součet při hotovosti ' + h + ': ' + JSON.stringify(r)); chyb++; break;
  }
}
zkus('na 500 náhodných případech sedí součet na korunu', chyb === 0);

console.log('\n' + (chyb ? chyb + ' chyb' : 'bez chyb'));
process.exit(chyb ? 1 : 0);
