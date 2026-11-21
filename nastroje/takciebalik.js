// =============================================================================
// HolyOS — Laundromat Tycoon: test mého balíku akcií na burze
// =============================================================================
// Hráč z ceny akcie nepozná, jestli se prodej vyplatí. Potřebuje vidět, za
// kolik kusy pořídil, kolik by dnes dostal a jestli na to fond vůbec má.
// Test pouští opravdový akcieBalikHtml z game.js ve vm a hlídá, že server
// pořizovací cenu i volnou pokladnu posílá.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
// Čísla se formátují s nezlomitelnou mezerou; v testu je hledáme bez ohledu
// na to, která mezera to je.
function mezery(x) { return String(x).replace(/[\u00a0\u202f]/g, ' '); }
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  let hloubka = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') hloubka++;
    else if (zdroj[j] === '}') { hloubka--; if (!hloubka) return zdroj.slice(i, j + 1); }
  }
  throw new Error('funkce ' + jmeno + ' nemá konec');
}

const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
const ctx = {
  esc: (x) => String(x == null ? '' : x),
  tx: (k, d) => (d && d.p1 != null ? k + ':' + d.p1 : k),
  kcFull: (n) => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('cs-CZ') + ' L$',
};
vm.createContext(ctx);
vm.runInContext(telo(zdroj, 'akcieBalikHtml'), ctx);

// ─── Hráč z obrázku: 202 kusů za 159 400, pořízené po 106 000 ───────────────
console.log('\nBalík akcií: nákup, dnešní cena, rozdíl');
const f = { moje_kusy: 202, moje_porizovaci: 21412000, cena: 159400, fond_volne: 99000000 };
const h = mezery(ctx.akcieBalikHtml(f, false));
ma(h.indexOf('akcie.prumerna_cena') > 0, 'karta ukazuje, za kolik hráč akcie koupil');
ma(h.indexOf('106 000 L$') > 0, 'průměr sedí na pořizovací ceně dělené kusy', '21 412 000 / 202');
ma(h.indexOf('32 198 800 L$') > 0, 'objem při prodeji je kusy × dnešní cena', '202 × 159 400');
ma(h.indexOf('+10 786 800 L$ · +50 %') > 0, 'rozdíl proti nákupu v penězích i procentech');
ma(h.indexOf('akcie.zisk') > 0 && h.indexOf('akcie.ztrata') < 0, 'výdělek se jmenuje zisk');
ma(h.indexOf('class="ok"') > 0, 'zisk je zeleně');

console.log('\nKdyž je balík pod vodou');
const z = mezery(ctx.akcieBalikHtml({ moje_kusy: 100, moje_porizovaci: 2000000, cena: 15000,
  fond_volne: 99000000 }, false));
ma(z.indexOf('akcie.ztrata') > 0, 'ztráta se jmenuje ztráta');
ma(z.indexOf('class="err"') > 0, 'ztráta je červeně');
ma(z.indexOf('−500 000 L$ · -25 %') > 0, 'ztráta se nemaskuje plusem', '1,5 mil. proti 2 mil.');

console.log('\nNa prodej musí mít fond peníze');
const malo = ctx.akcieBalikHtml({ moje_kusy: 202, moje_porizovaci: 21412000, cena: 159400,
  fond_volne: 1594000 }, false);
ma(malo.indexOf('veta.akcie_vykoupi_jen:10') > 0, 'řekne se, kolik kusů fond vykoupí', '1 594 000 / 159 400');
const dost = ctx.akcieBalikHtml({ moje_kusy: 202, moje_porizovaci: 21412000, cena: 159400,
  fond_volne: 99000000 }, false);
ma(dost.indexOf('veta.akcie_vykoupi_jen') < 0, 'když fond má, nestraší se zbytečně');
const bezUdaje = mezery(ctx.akcieBalikHtml({ moje_kusy: 202, moje_porizovaci: 0, cena: 159400,
  fond_volne: null }, false));
ma(bezUdaje.indexOf('akcie.prumerna_cena') < 0, 'bez pořizovací ceny se průměr nevymýšlí');
ma(bezUdaje.indexOf('32 198 800 L$') > 0, 'objem při prodeji se ukáže i tak');
ma(ctx.akcieBalikHtml({ moje_kusy: 0, moje_porizovaci: 0, cena: 159400 }, false) === '',
  'kdo akcie nemá, nevidí nic');

// ─── Panel podrobností má stejná čísla, jen v jiném rámečku ─────────────────
console.log('\nKarta i podrobnosti berou tentýž blok');
const kv = mezery(ctx.akcieBalikHtml(f, true));
ma(kv.indexOf('<div class="kv">') === 0, 'v panelu se kreslí jako kv řádek');
ma(kv.indexOf('32 198 800 L$') > 0, 'a nese stejná čísla');
ma(/akcieBalikHtml\(f, false\)/.test(zdroj), 'karta burzy blok volá');
ma(/akcieBalikHtml\(a, true\)/.test(zdroj), 'podrobnosti akcie blok volají');

// ─── Server to musí poslat ──────────────────────────────────────────────────
console.log('\nServer posílá pořizovací cenu a volnou pokladnu');
const trade = fs.readFileSync(path.join(KOREN, 'routes/game-trade.routes.js'), 'utf8');
ma(/select: \{ aliance_id: true, pocet: true, dividenda_do: true, porizovaci: true \}/.test(trade),
  'držba se čte i s pořizovací cenou');
ma(/moje_porizovaci: mam\.get\(f\.id\) \? porizovaci\.get\(f\.id\) \|\| 0 : 0/.test(trade),
  'seznam akcií pořizovací cenu posílá');
ma(/Number\(x\.porizovaci \|\| 0\)/.test(trade), 'BigInt se převádí na číslo (jinak JSON spadne)');
ma(/fond_volne: mam\.get\(f\.id\) \? \(await fondVolne\(f\.id, f\)\)\.volne : null/.test(trade),
  'volná pokladna fondu jde s tím');
ma(/moje_porizovaci: mujRadek \? Number\(mujRadek\.porizovaci \|\| 0\) : 0/.test(trade),
  'podrobnosti akcie posílají totéž');

// ─── Popisky se musí vejít na řádek i v překladech ──────────────────────────
console.log('\nPopisky se vejdou na řádek ve všech jazycích');
const JAZYKY = ['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'];
JAZYKY.forEach((j) => {
  const d = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
  const a = d['akcie.prumerna_cena'] || '', b = d['akcie.prodejem_dostanes'] || '';
  ma(a && b && a.length <= 20 && b.length <= 20, j + ': popisky balíku jsou krátké',
    '„' + a + '" / „' + b + '"');
});

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
