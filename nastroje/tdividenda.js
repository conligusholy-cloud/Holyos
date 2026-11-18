// Dividendová politika.
//
// Rozhoduje o tom, kolik peněz měsíčně odejde z cizí firmy — a kdo o tom
// vůbec smí rozhodnout. Chyba v tom není chyba v zobrazení: buď se někomu
// potichu sníží příjem, nebo dostane moc nad firmou, ve které má procento.
const D = require('../services/game/dividenda');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Kdo politiku určuje ──────────────────────────────────────────────────────
ok('nad polovinou rozhoduje podílník',
  D.kdoUrcuje([{ investor_id: 7, podil: 0.6 }]) === 7);
ok('přesná polovina nestačí',
  D.kdoUrcuje([{ investor_id: 7, podil: 0.5 }]) === null,
  '— ' + D.kdoUrcuje([{ investor_id: 7, podil: 0.5 }]));
ok('dva po čtyřiceti procentech nerozhoduje nikdo',
  D.kdoUrcuje([{ investor_id: 7, podil: 0.4 }, { investor_id: 8, podil: 0.4 }]) === null);
ok('ve firmě bez podílníků nerozhoduje nikdo', D.kdoUrcuje([]) === null);
ok('prázdný seznam nic neshodí', D.kdoUrcuje(null) === null);

// Dva podíly téhož investora se v téhle funkci nesčítají — sčítá je volající.
// Kontroluje se, že se nevybere menší z nich.
ok('vybere se ten, kdo má víc',
  D.kdoUrcuje([{ investor_id: 7, podil: 0.55 }, { investor_id: 8, podil: 0.9 }]) === 8);

ok('majitel firmy politiku nemění', D.smiMenit([{ investor_id: 7, podil: 0.6 }], 9) === false);
ok('menšinový podílník taky ne', D.smiMenit([{ investor_id: 7, podil: 0.6 }], 7) === true
  && D.smiMenit([{ investor_id: 7, podil: 0.3 }], 7) === false);
ok('nepřihlášený nikdy', D.smiMenit([{ investor_id: 7, podil: 0.6 }], null) === false);

// ── Meze ─────────────────────────────────────────────────────────────────────
ok('výchozí je sto procent, jako se vyplácelo doteď', D.VYCHOZI === 1);
ok('nad sto procent to nepustí', D.platna(5) === 1);
ok('pod nulu taky ne', D.platna(-2) === 0);
ok('nesmysl spadne na výchozí', D.platna('kdoví') === 1 && D.platna(undefined) === 1,
  '— ' + D.platna('kdoví') + ' / ' + D.platna(undefined));
ok('nula je platná hodnota, ne chybějící údaj', D.platna(0) === 0);

// ── Výplata ──────────────────────────────────────────────────────────────────
ok('při stu procentech se vyplácí jako dřív',
  D.castka(1000000, 0.3, 1) === 300000, '— ' + D.castka(1000000, 0.3, 1));
ok('poloviční politika je poloviční výplata',
  D.castka(1000000, 0.3, 0.5) === 150000, '— ' + D.castka(1000000, 0.3, 0.5));
ok('při nule neodejde nic', D.castka(1000000, 0.3, 0) === 0);
ok('výplata je v celých korunách',
  Number.isInteger(D.castka(333333, 0.37, 0.65)));

// Tohle je ta past, kvůli které test vznikl.
ok('ZTRÁTA se politikou nekrátí — doplácí se celá',
  D.castka(-1000000, 0.3, 0) === -300000 && D.castka(-1000000, 0.3, 0.5) === -300000,
  '— při nule ' + D.castka(-1000000, 0.3, 0) + ', při půlce ' + D.castka(-1000000, 0.3, 0.5));

ok('bez zisku není co vyplácet', D.castka(0, 0.3, 1) === 0);
ok('chybějící politika se chová jako sto procent',
  D.castka(1000000, 0.3, null) === 300000, '— ' + D.castka(1000000, 0.3, null));

// ── Kolik z firmy odejde celkem ──────────────────────────────────────────────
const l = [{ investor_id: 7, podil: 0.3 }, { investor_id: 8, podil: 0.2 }];
ok('odchozí částka je součet výplat',
  D.odchoziCelkem(1000000, l, 1) === 500000, '— ' + D.odchoziCelkem(1000000, l, 1));
ok('a politika ji krátí stejně',
  D.odchoziCelkem(1000000, l, 0.4) === 200000, '— ' + D.odchoziCelkem(1000000, l, 0.4));
ok('ve ztrátě se naopak celá vrací do firmy',
  D.odchoziCelkem(-1000000, l, 0) === -500000);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
