// =============================================================================
// HolyOS — Laundromat Tycoon: po mimořádné splátce je vidět, co zbylo
// =============================================================================
// Honza splatil 27 635 171 L$ z úvěru, který měl 66,9 mil., a hra mu řekla
// jen „Splaceno 27 635 171". Četl to jako „úvěr je pryč" a pak se ptal, proč
// mu v bance pořád svítí. Splátka přitom proběhla správně — chyběla jen
// věta o zbytku.
//
// Testuje se opravdový splatitUver() z game.js a hláška, kterou obsluha
// tlačítka skládá.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, detail) {
  if (podminka) { console.log('  ok   ' + popis + (detail ? '  — ' + detail : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (detail ? '  — ' + detail : ''));
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
const HRA = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
const CS = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/cs.json'), 'utf8'));

// Hláška, jak ji skládá obsluha tlačítka — tatáž podmínka, jaká je v kódu.
function hlaska(zbyva, dal) {
  return zbyva > 0 ? { klic: 'veta.splaceno_zbyva', p1: dal, p2: zbyva }
    : { klic: 'veta.splaceno_uver_doplacen', p1: dal };
}

function postav(hotovost, uvery) {
  const ctx = vm.createContext({ Math, Number, console,
    S: { cash: hotovost, loans: uvery.slice(), loan: 0, bank: 0, stats: {} },
    bankCap: () => 99999999999,
    zapis: () => {},
    zapisDoplacene: () => {},
    prepocitejDluh: function () {
      let c = 0;
      (this.S.loans || []).forEach((l) => { c += l.zbyva; });
      this.S.loan = Math.round(c);
    },
    tx: (k) => k, esc: (x) => String(x), kcFull: (x) => String(x), desZnak: () => ',',
  });
  vm.runInContext('prepocitejDluh = prepocitejDluh.bind(this);'
    + telo(HRA, 'splatitUver') + '\nthis.F = splatitUver; this.STAV = function () { return S; };', ctx);
  return { F: ctx.F, S: () => ctx.STAV() };
}

// ─── Honzův případ ──────────────────────────────────────────────────────────
{
  console.log('\nSplátka menší než úvěr');
  const { F, S } = postav(27636256, [{ id: 'u1', zbyva: 66927136, sazba: 0.104, splatka: 1201951 }]);
  const dal = F('u1', 27635171);
  ma(dal === 27635171, 'splatilo se, co hráč zadal', dal);
  const zbyl = S().loans.filter((x) => x.id === 'u1')[0];
  ma(!!zbyl, 'úvěr v seznamu zůstává — nebyl doplacený');
  ma(zbyl && Math.round(zbyl.zbyva) === 39291965, 'a je o splátku menší', zbyl && Math.round(zbyl.zbyva));
  ma(S().loan === 39291965, 'souhrn dluhu sedí na zbytku', S().loan);
  ma(S().cash === 1085, 'z hotovosti odešlo právě tolik', S().cash);
  const h = hlaska(Math.round(zbyl.zbyva), dal);
  ma(h.klic === 'veta.splaceno_zbyva', 'hláška řekne, že něco zbývá');
  ma(h.p2 === 39291965, 'a kolik přesně', h.p2);
}

// ─── Doplacený úvěr ─────────────────────────────────────────────────────────
{
  console.log('\nSplátka na celý zbytek');
  const { F, S } = postav(5000000, [{ id: 'u1', zbyva: 2000000, sazba: 0.1, splatka: 50000 }]);
  const dal = F('u1', 2000000);
  ma(dal === 2000000, 'splatí se celý zbytek');
  ma(!S().loans.filter((x) => x.id === 'u1').length, 'úvěr ze seznamu zmizí');
  ma(S().loan === 0, 'a dluh je nula');
  ma(hlaska(0, dal).klic === 'veta.splaceno_uver_doplacen', 'hláška řekne, že je doplacený');
}

// ─── Víc než zbývá, i víc než má ────────────────────────────────────────────
{
  console.log('\nStropy');
  const a = postav(10000000, [{ id: 'u1', zbyva: 3000000, sazba: 0.1, splatka: 50000 }]);
  ma(a.F('u1', 9999999) === 3000000, 'nad zbytek se nepřeplatí', a.S().cash);
  ma(a.S().cash === 7000000, 'a z hotovosti odejde jen zbytek úvěru');
  const b = postav(500000, [{ id: 'u1', zbyva: 3000000, sazba: 0.1, splatka: 50000 }]);
  ma(b.F('u1', 3000000) === 500000, 'víc, než má v hotovosti, nezaplatí', b.S().cash);
  ma(b.S().loans[0].zbyva === 2500000, 'a úvěr se o to zmenší');
  const c = postav(500000, [{ id: 'u1', zbyva: 3000000, sazba: 0.1, splatka: 50000 }]);
  ma(c.F('u2', 100000) === 0 && c.S().cash === 500000, 'cizí úvěr se nesplácí');
  ma(c.F('u1', 0) === 0 && c.S().cash === 500000, 'nula nic neudělá');
}

// ─── Hlášky jsou v kódu i ve všech jazycích ─────────────────────────────────
{
  console.log('\nHlášky');
  ma(/veta\.splaceno_zbyva/.test(HRA), 'hra hlásí i zbytek');
  ma(/veta\.splaceno_uver_doplacen/.test(HRA), 'a zvlášť doplacený úvěr');
  ma(!/tx\('veta\.splaceno_2'/.test(HRA), 'stará hláška bez zbytku v kódu nezbyla');
  ma(/zbyva > 0[\s\S]{0,120}veta\.splaceno_zbyva/.test(HRA), 'rozhoduje se podle zbytku');
  // Platí i pro hromadné doplacení z panelu peněz a z banky.
  ma((HRA.match(/veta\.splaceno_zbyva/g) || []).length >= 3,
    'říkají to všechna tři místa, kde se splácí',
    (HRA.match(/veta\.splaceno_zbyva/g) || []).length + '×');
  ['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach((j) => {
    const o = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
    const chybi = ['veta.splaceno_zbyva', 'veta.splaceno_uver_doplacen'].filter((k) => !o[k]);
    ma(!chybi.length, j + ': přeloženo', chybi.join(', ') || '2 texty');
  });
  ma(/\{penize:p2\}/.test(CS['veta.splaceno_zbyva']), 'zbytek se formátuje jako peníze');
}

console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
