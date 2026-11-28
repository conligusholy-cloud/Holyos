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
    S: { cash: cash, sidlo: { lat: 49, lon: 16 },
      areas: { hradec: { name: 'Hradec Králové', spots: [{ lat: 50, lon: 15 }] },
        brno: { name: 'Brno', spots: [{ lat: 49, lon: 16 }] },
        kanazawa: { name: '金沢市', spots: [{ lat: 36, lon: 136 }] } } },
    POBOCKA_CENA: 500000, POBOCKA_MESICNE: 15000,
    stredOblasti: (a) => ({ lat: a.spots[0].lat, lon: a.spots[0].lon }),
    zakladny: () => zakladny,
    kmMezi: (a, b) => Math.abs(a.lat - b.lat) * 111,
    sheet: (h) => { html = h; },
    esc: (x) => String(x == null ? '' : x),
    tx: (k) => k,
    kcFull: (n) => String(n),
    cislo1: (n) => String(n),
    document: { querySelectorAll: () => [] },
    // Políčko na hledání se napojuje přes $(); v testu stačí, že tu je.
    $: () => null,
    Object, Math,
  };
  vm.createContext(ctx);
  vm.runInContext(telo(zdroj, 'bezHacku') + '\n' + telo(zdroj, 'pobockaSheet'), ctx);
  ctx.pobockaSheet();
  return html;
}

console.log('\nOkno „Zřídit pobočku"');
const bohaty = okno(9200000, []);
ma((bohaty.match(/data-pob=/g) || []).length === 3, 'města k zřízení mají tlačítko');
ma(bohaty.indexOf('disabled') < 0, 's penězi je tlačítko aktivní');

const chudy = okno(196175, []);
ma((chudy.match(/data-pob=/g) || []).length === 3, 'bez peněz tlačítka nemizí — jen zešednou');
ma((chudy.match(/disabled/g) || []).length === 3, 'a jsou doopravdy zamčená');
ma(chudy.indexOf('hra.p_class_fine_err_na_pobocku') >= 0, 'nad seznamem stojí, kolik chybí');

const obsazeny = okno(9200000, [{ lat: 50, lon: 15 }]);
ma((obsazeny.match(/data-pob=/g) || []).length === 2, 'kde už základna stojí, tlačítko není');
ma(obsazeny.indexOf('hra.tady_uz_zakladnu_mas') > 0, 'a je u toho napsané proč');

// ─── Hledání a pořadí ────────────────────────────────────────────────────────
// Hráč měl stovky prozkoumaných měst v azbuce a japonštině vypsané pod sebou
// v pořadí, jak přibývala. Nenašel v tom ani město, ve kterém bydlí.
console.log('\nHledání v seznamu měst');
ma(bohaty.indexOf('id="pob-hledat"') > 0, 'nad seznamem je políčko na hledání');
ma(bohaty.indexOf('hra.pobocka_nic_nenaslo') > 0, 'a je čím odpovědět, když nic nesedí');
// Nejbližší nahoře: Brno je v sídle, Hradec 111 km, Kanazawa přes půl světa.
const poradi = (bohaty.match(/class="nick">([^<]+)/g) || []).map((x) => x.split('>')[1]);
ma(poradi[0] === 'Brno' && poradi[1] === 'Hradec Králové' && poradi[2] === '金沢市',
  'nejbližší město je nahoře', poradi.join(' · '));
ma(/<i>hra\.prozkoumane_mesto · 111 km<\/i>/.test(bohaty), 'u každého stojí, jak je daleko');
// Podle čeho se hledá: bez háčků a bez ohledu na velikost písmen. Azbuka
// a japonština se nechávají, jak jsou — tam stačí porovnat, co hráč napsal.
ma(/data-hledat="hradec kralove"/.test(bohaty), 'hledá se bez háčků a malými písmeny');
ma(/data-hledat="金沢市"/.test(bohaty), 'a japonština se nijak nekomolí');
ma(/r\.style\.display = sedi \? '' : 'none';/.test(zdroj),
  'hledá se skrýváním řádků, ne překreslením');
ma(zdroj.indexOf("var hl = $('pob-hledat');") > 0, 'políčko je napojené');

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
