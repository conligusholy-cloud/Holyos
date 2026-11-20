// Majitel prodává do veřejné nabídky na svoji vlastní firmu.
//
// Nabídka na odkup míří na všechny podílníky, jenže majitel v evidenci
// podílů žádný řádek nemá — jeho podíl je ten zbytek, který nikomu neprodal.
// Server ho proto odmítal s tím, že v té firmě nic nedrží, a hra mu ani
// neukázala tlačítko. Přitom je to právě on, kdo ten podíl drží: ostatní
// mají jen to, co jim sám prodal.
//
// Hlídá se dvojí: kolik majiteli zbývá (zastavený podíl je pryč stejně jako
// prodaný) a kdy se mu řekne, že prodejem přijde o většinu.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ─── Kolik majiteli zbývá ────────────────────────────────────────────────────
// Počet je ze služby vytažený zvlášť, aby se dal zkoušet bez databáze.
// Testuje se SKUTEČNÁ funkce, ne její opis.
const sluzba = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'game', 'prevzeti.js'), 'utf8');
const kusZbyva = (sluzba.match(/function zbyvaZ\(prodane, zastavene\) \{[\s\S]*?\n\}/) || [''])[0];
ok('v prevzeti.js se našlo: zbyvaZ', !!kusZbyva);
if (!kusZbyva) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const boxZ = {};
vm.createContext(boxZ);
vm.runInContext(kusZbyva + '\n', boxZ);
const zbyva = boxZ.zbyvaZ;
ok('nedotčená firma je celá majitelova', zbyva([], []) === 1);
ok('prodané podíly se odečtou', Math.abs(zbyva([0.1, 0.15], []) - 0.75) < 1e-9);
ok('zastavený podíl je pryč stejně jako prodaný',
  Math.abs(zbyva([0.1], [0.2]) - 0.7) < 1e-9);
ok('celá prodaná firma nenechá majiteli nic', zbyva([0.6, 0.4], []) === 0);
// Přeprodaná firma je chyba dat, ale zápornou část nabídnout nesmí.
ok('přeprodaná firma nedá zápor', zbyva([0.8, 0.5], []) === 0);

// ─── Varování o ztrátě většiny ───────────────────────────────────────────────
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const kusy = [
  (hra.match(/var VETSINA_PODILU = [^\n]*\n/) || [''])[0],
  (hra.match(/function prevzetiVarovani\(t, prodam\) \{[\s\S]*?\n\}/) || [''])[0],
];
ok('v game.js se našlo: prevzetiVarovani', !!kusy[1]);
if (!kusy[1]) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = { tx: (k, u) => k + ':' + JSON.stringify(u) };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const varuj = box.prevzetiVarovani;

const moje = { na_moji_firmu: true, muj_podil: 1 };
ok('prodej poloviny vlastní firmy varuje', !!varuj(moje, 0.5));
ok('a řekne, kolik zbude', varuj(moje, 0.6).indexOf('"p1":40') > 0);
ok('malý prodej nevaruje', varuj(moje, 0.2) === '');
ok('prodej přesně na hranici většiny varuje — padesát procent většina není',
  !!varuj(moje, 0.5));
ok('o fous míň nevaruje', varuj(moje, 0.49) === '');

// Kdo většinu nemá, nemá o co přijít — druhé varování by jen otupilo to první.
ok('menšinový majitel se nevaruje',
  varuj({ na_moji_firmu: true, muj_podil: 0.4 }, 0.3) === '');
// Na cizí firmě jsem podílník jako každý jiný.
ok('na cizí firmě se nevaruje',
  varuj({ na_moji_firmu: false, muj_podil: 1 }, 0.9) === '');
ok('nulový prodej nevaruje', varuj(moje, 0) === '');
ok('chybějící podíl nic neshodí',
  varuj({ na_moji_firmu: true }, 0.5) === '');

// ─── Zapojení ────────────────────────────────────────────────────────────────
// Počet sám o sobě nestačí: prodej do nabídky ho musí u majitele opravdu
// použít, a to na obou místech — v předběžné kontrole i uvnitř transakce,
// kde je to teprve závazné. A majiteli se nesmí ukrajovat z řádků, které
// nemá; kupujícímu se zakládá nový.
const routy = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
const prodat = routy.slice(routy.indexOf("router.post('/trade/prevzeti/:id/prodat'"));
const usek = prodat.slice(0, prodat.indexOf('router.', 10));
ok('majitel se pozná podle firmy', /const jsemFirma = t\.firma_id === req\.player\.id;/.test(usek));
ok('předběžná kontrola počítá majiteli zbytek',
  usek.split('PREVZETI.zbyvaMajiteli').length - 1 >= 2, 'na obou místech');
ok('zápis zakládá kupujícímu nový řádek',
  /if \(jsemFirma\) \{[\s\S]{0,400}gameEquity\.create/.test(usek));
ok('majiteli se z ničeho neukrajuje',
  /let zbyvaVzit = jsemFirma \? 0 : podil;/.test(usek));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
