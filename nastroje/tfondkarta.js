// Co schválenému návrhu fondu chybí, aby šel provést.
//
// Fond má v pokladně šedesát milionů a hra mu odmítne vyhlásit nabídku za
// šedesát milionů. Není to chyba: dvě třetiny pokladny drží nabídky, které
// fond sám vyvěsil, a slíbené peníze se nesmí utratit podruhé. Chyba byla,
// že se to podílník dozvěděl až po kliknutí, a i pak jen jako „fond na to
// nemá". Tohle číslo patří na kartu předem.
//
// Testuje se SKUTEČNÝ kód vytažený z game.js, ne jeho opis.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const kus = hra.match(/function fondNavrhChybi\(n\) \{[\s\S]*?\n\}/);
ok('v game.js se našlo: fondNavrhChybi', !!kus);
if (!kus) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }

const box = { FOND: null };
vm.createContext(box);
vm.runInContext(kus[0] + '\n', box);
const chybi = box.fondNavrhChybi;

// Ten skutečný případ: EX ALTO HOLDING, 20. 11. 2026.
box.FOND = { fond: { pokladna: 60375000, zamceno: 38374988, volne: 22000012 } };
const koupit = { druh: 'koupit', detail: { pct: 0.25, cena: 60000000 } };
const r = chybi(koupit);
ok('u nedosažitelného návrhu se spočítá, kolik chybí',
  !!r && r.chybi === 60000000 - 22000012);
ok('a kolik drží vyvěšené nabídky', !!r && r.zamceno === 38374988);

// Měří se proti volným penězům, ne proti pokladně. Proti pokladně by tenhle
// návrh vyšel jako proveditelný — a přesně tak se taky dostal na hlasování.
ok('nepočítá se proti pokladně', !!r, 'proti pokladně 60 375 000 by chyba nebyla');

ok('návrh, na který fond má, se nehlásí',
  chybi({ druh: 'koupit', detail: { cena: 22000012 } }) === null);
ok('přesně na hranici se nehlásí',
  chybi({ druh: 'koupit', detail: { cena: 22000012 } }) === null);
ok('o korunu víc už se hlásí',
  (chybi({ druh: 'koupit', detail: { cena: 22000013 } }) || {}).chybi === 1);

// Výplata členům se platí ze stejných peněz.
ok('výplata se měří stejně',
  (chybi({ druh: 'vyplatit', detail: { castka: 30000000 } }) || {}).chybi === 30000000 - 22000012);

// Návrhy, na kterých se nic neplatí, nemají co hlásit.
ok('stažení nabídky nic nestojí', chybi({ druh: 'zrusit', detail: { tender_id: 7 } }) === null);
ok('dividenda nic nestojí', chybi({ druh: 'dividenda', detail: { pct: 0.5 } }) === null);
ok('nulová cena nic nehlásí', chybi({ druh: 'koupit', detail: { cena: 0 } }) === null);
ok('chybějící detail nic neshodí', chybi({ druh: 'koupit' }) === null);

// Dokud se fond nenačetl, nesmí se tvrdit, že něco chybí — ani spadnout.
box.FOND = null;
ok('bez načteného fondu se nic netvrdí', chybi(koupit) === null);
box.FOND = {};
ok('bez čísel fondu se nic netvrdí', chybi(koupit) === null);
// Fond bez vyplněných čísel: volné se bere jako nula, takže chybí celá cena.
box.FOND = { fond: {} };
ok('prázdná čísla fondu se berou jako nula',
  (chybi(koupit) || {}).chybi === 60000000);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
