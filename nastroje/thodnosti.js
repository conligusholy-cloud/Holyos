// =============================================================================
// HolyOS — Laundromat Tycoon: test žebříku hodností
// =============================================================================
// Hodnost počítá server (vidí ji ostatní v žebříčku a na burze), ale hra si
// tentýž žebřík drží i u sebe pro lištu. Když se obě kopie rozejdou, hráč
// vidí v liště jiný titul, než jaký u něj vidí ostatní — a povýšení mu přijde
// v jinou chvíli, než na kterou čeká. Test obě kopie porovnává kus po kuse.
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
const L = (n) => (n >= 1e9 ? (n / 1e9) + ' mld.' : (n / 1e6) + ' M');

const H = require(path.join(KOREN, 'services/game/hodnosti.js'));
const SERVER = H.hodnostiPro('cs');

// Klientská záloha žebříku — vytažená z game.js a spuštěná ve vm.
const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
const zac = zdroj.indexOf('var HODNOSTI_HRA = [');
const kon = zdroj.indexOf('];', zac);
const ctx = { esc: (x) => String(x), tx: (k) => k };
vm.createContext(ctx);
vm.runInContext(zdroj.slice(zac, kon + 2), ctx);
const HRA = vm.runInContext('HODNOSTI_HRA', ctx);

console.log('\nŽebřík sahá do miliard');
const vrchol = SERVER[SERVER.length - 1];
ma(SERVER.length === 10, 'stupňů je deset', SERVER.map((h) => h.id).join(' → '));
[['miliardar', 1e9], ['kral', 2.5e9], ['cisar', 5e9]].forEach(([id, od]) => {
  const h = SERVER.filter((x) => x.id === id)[0];
  ma(!!h && h.od === od, id + ' začíná na ' + L(od), h ? L(h.od) : 'chybí');
  ma(!!h && h.odmena && h.odmena.cash > 0, id + ' má odměnu v hotovosti',
    h && h.odmena ? L(h.odmena.cash) : '—');
});
ma(vrchol.id === 'cisar', 'vrchol je Císař prádla');
ma(H.hodnost(5e9, 'cs').dalsi === null, 'nad vrcholem už další meta není');
ma(H.hodnost(999e6, 'cs').id === 'legenda', 'těsně pod miliardou je pořád Legenda');
ma(H.hodnost(1e9, 'cs').id === 'miliardar', 'na miliardě se povyšuje');
ma(H.hodnost(1e9, 'cs').do_dalsi === 1.5e9, 'a je vidět, kolik zbývá na krále', '1,5 mld.');

console.log('\nObě kopie žebříku musí být totožné');
ma(HRA.length === SERVER.length, 'stejný počet stupňů', HRA.length + ' / ' + SERVER.length);
SERVER.forEach((h, i) => {
  const k = HRA[i] || {};
  ma(k.id === h.id, i + '. stupeň má stejné id', h.id + ' / ' + (k.id || '—'));
  ma(k.od === h.od, h.id + ': stejná hranice', L(h.od) + ' / ' + (k.od != null ? L(k.od) : '—'));
  const o1 = JSON.stringify(h.odmena || null), o2 = JSON.stringify(k.odmena || null);
  ma(o1 === o2, h.id + ': stejná odměna', o1 + ' / ' + o2);
});

console.log('\nŽebřík dává smysl jako žebřík');
let roste = true;
SERVER.forEach((h, i) => { if (i && !(h.od > SERVER[i - 1].od)) roste = false; });
ma(roste, 'každý další stupeň má vyšší hranici');
ma(SERVER.every((h) => !h.odmena || h.odmena.cash > 0 || h.odmena.karta),
  'odměna je buď hotovost, nebo karta');
// Jednou dosažená hodnost se neztrácí ani po přidání stupňů.
ma(H.zmrazena('cisar', H.hodnost(1e6, 'cs'), 'cs').id === 'cisar',
  'kdo byl císařem, zůstává císařem i po propadu jmění');

console.log('\nNázvy musí být ve všech jazycích');
['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach((j) => {
  const d = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
  // Server posílá hodnost.*, hra má vlastní zálohu pod hra.* — chybět nesmí
  // ani jedno, jinak hráč uvidí místo titulu klíč.
  const chybi = [];
  SERVER.forEach((h) => { if (!d['hodnost.' + h.id]) chybi.push('hodnost.' + h.id); });
  HRA.forEach((h) => { if (!d[h.nazev]) chybi.push(h.nazev); });
  ma(chybi.length === 0, j + ': všechny tituly přeložené', chybi.join(', ') || d['hodnost.cisar']);
});

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
