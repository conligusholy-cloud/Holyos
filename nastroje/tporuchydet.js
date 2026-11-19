// Deterministické poruchy: server a hra musí dostat tutéž poruchu.
//
// Porucha byla do 19. 11. los v prohlížeči. Server o ní věděl jen to, co mu
// klient napsal, takže kdo si hru upravil, mohl mít poruch kolik chtěl — nebo
// žádnou. Bylo to poslední místo, kde si server nemohl spočítat svoje.
//
// Teď je porucha vlastností místa a času. Celé to ale stojí na jediné věci:
// že obě strany počítají STEJNĚ. Kdyby se rozešly, hra by ukazovala poruchu,
// o které server neví, a v pokladně by z toho byl nevysvětlený rozdíl.
// Proto se tu neporovnává s mým výpočtem, ale se skutečným kódem z game.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../services/game/poruchy');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
function vytahni(re, co) {
  const m = hra.match(re);
  if (!m) { ok('v game.js se našlo: ' + co, false); return ''; }
  return m[0];
}
const kusy = [
  vytahni(/var MONTH_MS = [^\n]*\n/, 'MONTH_MS'),
  vytahni(/var PORUCHA_ROCNE = [^\n]*\n/, 'PORUCHA_ROCNE'),
  vytahni(/function spotHash\(id, salt\) \{[\s\S]*?\n\}/, 'spotHash'),
  vytahni(/var SANCE_V_OKNE = [^\n]*\n/, 'SANCE_V_OKNE'),
  vytahni(/function poruchaVOkne\(spotId, okno\) \{[\s\S]*?\n\}/, 'poruchaVOkne'),
  vytahni(/function poslednPorucha\(spotId, od, do_\) \{[\s\S]*?\n\}/, 'poslednPorucha'),
];
if (kusy.some((x) => !x)) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = { Math, Number, String };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);

// ── Konstanty musí sedět ─────────────────────────────────────────────────────
ok('herní měsíc sedí', box.MONTH_MS === P.MESIC_MS, '— ' + box.MONTH_MS);
ok('četnost poruch sedí', box.PORUCHA_ROCNE === P.PORUCHA_ROCNE);
ok('šance v okně sedí', Math.abs(box.SANCE_V_OKNE - P.SANCE_V_OKNE) < 1e-12);

// ── To hlavní: tisíc míst × dvacet oken, obě strany stejně ───────────────────
let shoda = 0, celkem = 0, porouchano = 0, rozdil = null;
for (let i = 0; i < 1000; i++) {
  const spot = 'misto-' + i + '-' + (i % 7);
  for (let w = 900; w < 920; w++) {
    celkem++;
    const a = box.poruchaVOkne(spot, w);
    const b = P.vOkne(spot, w);
    const stejne = (!a && !b) || (a && b && a.od === b.od && a.zavada === b.zavada && a.okno === b.okno);
    if (stejne) shoda++;
    else if (!rozdil) rozdil = { spot, w, hra: a, server: b };
    if (b) porouchano++;
  }
}
ok('hra a server počítají poruchu stejně', shoda === celkem,
  shoda + ' z ' + celkem + ' kombinací' + (rozdil ? ' · první rozdíl ' + JSON.stringify(rozdil) : ''));
// Kdyby se obě strany shodly na tom, že se neporouchá nikdy, test výš by
// prošel a nic by to neznamenalo.
ok('a nějaké poruchy při tom vůbec vznikly', porouchano > 0,
  '— ' + porouchano + ' z ' + celkem + ' (' + Math.round(porouchano / celkem * 100) + ' %)');

// ── Četnost odpovídá zadané ──────────────────────────────────────────────────
// Čtyřikrát za herní rok znamená třetinu oken. Kdyby to vyšlo jinak, hra by
// se porouchávala jinak často, než jak je napsané v pravidlech.
const pct = porouchano / celkem;
ok('poruchy chodí zhruba čtyřikrát za herní rok',
  Math.abs(pct - P.SANCE_V_OKNE) < 0.03, '— ' + (pct * 100).toFixed(1) + ' %');

// ── Stejný dotaz dá vždycky stejnou odpověď ──────────────────────────────────
// Tohle je ta vlastnost, kvůli které se porucha nedá odkliknout: dvě načtení
// hry nedají dvě různé poruchy.
const prvni = P.vOkne('misto-42', 905);
const druhy = P.vOkne('misto-42', 905);
ok('dvě načtení dají tutéž poruchu', JSON.stringify(prvni) === JSON.stringify(druhy));
ok('jiné místo má jiný osud',
  JSON.stringify(P.vOkne('misto-42', 905)) !== JSON.stringify(P.vOkne('misto-43', 905))
  || P.vOkne('misto-43', 905) === null);

// ── Interval ─────────────────────────────────────────────────────────────────
const od = 900 * P.MESIC_MS, do_ = 920 * P.MESIC_MS;
const vse = P.vIntervalu('misto-42', od, do_);
ok('všechny poruchy v intervalu leží uvnitř něj',
  vse.every((x) => x.od >= od && x.od <= do_), '— ' + vse.length);
ok('poslední je opravdu ta poslední',
  !vse.length || P.posledni('misto-42', od, do_).od === vse[vse.length - 1].od);
ok('prázdný interval nic nevrátí', P.vIntervalu('misto-42', 0, 0).length <= 1);
ok('nesmysly nic neshodí', P.vIntervalu(null, -5, -1).length === 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
