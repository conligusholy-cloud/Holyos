// =============================================================================
// HolyOS — Laundromat Tycoon: test zřízení pobočky
// =============================================================================
// Seznam měst v okně „Zřídit pobočku" se bez peněz kreslil úplně bez tlačítek.
// Výpis měst, u kterých se nedá nic udělat, vypadá jako porucha — hráč pak
// hledá, kde se pobočka zřizuje, a nenajde to, protože se dívá přímo na to.
// Tlačítko proto zůstává a jen zešedne.
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
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  let h = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') h++;
    else if (zdroj[j] === '}') { h--; if (!h) return zdroj.slice(i, j + 1); }
  }
  throw new Error('konec se nenašel');
}

const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
function okno(cash, zakladny) {
  let html = '';
  const ctx = {
    S: { cash: cash, areas: { hradec: { name: 'Hradec Králové', spots: [{ lat: 50, lon: 15 }] },
      brno: { name: 'Brno', spots: [{ lat: 49, lon: 16 }] } } },
    POBOCKA_CENA: 500000, POBOCKA_MESICNE: 15000,
    stredOblasti: (a) => ({ lat: a.spots[0].lat, lon: a.spots[0].lon }),
    zakladny: () => zakladny,
    kmMezi: (a, b) => Math.abs(a.lat - b.lat) * 111,
    sheet: (h) => { html = h; },
    esc: (x) => String(x == null ? '' : x),
    tx: (k) => k,
    kcFull: (n) => String(n),
    document: { querySelectorAll: () => [] },
    Object, Math,
  };
  vm.createContext(ctx);
  vm.runInContext(telo(zdroj, 'pobockaSheet'), ctx);
  ctx.pobockaSheet();
  return html;
}

console.log('\nOkno „Zřídit pobočku"');
const bohaty = okno(9200000, []);
ma((bohaty.match(/data-pob=/g) || []).length === 2, 'města k zřízení mají tlačítko');
ma(bohaty.indexOf('disabled') < 0, 's penězi je tlačítko aktivní');

const chudy = okno(196175, []);
ma((chudy.match(/data-pob=/g) || []).length === 2, 'bez peněz tlačítka nemizí — jen zešednou');
ma((chudy.match(/disabled/g) || []).length === 2, 'a jsou doopravdy zamčená');
ma(chudy.indexOf('hra.p_class_fine_err_na_pobocku') >= 0, 'nad seznamem stojí, kolik chybí');

const obsazeny = okno(9200000, [{ lat: 50, lon: 15 }]);
ma((obsazeny.match(/data-pob=/g) || []).length === 1, 'kde už základna stojí, tlačítko není');
ma(obsazeny.indexOf('hra.tady_uz_zakladnu_mas') > 0, 'a je u toho napsané proč');

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
