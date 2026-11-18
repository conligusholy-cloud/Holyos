// Kurzy měn z ČNB.
//
// Tohle je jediné místo ve hře, kde se počítají skutečné peníze. Když se
// rozbor splete o řád, hráč zaplatí stokrát víc nebo stokrát míň — a pozná
// se to až z výpisu. Proto se tu zkouší hlavně to, jak se rozbor chová,
// když mu text nepřijde v pořádku.
const K = require('../services/game/kurzy');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const skoro = (a, b) => Math.abs(a - b) < 1e-6;

// Skutečný text, jak ho ČNB vydává.
const CNB = [
  '16.11.2026 #220',
  'země|měna|množství|kód|kurz',
  'Austrálie|dolar|1|AUD|14,512',
  'EMU|euro|1|EUR|24,430',
  'Maďarsko|forint|100|HUF|5,642',
  'Polsko|zlotý|1|PLN|5,548',
  'USA|dolar|1|USD|22,182',
].join('\n');

// ── Rozbor ───────────────────────────────────────────────────────────────────
let k = K.rozeber(CNB);
ok('euro se přečte', skoro(k.EUR, 24.43), '— ' + k.EUR);
ok('zlotý se přečte', skoro(k.PLN, 5.548), '— ' + k.PLN);
ok('dolar se přečte', skoro(k.USD, 22.182), '— ' + k.USD);

// Tohle je ta past se stonásobkem: forint se vydává po stu.
ok('měna vydávaná po stu se dělí množstvím',
  skoro(k.HUF, 0.05642), '— ' + k.HUF);

ok('hlavička se nebere jako měna', k['KÓD'] === undefined && k.MĚNA === undefined);
ok('datum nahoře nic nerozbije', Object.keys(k).length === 5, '— ' + Object.keys(k).join(','));

// ── Nesmysly na vstupu ───────────────────────────────────────────────────────
ok('prázdný text nedá nic', Object.keys(K.rozeber('')).length === 0);
ok('null nic neshodí', Object.keys(K.rozeber(null)).length === 0);
ok('HTML místo textu nedá žádný kurz',
  Object.keys(K.rozeber('<html><body>Služba není dostupná</body></html>')).length === 0);
ok('řádek bez kurzu se přeskočí',
  K.rozeber('Polsko|zlotý|1|PLN|').PLN === undefined);
ok('nulové množství se přeskočí, ne vydělí',
  K.rozeber('Polsko|zlotý|0|PLN|5,548').PLN === undefined);
ok('záporný kurz se přeskočí',
  K.rozeber('Polsko|zlotý|1|PLN|-5,548').PLN === undefined);
ok('kód, co není třípísmenný, se přeskočí',
  K.rozeber('Polsko|zlotý|1|ZLOTY|5,548').ZLOTY === undefined);

// Desetinná tečka místo čárky: kdyby se ČNB jednou rozhodla jinak, nesmí
// z toho vzniknout NaN.
ok('tečka místo čárky se přečte taky',
  skoro(K.rozeber('Polsko|zlotý|1|PLN|5.548').PLN, 5.548));

// ── Pojistky před zápisem ────────────────────────────────────────────────────
ok('normální pohyb projde', K.proc_ne(24.5, 24.43) === null);
ok('NaN neprojde nikdy', K.proc_ne(NaN, 24.43) !== null);
ok('nula neprojde', K.proc_ne(0, 24.43) !== null);
ok('stonásobek neprojde', K.proc_ne(2443, 24.43) !== null,
  '— ' + K.proc_ne(2443, 24.43));
ok('setina neprojde', K.proc_ne(0.2443, 24.43) !== null);

// Skok přes desetinu je spíš rozbitý rozbor než pohyb na trhu.
ok('skok o 11 % neprojde', K.proc_ne(24.43 * 1.11, 24.43) !== null,
  '— ' + K.proc_ne(24.43 * 1.11, 24.43));
ok('skok o 9 % projde', K.proc_ne(24.43 * 1.09, 24.43) === null);
ok('propad o 11 % taky neprojde', K.proc_ne(24.43 * 0.89, 24.43) !== null);

// První zápis, kdy ještě není s čím porovnávat.
ok('bez dosavadní hodnoty rozhoduje jen rozsah',
  K.proc_ne(24.43, 0) === null && K.proc_ne(24.43, NaN) === null);
ok('ale nesmysl neprojde ani napoprvé', K.proc_ne(99999, 0) !== null);

// ── Které měny se hlídají ────────────────────────────────────────────────────
const s = K.sledovane();
ok('koruna se z ČNB netahá — je to domácí měna',
  !s.some((m) => m.kod === 'czk'));
ok('euro, dolar i zlotý se hlídají',
  ['eur', 'usd', 'pln'].every((k2) => s.some((m) => m.kod === k2)),
  '— ' + s.map((m) => m.kod).join(','));
ok('každá hlídaná měna má klíč v nastavení i třípísmenný kód',
  s.every((m) => m.klic && /^[A-Z]{3}$/.test(m.iso)));

// ── Celé kolo nasucho ────────────────────────────────────────────────────────
// Bez databáze se dál nedostaneme, ale rozbor i pojistky musí na skutečném
// textu dát dohromady právě ty kurzy, které hra účtuje.
const vysledek = K.rozeber(CNB);
ok('ze skutečného textu vyjdou všechny tři účtované měny',
  K.sledovane().every((m) => isFinite(vysledek[m.iso])));
ok('a všechny projdou pojistkami proti dosavadním hodnotám',
  K.sledovane().every((m) => K.proc_ne(vysledek[m.iso],
    require('../services/game/meny-jadro').KURZY_VYCHOZI[m.kod]) === null),
  '— ' + K.sledovane().map((m) => m.kod + ' ' + (K.proc_ne(vysledek[m.iso],
    require('../services/game/meny-jadro').KURZY_VYCHOZI[m.kod]) || 'ok')).join(' · '));

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
