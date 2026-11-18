// Co smí podílník podle velikosti podílu.
//
// Rozhoduje to o dvou věcech, které se nedají vzít zpátky: kdo smí měnit
// výplatu z cizí firmy a kdo smí majiteli zakázat zastavit vlastní majetek.
// Posunutý práh o jedinou setinu znamená moc nad firmou, na kterou ten
// člověk nemá.
const P = require('../services/game/prava');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Podíly se sčítají na člověka, ne na řádku ────────────────────────────────
// Tohle je ta past: kdo koupil třikrát po dvaceti, drží šedesát.
let s = P.souhrn([
  { investor_id: 7, podil: 0.2 }, { investor_id: 7, podil: 0.2 },
  { investor_id: 7, podil: 0.2 }, { investor_id: 8, podil: 0.1 },
]);
ok('tři nákupy po dvaceti procentech dají šedesát',
  s.length === 2 && Math.abs(s.find((e) => e.investor_id === 7).podil - 0.6) < 1e-9,
  '— ' + JSON.stringify(s));
ok('a většinu z toho má', P.kdoUrcuje(s) === 7);
ok('kdyby se nesčítaly, nemá ji nikdo',
  P.kdoUrcuje([{ investor_id: 7, podil: 0.2 }, { investor_id: 7, podil: 0.2 },
    { investor_id: 7, podil: 0.2 }]) === null);
// Na pořadí řádek nesmí záležet: kdyby zákaz přebíjela poslední z nich,
// stačilo by přikoupit podíl a zákaz by sám zmizel.
ok('zákaz na jedné řádce platí pro celý podíl, ať je kdekoli',
  P.souhrn([{ investor_id: 7, podil: 0.2 },
    { investor_id: 7, podil: 0.2, zakaz_zastavy: true }])[0].zakaz === true
  && P.souhrn([{ investor_id: 7, podil: 0.2, zakaz_zastavy: true },
    { investor_id: 7, podil: 0.2 }])[0].zakaz === true);
ok('prázdný seznam nic neshodí', P.souhrn(null).length === 0);

// ── Většina: dividendová politika ────────────────────────────────────────────
ok('nad polovinou rozhoduje', P.kdoUrcuje([{ investor_id: 7, podil: 0.51 }]) === 7);
ok('přesná polovina nestačí', P.kdoUrcuje([{ investor_id: 7, podil: 0.5 }]) === null);
ok('dva po čtyřiceti nerozhoduje nikdo',
  P.kdoUrcuje([{ investor_id: 7, podil: 0.4 }, { investor_id: 8, podil: 0.4 }]) === null);
ok('majitel firmy mezi podílníky není, takže neurčuje',
  P.smiMenit([{ investor_id: 7, podil: 0.6 }], 9) === false);

// ── Blokační menšina: zákaz zástavy ──────────────────────────────────────────
ok('čtvrtina na blokaci stačí', P.smiBlokovat([{ investor_id: 7, podil: 0.25 }], 7) === true);
ok('o setinu míň už ne',
  P.smiBlokovat([{ investor_id: 7, podil: 0.24 }], 7) === false);
ok('kdo ve firmě nic nemá, neblokuje',
  P.smiBlokovat([{ investor_id: 7, podil: 0.6 }], 9) === false);
ok('nepřihlášený nikdy', P.smiBlokovat([{ investor_id: 7, podil: 0.6 }], null) === false);

// Právo blokovat a zapnutá blokace jsou dvě různé věci.
ok('kdo na blokaci má, ale nemá ji zapnutou, neblokuje',
  P.kdoBlokuje([{ investor_id: 7, podil: 0.4, zakaz: false }]) === null);
ok('se zapnutou blokuje',
  P.kdoBlokuje([{ investor_id: 7, podil: 0.4, zakaz: true }]) === 7);
ok('malý podílník se zapnutou blokací neblokuje nic',
  P.kdoBlokuje([{ investor_id: 7, podil: 0.1, zakaz: true }]) === null,
  '— ' + P.kdoBlokuje([{ investor_id: 7, podil: 0.1, zakaz: true }]));
ok('ze dvou blokujících se jmenuje ten větší',
  P.kdoBlokuje([{ investor_id: 7, podil: 0.26, zakaz: true },
    { investor_id: 8, podil: 0.4, zakaz: true }]) === 8);
ok('prázdná firma neblokuje', P.kdoBlokuje([]) === null && P.kdoBlokuje(null) === null);

// ── Prahy ────────────────────────────────────────────────────────────────────
ok('blokační práh je čtvrtina', P.BLOKACNI === 0.25);
ok('většina je polovina', P.VETSINA === 0.5);
ok('blokovat smí míň, než kolik je potřeba na většinu', P.BLOKACNI < P.VETSINA);

// ── Co jde ven hráči ─────────────────────────────────────────────────────────
const l = P.souhrn([{ investor_id: 7, podil: 0.6, zakaz_zastavy: true },
  { investor_id: 8, podil: 0.3 }]);
let v = P.proHrace(l, 7);
ok('většinový vidí obě svá práva',
  v.smim_urcovat === true && v.smim_blokovat === true && v.muj_zakaz === true);
v = P.proHrace(l, 8);
ok('třetinový smí blokovat, určovat ne',
  v.smim_blokovat === true && v.smim_urcovat === false && v.muj_zakaz === false);
ok('a vidí, kdo blokaci drží', v.blokuje === 7 && v.urcuje === 7);
v = P.proHrace(l, 9);
ok('majitel nemá ani jedno, ale vidí, na čem je',
  v.smim_urcovat === false && v.smim_blokovat === false && v.blokuje === 7);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
