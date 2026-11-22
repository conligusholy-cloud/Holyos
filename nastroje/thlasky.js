// =============================================================================
// HolyOS — Laundromat Tycoon: test umístění hlášek
// =============================================================================
// Hlášky seděly dole a kryly tlačítka panelu: hráč mačkal „Koupit" a trefil
// hlášku, která se mu tam zrovna objevila. Patří nahoru, pod hlavičku —
// a výšku hlavičky si hra musí změřit, protože se liší jazykem i telefonem.
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
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  let h = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') h++;
    else if (zdroj[j] === '}') { h--; if (!h) return zdroj.slice(i, j + 1); }
  }
  throw new Error('konec se nenašel');
}

const css = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.css'), 'utf8');
const hra = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');

console.log('\nHlášky visí nahoře');
const pruh = css.slice(css.indexOf('.toasty{'), css.indexOf('.toast{'));
ma(/top:calc\(env\(safe-area-inset-top/.test(pruh), 'pruh hlášek je ukotvený k hornímu okraji');
ma(!/bottom:/.test(pruh), 'a není ukotvený ke spodnímu', pruh.indexOf('bottom:') >= 0 ? 'je tam bottom:' : 'žádné bottom');
ma(/translateY\(-6px\)/.test(css), 'hláška přilétá shora, ne zdola');
// Panel se kreslí pod hláškami, jinak by ji schoval.
const zSheet = Number((css.match(/\.sheet\{[^}]*z-index:(\d+)/) || [])[1]);
const zToast = Number((pruh.match(/z-index:(\d+)/) || [])[1]);
ma(zToast > zSheet, 'hláška je nad panelem', zToast + ' > ' + zSheet);

console.log('\nOdsazení se měří, ne hádá');
const ctx = {
  document: {
    querySelector: (s) => (s === 'header.top'
      ? { getBoundingClientRect: () => ({ bottom: 132 }) } : null),
  },
  Math,
};
vm.createContext(ctx);
vm.runInContext(telo(hra, 'toastyPodHlavicku'), ctx);
const box = { style: {} };
ctx.toastyPodHlavicku(box);
ma(box.style.top === '140px', 'pruh se posadí pod hlavičku', box.style.top);

// Když hlavička zrovna není (rozehrané okno infolinky, jiná stránka), nechá se
// CSS záloha — přepsat ji nulou by hlášky nalepilo na horní okraj.
const ctx2 = { document: { querySelector: () => null }, Math };
vm.createContext(ctx2);
vm.runInContext(telo(hra, 'toastyPodHlavicku'), ctx2);
const box2 = { style: {} };
ctx2.toastyPodHlavicku(box2);
ma(box2.style.top === undefined, 'bez hlavičky zůstane záloha z CSS');
const ctx3 = {
  document: { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 0 }) }) }, Math };
vm.createContext(ctx3);
vm.runInContext(telo(hra, 'toastyPodHlavicku'), ctx3);
const box3 = { style: {} };
ctx3.toastyPodHlavicku(box3);
ma(box3.style.top === undefined, 'odrolovaná hlavička hlášky nenalepí nahoru');

ma(/toastyPodHlavicku\(box\);/.test(hra), 'toast() si odsazení vyžádá při každé hlášce');

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
