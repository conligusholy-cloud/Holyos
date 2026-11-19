// Žebříček fondů — kolik fond doopravdy drží.
//
// Je to jediné místo ve hře, kde se o cizím fondu říká číslo veřejně. Když
// bude špatně, nikdo to nepozná: hráči nemají jak si hodnotu cizího fondu
// přepočítat. Proto se tu kontroluje i to, co vypadá samozřejmě — že se
// pokladna přičítá, že podíl se násobí jměním té správné firmy a že se dva
// fondy nikdy nesečtou dohromady.
const FOND = require('../services/game/fond');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const blizko = (a, b) => Math.abs(a - b) < 0.51;

const AL = [{ id: 1, nazev: 'Alfa', pokladna: 1000000 },
  { id: 2, nazev: 'Beta', pokladna: 0 },
  { id: 3, nazev: 'Prázdná', pokladna: 0 }];
const CLENU = new Map([[1, 4], [2, 2]]);
const JM = new Map([[10, 8000000], [11, 2000000]]);

// Alfa: milion v pokladně a čtvrtina firmy 10 za 2 miliony → 1 + 2 = 3 miliony.
// Beta: nic v pokladně, polovina firmy 11 → milion.
const DRZENE = [
  { fond_id: 1, firma_id: 10, podil: 0.25, cena: 1500000 },
  { fond_id: 2, firma_id: 11, podil: 0.5, cena: 900000 },
];

let z = FOND.zebricek(AL, CLENU, DRZENE, JM);
ok('prázdná aliance v žebříčku není', z.length === 2, '— ' + z.length);
ok('první je Alfa', z[0].nazev === 'Alfa');
ok('a má pokladnu i podíl', blizko(z[0].hodnota, 3000000), '— ' + z[0].hodnota);
ok('druhá je Beta se samotným podílem',
  z[1].nazev === 'Beta' && blizko(z[1].hodnota, 1000000), '— ' + z[1].hodnota);
ok('pokladna jde ven zvlášť', z[0].pokladna === 1000000 && z[1].pokladna === 0);
ok('počet členů sedí', z[0].clenu === 4 && z[1].clenu === 2);
ok('počet firem sedí', z[0].firem === 1 && z[1].firem === 1);

// Dva podíly v jedné firmě jsou pořád jedna firma, ale hodnota se sečte.
z = FOND.zebricek([AL[0]], CLENU, [
  { fond_id: 1, firma_id: 10, podil: 0.25, cena: 0 },
  { fond_id: 1, firma_id: 10, podil: 0.1, cena: 0 },
], JM);
ok('dva podíly v téže firmě se sečtou',
  blizko(z[0].hodnota, 1000000 + 0.35 * 8000000), '— ' + z[0].hodnota);
ok('ale firma se počítá jednou', z[0].firem === 1, '— ' + z[0].firem);

// Tohle je ta drahá chyba: cizí podíl připsaný mému fondu.
z = FOND.zebricek(AL, CLENU, [{ fond_id: 2, firma_id: 10, podil: 1, cena: 0 }], JM);
ok('cizí podíl se nepřipíše sousednímu fondu',
  z.filter((f) => f.id === 1)[0].hodnota === 1000000);

// Firma, o které server nic neví (dlouho nehrála), se ocení tím, co se za
// podíl zaplatilo. Nula by tvrdila, že ten podíl nestojí nic.
z = FOND.zebricek([AL[0]], CLENU,
  [{ fond_id: 1, firma_id: 999, podil: 0.5, cena: 600000 }], JM);
ok('neznámá firma se ocení pořizovací cenou',
  blizko(z[0].hodnota, 1600000), '— ' + z[0].hodnota);

// Firma v mínusu nesmí fond stáhnout pod jeho vlastní hotovost — podíl se
// nedá dlužit, nejhůř je bezcenný.
z = FOND.zebricek([AL[0]], CLENU,
  [{ fond_id: 1, firma_id: 12, podil: 0.5, cena: 100000 }], new Map([[12, -4000000]]));
ok('zadlužená firma fond nestáhne do mínusu',
  z.length === 1 && z[0].hodnota === 1000000, '— ' + JSON.stringify(z));

// Nic z toho nesmí spadnout na prázdném vstupu.
ok('prázdný vstup vrací prázdný žebříček',
  FOND.zebricek([], null, null, null).length === 0);
ok('aliance bez čehokoliv vypadne',
  FOND.zebricek([{ id: 9, nazev: 'Nic', pokladna: 0 }], null, null, null).length === 0);

// Pořadí při shodě: nižší id dřív, ať se žebříček mezi dvěma načteními
// neprohazuje.
z = FOND.zebricek([{ id: 5, nazev: 'B', pokladna: 100 }, { id: 2, nazev: 'A', pokladna: 100 }],
  null, null, null);
ok('při shodě rozhoduje nižší id', z[0].id === 2 && z[1].id === 5);

// Mapa i obyčejný objekt — route posílá Map, test klidně objekt.
z = FOND.zebricek([AL[0]], { 1: 7 }, DRZENE, { 10: 8000000 });
ok('bere i obyčejný objekt místo Mapy', z[0].clenu === 7 && blizko(z[0].hodnota, 3000000));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
