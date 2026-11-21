// =============================================================================
// HolyOS — Laundromat Tycoon: test slevových balíčků karet
// =============================================================================
// Cena za kus se zaokrouhluje na celé koruny a Stripe účtuje cenu za kus ×
// počet. Když se to rozejde, hráč vidí v nabídce jinou částku, než jaká se
// mu strhne — to je ta nejhorší chyba, jakou v placení udělat jde.
//
// Testuje se SKUTEČNÝ ceník vytažený z routes/game-account.routes.js.
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
function usek(zdroj, od) {
  let hloubka = 0;
  for (let j = zdroj.indexOf('{', od); j < zdroj.length; j++) {
    if (zdroj[j] === '{') hloubka++;
    else if (zdroj[j] === '}') { hloubka--; if (!hloubka) return zdroj.slice(od, j + 1); }
  }
  throw new Error('konec se nenašel');
}
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  return usek(zdroj, i);
}

const zdroj = fs.readFileSync(path.join(KOREN, 'routes/game-account.routes.js'), 'utf8');
// Ceník vytáhneme párováním hranatých závorek, ne hledáním konkrétního
// balíčku — jinak by test při smazaném balíčku spadl místo toho, aby ho
// vypsal jako chybu.
const zacBal = zdroj.indexOf('const BALICKY = [');
let hlo = 0, konBal = -1;
for (let j = zdroj.indexOf('[', zacBal); j < zdroj.length; j++) {
  if (zdroj[j] === '[') hlo++;
  else if (zdroj[j] === ']') { hlo--; if (!hlo) { konBal = j; break; } }
}
const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(zdroj.slice(zacBal, konBal + 1) + ';\n'
  + telo(zdroj, 'cenaKusuVBalicku') + '\n' + telo(zdroj, 'balickyProKartu'), ctx);

// const se ve vm nestane vlastností kontextu — ceník si proto vyzvedneme.
const BAL = vm.runInContext('BALICKY', ctx);
const prev = { zobraz: (h) => h / 100 };     // haléře → koruny, bez převodu měny
const RUSH = 4900;                           // expresní dovoz, 49 Kč

console.log('\nBalíček 30 kusů, jak si ho Tomáš přál');
const bal = ctx.balickyProKartu({ price: RUSH }, prev);
const b30 = bal.filter((b) => b.qty === 30)[0];
ma(!!b30, 'balíček na 30 kusů v nabídce je');
ma(b30 && b30.price_czk === 570, 'stojí 570 Kč', b30 && b30.price_czk + ' Kč');
ma(ctx.cenaKusuVBalicku(RUSH, 30) === 1900, 'to je 19 Kč za kus');
ma(b30 && b30.sleva === 61, 'a na dlaždici svítí −61 %', b30 && '−' + b30.sleva + ' %');
ma(b30 && b30.plna_czk === 1470, 'proti plné ceně 1 470 Kč');
const b100 = bal.filter((b) => b.qty === 100)[0];
ma(!!b100, 'a nad ním stovka');
ma(b100 && b100.price_czk === 1500, 'stovka stojí 1 500 Kč', b100 && b100.price_czk + ' Kč');
ma(ctx.cenaKusuVBalicku(RUSH, 100) === 1500, 'to je 15 Kč za kus');
ma(b100 && b100.sleva === 69, 'a svítí −69 %', b100 && '−' + b100.sleva + ' %');

console.log('\nCo musí platit o každém balíčku');
const DRUHY = [{ nazev: 'expresní dovoz', price: 4900 }, { nazev: 'přípojky', price: 7900 },
  { nazev: 'úvěr', price: 12900 }];
DRUHY.forEach((k) => {
  const nabidka = ctx.balickyProKartu(k, prev);
  ma(nabidka.length === 5, k.nazev + ': pět balíčků (3, 5, 10, 30, 100)', nabidka.map((b) => b.qty).join(', '));
  // Stripe účtuje cenu za kus × počet. Kdyby se celek počítal jinak, strhne
  // se něco jiného, než co hráč viděl v nabídce.
  const sedi = nabidka.every((b) => b.price_czk === ctx.cenaKusuVBalicku(k.price, b.qty) * b.qty / 100);
  ma(sedi, k.nazev + ': celek je přesně cena za kus × počet');
  const celeKoruny = nabidka.every((b) => ctx.cenaKusuVBalicku(k.price, b.qty) % 100 === 0);
  ma(celeKoruny, k.nazev + ': cena za kus je celá koruna, bez haléřů');
  // Větší balík musí být vždycky výhodnější, jinak je nabídka past.
  let predchozi = k.price + 1, klesa = true;
  nabidka.forEach((b) => {
    const kus = ctx.cenaKusuVBalicku(k.price, b.qty);
    if (kus >= predchozi) klesa = false;
    predchozi = kus;
  });
  ma(klesa, k.nazev + ': čím víc kusů, tím nižší cena za kus');
  ma(nabidka.every((b) => b.sleva > 0 && b.sleva < 100), k.nazev + ': sleva je mezi 1 a 99 %');
});

console.log('\nPojistky ceníku');
ma(ctx.cenaKusuVBalicku(100, 30) >= 100, 'cena za kus nespadne pod korunu', '100 h');
ma(ctx.cenaKusuVBalicku(RUSH, 7) === RUSH, 'počet, který balíček nemá, platí plnou cenu');
ma(ctx.balickyProKartu({ price: RUSH, bezBalicku: true }, prev).length === 0,
  'karta mimo prodej balíčky nenabízí');

// ─── Platba musí přijmout právě ty počty, které jsou v nabídce ─────────────
// Dokud se počet na bráně ořezával natvrdo na deset, klikl hráč na balíček
// třiceti kusů a Stripe mu ukázal deset — jinou částku, než na jakou klikl.
console.log('\nNa bránu projde jen počet, který je v nabídce');
const stripeZdroj = fs.readFileSync(path.join(KOREN, 'routes/game-stripe.routes.js'), 'utf8');
const iCheck = stripeZdroj.indexOf("router.post('/stripe/checkout'");
const zacH = stripeZdroj.indexOf('async (req, res, next) => {', iCheck);
const handlerSrc = usek(stripeZdroj, stripeZdroj.indexOf('{', zacH + 26));
const sctx = {
  paymentsOn: () => true,
  acct: { _subKinds: [], _ramecKinds: [], _ramecKatalog: {}, _ramecUroven: async () => 0,
    _cenaKusuVBalicku: ctx.cenaKusuVBalicku, _balickyQty: BAL.map((b) => b.qty) },
  itemOf: async () => ({ kind: 'rush', price: RUSH, name: 'Expresní dovoz' }),
  MAX_QTY: 10,
  POVOLENE_KUSY: [1].concat(BAL.map((b) => b.qty)),
  // Dál už se test nedostane — chce to Stripe i databázi. Nám stačí, že se
  // počet nezastavil o kontrolu a nešel do ceny oříznutý.
  MENY: { prevodnik: async () => { throw new Error('STOP'); } },
  TEXTY: { jazykHrace: () => 'cs' },
  console, Math, String, parseInt,
};
vm.createContext(sctx);
const checkout = vm.runInContext('(async (req, res, next) => ' + handlerSrc + ')', sctx);
async function zkus(qty) {
  const v = { stav: 200, telo: null, chyba: null };
  const res = {
    status: (s) => { v.stav = s; return { json: (x) => { v.telo = x; } }; },
    json: (x) => { v.telo = x; },
  };
  await checkout({ body: { kind: 'rush', qty: qty },
    player: { id: 7, email: 'a@b.cz', first_name: 'Tomáš', last_name: 'Holý' } },
    res, (e) => { v.chyba = e && e.message; });
  return v;
}
(async () => {
  for (const q of [1, 3, 5, 10, 30, 100]) {
    const v = await zkus(q);
    ma(v.stav !== 400, q + '× projde na bránu', v.stav === 400 ? v.telo.error : 'dál do platby');
  }
  for (const q of [2, 7, 31, 999]) {
    const v = await zkus(q);
    ma(v.stav === 400, q + '× se odmítne, místo aby se tiše oříznul',
      v.stav === 400 ? v.telo.error : 'prošlo!');
  }
  ma(!/Math\.min\(MAX_QTY, parseInt/.test(stripeZdroj),
    'počet se u karet neořezává natvrdo');
  // Seznam povolených počtů se musí brát z ceníku. Ručně opsaný by se při
  // přidání balíčku neaktualizoval a nový balíček by brána odmítala.
  ma(/const POVOLENE_KUSY = \[1\]\.concat\(acct\._balickyQty/.test(stripeZdroj),
    'povolené počty se berou z ceníku, ne z ruky');

  console.log('\nDlaždice se musí vejít na obrazovku');
const css = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.css'), 'utf8');
ma(/\.balicky:has\(> :nth-child\(5\)\)\{grid-template-columns:repeat\(3,1fr\)\}/.test(css),
  'šest dlaždic (1× a pět balíčků) se láme po třech na 3 + 3');

  console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})();
