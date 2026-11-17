// Co se dá koupit, musí jít i vyzvednout.
//
// Kampaně se první den prodávaly a nefungovaly: hráč zaplatil, karta se
// v databázi založila, ale pub() ji do seznamu „co mám" nezapočítal —
// rodina KAMPAN prostě chyběla ve výčtu. Hra se o zaplacené kartě nedozvěděla
// a nikdy si ji nevyzvedla. Peníze pryč, kampaň neběží.
//
// Tenhle test hlídá, že se to nestane znovu: každá položka, která jde koupit
// jako kus, musí být mezi počítanými druhy.
const acct = require('../routes/game-account.routes');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

const vsechny = Object.keys(acct._cards);
const predplatne = new Set(acct._subKinds);
const pocitane = new Set(acct._pocitaneKinds);

const kusove = vsechny.filter((k) => !predplatne.has(k));
const chybejici = kusove.filter((k) => !pocitane.has(k));
ok('každá kusová položka se počítá mezi nevyzvednuté',
  chybejici.length === 0, chybejici.length ? '— chybí: ' + chybejici.join(', ') : '');

// Předplatné se naopak počítat nesmí: nekupuje se po kusech a drží si vlastní
// tabulku. Kdyby se připletlo sem, hra by nabídla „použít" něco, co použít nejde.
const navic = acct._subKinds.filter((k) => pocitane.has(k));
ok('předplatné se mezi kusy neplete', navic.length === 0,
  navic.length ? '— navíc: ' + navic.join(', ') : '');

// Kampaně zvlášť, protože na nich to prasklo.
const kampanChybi = acct._kampanKinds.filter((k) => !pocitane.has(k));
ok('kampaně jsou mezi počítanými', kampanChybi.length === 0,
  kampanChybi.length ? '— chybí: ' + kampanChybi.join(', ') : '');

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
