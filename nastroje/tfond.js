// Aliance jako fond.
//
// Tady se počítají cizí peníze: kdo kolik vložil, kolik mu z toho patří, co
// dostane při výplatě a co si odnese při odchodu. Chyba se tu nepozná z
// provozu — vyjde o korunu jinak a nikdo si toho rok nevšimne, až se jednou
// účet fondu nerovná součtu toho, co dostali členové.
//
// Proto se tu zkouší i to, co vypadá jako samozřejmost: že součet výplat
// sedí na rozdělovanou částku vždycky, i když se dělí nedělitelné.
const F = require('../services/game/fond');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const skoro = (a, b) => Math.abs(a - b) < 1e-9;
const soucet = (l) => l.reduce((a, x) => a + x.castka, 0);
const vklad = (id, castka) => ({ clen_id: id, castka });

// ── Podíly z vkladů ──────────────────────────────────────────────────────────
const tri = [vklad(1, 600000), vklad(2, 300000), vklad(3, 100000)];
let p = F.podily(tri);
ok('podíl odpovídá vkladu', skoro(p[0].podil, 0.6) && skoro(p[1].podil, 0.3)
  && skoro(p[2].podil, 0.1));
ok('podíly dávají dohromady jedničku',
  skoro(p.reduce((a, x) => a + x.podil, 0), 1));
ok('největší vkladatel je první', p[0].clen_id === 1);
ok('opakovaný vklad je pořád jeden podílník',
  F.podily([vklad(1, 100), vklad(1, 100), vklad(2, 200)]).length === 2);
ok('prázdný fond nikoho nemá', F.podily([]).length === 0 && F.podily(null).length === 0);

// Nový vklad ředí ostatní sám od sebe — žádné zvláštní počítání.
const poVstupu = F.podily(tri.concat([vklad(4, 1000000)]));
ok('nový vklad naředí ostatní',
  skoro(poVstupu.filter((x) => x.clen_id === 1)[0].podil, 0.3)
  && skoro(poVstupu.filter((x) => x.clen_id === 4)[0].podil, 0.5));
ok('a součet je pořád jedna',
  skoro(poVstupu.reduce((a, x) => a + x.podil, 0), 1));

// ── Rozdělení zisku ──────────────────────────────────────────────────────────
ok('dělitelná částka sedí na podíly',
  soucet(F.rozdeleni(100, tri)) === 100
  && F.rozdeleni(100, tri).filter((x) => x.clen_id === 1)[0].castka === 60);
// Tohle je ta past: tři třetiny ze sta.
const tretiny = [vklad(1, 1), vklad(2, 1), vklad(3, 1)];
const d = F.rozdeleni(100, tretiny);
ok('nedělitelná částka se rozdělí beze zbytku', soucet(d) === 100,
  d.map((x) => x.castka).join('+'));
ok('rozdíl mezi členy je nanejvýš koruna',
  Math.max.apply(null, d.map((x) => x.castka)) - Math.min.apply(null, d.map((x) => x.castka)) <= 1);
// A totéž na ošklivých číslech, ať se nespoléhá na hezkou stovku.
let nesedi = 0;
for (let castka = 1; castka <= 400; castka++) {
  if (soucet(F.rozdeleni(castka, tretiny)) !== castka) nesedi++;
  if (soucet(F.rozdeleni(castka, tri)) !== castka) nesedi++;
}
ok('součet sedí na každé částce od jedné do čtyř set', nesedi === 0,
  nesedi + ' nesedících');
ok('ztráta se dělí stejně jako zisk',
  soucet(F.rozdeleni(-100, tretiny)) === -100
  && F.rozdeleni(-100, tri).every((x) => x.castka <= 0));
ok('prázdný fond nerozdělí nic', F.rozdeleni(1000, []).length === 0);
ok('nulový zisk nerozdá nic', soucet(F.rozdeleni(0, tri)) === 0);
// Pořadí členů ve vstupu nesmí měnit výsledek.
const obracene = tri.slice().reverse();
ok('na pořadí vkladů nezáleží',
  JSON.stringify(F.rozdeleni(101, tri).slice().sort((a, b) => a.clen_id - b.clen_id))
  === JSON.stringify(F.rozdeleni(101, obracene).slice().sort((a, b) => a.clen_id - b.clen_id)));

// ── Hlasování ────────────────────────────────────────────────────────────────
// Váhou je podíl, mlčení je „ne". Kdyby stačila většina z odevzdaných hlasů,
// prošlo by zásadní rozhodnutí dvěma procenty fondu, protože ostatní spali.
ok('většina podílů běžnou věc prosadí',
  F.hlasovani(tri, { 1: true }, F.BEZNE).proslo);
ok('mlčení není souhlas',
  !F.hlasovani(tri, { 2: true, 3: true }, F.BEZNE).proslo);
const pul = [vklad(1, 1), vklad(2, 1)];
ok('přesná polovina nestačí — nemá navrch nikdo',
  !F.hlasovani(pul, { 1: true }, F.BEZNE).proslo);
ok('tři čtvrtiny přesně stačí',
  F.hlasovani([vklad(1, 3), vklad(2, 1)], { 1: true }, F.ZASADNI).proslo);
ok('na zásadní věc většina nestačí',
  !F.hlasovani(tri, { 1: true }, F.ZASADNI).proslo);
const h = F.hlasovani(tri, { 1: true, 2: false }, F.ZASADNI);
ok('je vidět, kolik do prahu chybí', skoro(h.chybi, 0.15),
  'chybí ' + (h.chybi * 100).toFixed(0) + ' %');
ok('pro, proti a mlčící dají dohromady celek',
  skoro(h.pro + h.proti + h.mlci, 1));
ok('kdo rozhodne sám, je vidět',
  F.kdoRozhoduje(tri, F.BEZNE) === 1 && F.kdoRozhoduje(tri, F.ZASADNI) === null);
ok('bez většiny nerozhoduje nikdo',
  F.kdoRozhoduje([vklad(1, 1), vklad(2, 1)], F.BEZNE) === null);

// ── Odchod ───────────────────────────────────────────────────────────────────
// Odcházející dostává díl DNEŠNÍ hodnoty, ne svůj vklad zpátky. V tom je ten
// rozdíl proti hlasovacímu bloku: kdo vložil, když se dařilo, odnáší si víc.
const vyrostl = F.odchod(tri, 2, 2000000);
ok('odcházející dostane díl hodnoty fondu, ne svůj vklad',
  vyrostl.vyplatit === 600000 && vyrostl.vklad === 300000,
  'vyplatit ' + vyrostl.vyplatit + ', vložil ' + vyrostl.vklad);
const spadl = F.odchod(tri, 2, 500000);
ok('když fond prodělal, odnáší si míň', spadl.vyplatit === 150000,
  String(spadl.vyplatit));
ok('po odchodu se zbylým podíly přepočítají',
  skoro(vyrostl.zbyli.filter((x) => x.clen_id === 1)[0].podil, 600000 / 700000));
ok('kdo ve fondu není, neodchází', F.odchod(tri, 99, 1000).vyplatit === 0);

// ── Převod dílu ──────────────────────────────────────────────────────────────
const pr = F.prevod(tri, 1, 3, 300000);
ok('převod přesune vklad, ne procento', pr.ok
  && skoro(pr.podily.filter((x) => x.clen_id === 1)[0].podil, 0.3)
  && skoro(pr.podily.filter((x) => x.clen_id === 3)[0].podil, 0.4));
ok('po převodu dávají podíly pořád jedničku',
  skoro(pr.podily.reduce((a, x) => a + x.podil, 0), 1));
ok('celkový vklad fondu se převodem nemění', pr.podily.celkem === 1000000,
  String(pr.podily.celkem));
ok('víc, než člověk drží, převést nejde', !F.prevod(tri, 3, 1, 999999).ok);
ok('sám sobě se nepřevádí', !F.prevod(tri, 1, 1, 1000).ok);
ok('kdo nic nemá, nemá co převádět', !F.prevod(tri, 99, 1, 1000).ok);
const cely = F.prevod(tri, 3, 1, 100000);
ok('kdo převede všechno, ve fondu zůstat nemusí',
  cely.ok && cely.podily.filter((x) => x.clen_id === 3).length === 0);

// ── Který práh na co ─────────────────────────────────────────────────────────
// Rozdávat peníze má být těžší než je investovat: investice se dá prodat
// zpátky, vyplacené peníze se z cizí kapsy neberou.
ok('nákup podílu je běžné rozhodnutí', F.prahDruhu('koupit') === F.BEZNE);
ok('výplata z fondu je zásadní', F.prahDruhu('vyplatit') === F.ZASADNI);
ok('a výplata je těžší než nákup', F.prahDruhu('vyplatit') > F.prahDruhu('koupit'));
ok('neznámý druh nemá práh', F.prahDruhu('cokoli') === null);

// A co z toho plyne u hlasování: vklady 60/40.
const dvaClenove = [{ clen_id: 1, castka: 600000 }, { clen_id: 2, castka: 400000 }];
ok('šedesát procent koupit schválí',
  F.hlasovani(dvaClenove, { 1: 'pro' }, F.prahDruhu('koupit')).proslo === true);
ok('ale na výplatu nestačí',
  F.hlasovani(dvaClenove, { 1: 'pro' }, F.prahDruhu('vyplatit')).proslo === false);
ok('na výplatu musí být oba',
  F.hlasovani(dvaClenove, { 1: 'pro', 2: 'pro' }, F.prahDruhu('vyplatit')).proslo === true);

// Stáhnout vyvěšenou nabídku musí jít stejně snadno, jako se vyvěsila. Kdyby
// na to byl vyšší práh, menšina by udržela fondu zamčené peníze proti vůli
// ostatních a nikdo by s tím nesvedl nic až do konce lhůty.
ok('stažení nabídky je běžné rozhodnutí', F.prahDruhu('zrusit') === F.BEZNE,
  '— ' + F.prahDruhu('zrusit'));
ok('a je stejně snadné jako vyvěšení',
  F.prahDruhu('zrusit') === F.prahDruhu('koupit'));
ok('ale lehčí než rozdání peněz',
  F.prahDruhu('zrusit') < F.prahDruhu('vyplatit'));

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
