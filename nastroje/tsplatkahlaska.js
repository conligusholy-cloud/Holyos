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

// ─── „Zbývá měsíců" se po splátce musí hnout ────────────────────────────────
{
  console.log('\nZbývá měsíců');
  const ctx = vm.createContext({ Math, Number, UVER_MESICU: 60 });
  vm.runInContext(telo(HRA, 'uverMesicu') + '\nthis.F = uverMesicu;', ctx);
  const F = ctx.F;

  // Honzův úvěr před splátkou a po ní. Splátka i sazba se nemění, mění se
  // jen zbytek — a doba se musí zkrátit skoro o polovinu.
  const pred = { zbyva: 66927136, sazba: 0.104, splatka: 1201951, zbyvaMesicu: 77, mesicu: 84 };
  const po = { zbyva: 39291965, sazba: 0.104, splatka: 1201951, zbyvaMesicu: 77, mesicu: 84 };
  ma(F(pred) === 77, 'před splátkou vychází doba na smlouvu', F(pred));
  ma(F(po) === 39, 'po splátce 27,6 mil. zbývá 39 měsíců', F(po));
  ma(F(po) < F(pred) / 1.8, 'tedy ani ne polovina', F(pred) + ' → ' + F(po));

  ma(F({ zbyva: 0, sazba: 0.1, splatka: 1000, zbyvaMesicu: 50 }) === 0, 'doplacený úvěr má nula měsíců');
  ma(F({ zbyva: 100000, sazba: 0, splatka: 25000, zbyvaMesicu: 50, mesicu: 60 }) === 4,
    'bez úroku je to prostý podíl', F({ zbyva: 100000, sazba: 0, splatka: 25000, zbyvaMesicu: 50 }));
  // Delší, než zbývá ze smlouvy, to ukazovat nesmí.
  ma(F({ zbyva: 10000000, sazba: 0.1, splatka: 100000, zbyvaMesicu: 12, mesicu: 60 }) === 12,
    'smlouva je strop', F({ zbyva: 10000000, sazba: 0.1, splatka: 100000, zbyvaMesicu: 12 }));
  // Splátka, která nepokryje ani úrok, by dala nekonečno.
  ma(F({ zbyva: 10000000, sazba: 0.12, splatka: 50000, zbyvaMesicu: 30, mesicu: 60 }) === 30,
    'splátka pod úrok spadne zpátky na smlouvu');
  ma(F({ zbyva: 500000, sazba: 0.1, splatka: 0, zbyvaMesicu: 20, mesicu: 60 }) === 20, 'bez splátky platí smlouva');
  ma(F(null) === 0 && F({}) === 0, 'nesmysly nic neshodí');
  ma(/uverMesicu\(u\) \+ ' z '/.test(HRA), 'banka to podle toho vypisuje');
  ma(!/\(u\.zbyvaMesicu \|\| 0\) \+ ' z '/.test(HRA), 'a starý počítač měsíců v kódu nezbyl');
}

// ─── Seznam úvěrů nesmí skákat ──────────────────────────────────────────────
{
  console.log('\nPořadí úvěrů v bance');
  const ctx = vm.createContext({ Math, Number });
  // Řazení vytažené přímo z uveryHtml(), ať se netestuje opis.
  const src = telo(HRA, 'uveryHtml');
  const m = src.match(/var l = \(S\.loans \|\| \[\]\)\.slice\(\)\.sort\([\s\S]*?\n  \}\);/);
  ma(!!m, 'řazení se v uveryHtml() našlo');
  vm.runInContext('this.F = function (loans) { var S = { loans: loans }; '
    + (m ? m[0] : 'var l = [];') + ' return l; };', ctx);
  const F = ctx.F;

  // Honzovy dva úvěry: sedmiletý vzatý dřív, desetiletý později.
  const sedm = { id: 'a', popis: 'Úvěr z banky na 7 let', zbyva: 66927136, zalozen: 1000 };
  const deset = { id: 'b', popis: 'Úvěr z banky na 10 let', zbyva: 61027000, zalozen: 2000 };
  const pred = F([sedm, deset]).map((x) => x.id).join(',');
  // Po splátce zbývá na sedmiletém míň než na desetiletém.
  const po = F([Object.assign({}, sedm, { zbyva: 39291965 }), deset]).map((x) => x.id).join(',');
  ma(pred === 'a,b', 'starší úvěr je nahoře', pred);
  ma(po === pred, 'a po splátce se pořadí nezmění', pred + ' → ' + po);
  ma(F([deset, sedm]).map((x) => x.id).join(',') === 'a,b', 'pořadí nezáleží na tom, jak přišly');
  ma(F([]).length === 0 && F([{ id: 'x', zbyva: 1 }]).length === 1, 'prázdno a jeden úvěr nic neshodí');

  // A dva stejně pojmenované úvěry musí jít rozeznat.
  ma(/datumKratce\(u\.zalozen\)/.test(HRA), 'u úvěru je vidět, kdy si ho hráč vzal');
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
