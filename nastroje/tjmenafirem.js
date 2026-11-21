// =============================================================================
// HolyOS — Laundromat Tycoon: test jmen firem v nabídkách fondu
// =============================================================================
// Firma se jmenuje jinak než její majitel: „Mýdlový prádlo" patří hráči
// s přezdívkou Josef. V equity řádku je uložený nick, takže se v nabídkách
// fondu svítilo „Josef" a hráč svou firmu v seznamu nenašel — vypadalo to,
// že tam vůbec není. Test hlídá, že se všude vybírá jméno firmy, ne nick.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}

const hra = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
const trade = fs.readFileSync(path.join(KOREN, 'routes/game-trade.routes.js'), 'utf8');

// ─── Seznam „Kde držíš podíl" v Dát hlasovat ────────────────────────────────
console.log('\nSeznam „Kde držíš podíl" ukazuje jméno firmy');
// Opravdový kus kódu, který ten seznam plní.
const i = hra.indexOf('var videno = {}, prvni = [];');
// Konec forEach poznáme podle odsazení: „});" na začátku řádku o dvě mezery.
// Hledat první „});" nejde — končí jím i řádek s push.
const konec = hra.indexOf('\n  });', hra.indexOf('FINANCE && FINANCE.podily', i)) + 6;
const ctx = {
  FINANCE: { podily: [
    { kdo_id: 9, kdo: 'Josef', kdo_firma: 'Mýdlový prádlo', moje: 'mam', stav: 'bezi' },
    { kdo_id: 4, kdo: 'Tonda', kdo_firma: null, moje: 'mam', stav: 'bezi' },
    { kdo_id: 5, kdo: 'Splacený', kdo_firma: 'Splacená s.r.o.', moje: 'mam', stav: 'odkoupeno' },
    { kdo_id: 6, kdo: 'Cizí', kdo_firma: 'Cizí s.r.o.', moje: 'prodal', stav: 'bezi' },
  ] },
  bezici: (x) => x.stav !== 'splaceno' && x.stav !== 'propadlo' && x.stav !== 'odkoupeno',
};
vm.createContext(ctx);
vm.runInContext(hra.slice(i, konec), ctx);
const prvni = vm.runInContext('prvni', ctx);
const jmena = prvni.map((x) => x.nazev);
ma(jmena.indexOf('Mýdlový prádlo') >= 0, 'firma je v seznamu pod svým jménem', jmena.join(', '));
ma(jmena.indexOf('Josef') < 0, 'a ne pod přezdívkou majitele');
ma(jmena.indexOf('Tonda') >= 0, 'bez jména firmy zbyde přezdívka, ať tam firma je');
ma(jmena.indexOf('Splacená s.r.o.') < 0, 'odkoupený podíl se nenabízí');
ma(jmena.indexOf('Cizí s.r.o.') < 0, 'cizí podíl v mojí firmě se nenabízí');
ma(prvni.length === 2, 'nic navíc', String(prvni.length));

// ─── Co fond drží a komu může nastavit dividendu ────────────────────────────
console.log('\nI ve fondu se firmy jmenují jménem');
ma(/firma_nazev: f\.nazev \|\| r\.firma_nick/.test(trade),
  'server posílá u držených podílů jméno firmy');
ma(/select: \{ state: true, dividenda_pct: true, nick: true, company: true \}/.test(trade),
  'a bere ho z firmy, ne z equity řádku');
ma(/nazev: x\.firma_nazev \|\| x\.firma_nick/.test(hra),
  'výběr firmy pro dividendu ukazuje jméno firmy');
ma(/esc\(x\.firma_nazev \|\| x\.firma_nick \|\| ''\)/.test(hra),
  'seznam držených podílů ve fondu taky');

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
