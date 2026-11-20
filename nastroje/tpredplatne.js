// Předplatné na techniky: co se účtuje a co hráč dostává.
//
// Jsou to skutečné peníze, takže obě možné chyby stojí za to zkoušet zvlášť.
// Když hráč dostane míň, než zaplatil, okradli jsme ho. Když dostane víc,
// než za co kdy zaplatí, dá se tím obejít placení: přikoupit deset techniků
// hned po stržení, projet s nimi týden a den před obnovením je ubrat.
const P = require('../services/game/predplatne');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Beze změny ──────────────────────────────────────────────────────────────
ok('co je zaplacené, to běží', P.platnyPocet(6, 6) === 6);
ok('a účtovat se bude totéž', P.uctovanyPocet(6) === 6);

// ── Přikoupení: bonus, který odpouštíme ─────────────────────────────────────
// Zaplaceno za 4, přikoupil na 6 → jede 6 hned, účtovat se bude 6 až příště.
ok('přikoupený technik jede hned', P.platnyPocet(6, 4) === 6);
ok('a od příští platby se za něj platí', P.uctovanyPocet(6) === 6);

// ── Ubrání: doběhne do konce zaplaceného období ─────────────────────────────
// Zaplaceno za 6, ubral na 5 → do konce období jede 6, účtovat se bude 5.
ok('ubraný technik doběhne', P.platnyPocet(5, 6) === 6);
ok('ale účtovat se bude už jen nový počet', P.uctovanyPocet(5) === 5);

// ── Starší řádky bez zaplaceného počtu ──────────────────────────────────────
ok('prázdná hodnota znamená stejně jako qty', P.platnyPocet(3, null) === 3);
ok('undefined taky', P.platnyPocet(3, undefined) === 3);

// ── Nesmysly nic neshodí a nikdy nevyjde nula ───────────────────────────────
ok('nula se bere jako jeden', P.platnyPocet(0, 0) === 1);
ok('záporný počet taky', P.platnyPocet(-5, -2) === 1);
ok('text nic neshodí', P.platnyPocet('x', 'y') === 1);
ok('účtovaný počet nejde pod jedna', P.uctovanyPocet(0) === 1);

// ── Rozbití pojistek ────────────────────────────────────────────────────────
function rozbij(nazev, chybna, pripady) {
  const spadlo = pripady.some(function (p) { return chybna(p[0], p[1]) !== p[2]; });
  ok('rozbité „' + nazev + '“ test chytí', spadlo);
}
// Kdyby se bralo jen to, co se účtuje — hráč přijde o zaplaceného technika.
rozbij('bere se jen účtovaný počet',
  function (q, z) { return q; },
  [[5, 6, 6], [6, 4, 6]]);
// Kdyby se bralo jen zaplacené — přikoupený technik by nejel až do příští platby.
rozbij('bere se jen zaplacený počet',
  function (q, z) { return z == null ? q : z; },
  [[6, 4, 6], [5, 6, 6]]);
// Kdyby se sčítalo místo maxima — hráč dostane dvakrát tolik, než za co platí.
rozbij('počty se sčítají',
  function (q, z) { return (q || 0) + (z == null ? 0 : z); },
  [[6, 6, 6], [5, 6, 6]]);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
