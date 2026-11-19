// Minimální dividenda jako NEDOPLATEK, ne jako zabavení.
//
// Většina může firmě uložit, kolik měsíčně vyplatí nejméně. Původní námitka
// proti téhle pravomoci — že vynucená výplata je vymáhání peněz z cizího
// účtu, dokud je hotovost firmy hotovostí majitele — pořád platí, a proto se
// nic nevymáhá: co firma nevydělá, zůstane zapsané a vyplatí se, až vydělá.
//
// Jediná mez, na které to celé stojí: víc než svůj díl zisku firma
// nevyplatí nikdy. Bez ní by z dividendy byla exekuce.
const D = require('../services/game/dividenda');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Beze změny: bez minima se chová přesně jako dřív ─────────────────────────
let r = D.rozpad(1000000, 0.3, 1, 0, 0);
ok('bez minima je výplata jako dřív', r.vyplata === D.castka(1000000, 0.3, 1),
  '— ' + r.vyplata);
ok('a nevzniká žádný nedoplatek', r.nedoplatek === 0);
r = D.rozpad(1000000, 0.3, 0.5, 0, 0);
ok('poloviční politika krátí jako dřív', r.vyplata === 150000, '— ' + r.vyplata);

// ── Minimum přebije politiku, dokud na něj firma vydělá ──────────────────────
r = D.rozpad(1000000, 0.3, 0, 400000, 0);
ok('při nulové politice se minimum přesto vyplatí',
  r.vyplata === 120000 && r.nedoplatek === 0, '— ' + r.vyplata);
r = D.rozpad(1000000, 0.3, 1, 400000, 0);
ok('když politika dává víc, platí politika',
  r.vyplata === 300000, '— ' + r.vyplata);

// ── To podstatné: víc než svůj díl zisku firma nedá ──────────────────────────
r = D.rozpad(100000, 0.3, 1, 1000000, 0);
ok('výplata nepřeteče podíl na zisku', r.vyplata === 30000, '— ' + r.vyplata);
ok('zbytek zůstane jako nedoplatek', r.nedoplatek === 270000, '— ' + r.nedoplatek);

r = D.rozpad(0, 0.3, 1, 400000, 0);
ok('bez zisku se nevyplatí nic', r.vyplata === 0, '— ' + r.vyplata);
ok('a celý slib se zapíše', r.nedoplatek === 120000, '— ' + r.nedoplatek);

// ── Nedoplatek se splácí, jakmile firma vydělá ───────────────────────────────
r = D.rozpad(1000000, 0.3, 0, 0, 120000);
ok('starý nedoplatek se vyplatí i bez politiky a bez minima',
  r.vyplata === 120000 && r.nedoplatek === 0, '— ' + r.vyplata);
r = D.rozpad(1000000, 0.3, 1, 100000, 90000);
ok('nedoplatek se sčítá s minimem a politika může být vyšší',
  r.vyplata === 300000 && r.nedoplatek === 0, '— ' + r.vyplata);
r = D.rozpad(200000, 0.3, 1, 100000, 500000)
ok('co se nevejde do zisku, zůstane dlužné dál',
  r.vyplata === 60000 && r.nedoplatek === 470000, '— ' + r.vyplata + ' / ' + r.nedoplatek);

// ── Ztráta se nemění ─────────────────────────────────────────────────────────
r = D.rozpad(-500000, 0.3, 1, 400000, 0);
ok('ztrátu nese podílník celou jako dřív', r.vyplata === -150000, '— ' + r.vyplata);
ok('a minimum se za ztrátový měsíc zapíše', r.nedoplatek === 120000, '— ' + r.nedoplatek);
r = D.rozpad(-500000, 0.3, 0, 0, 0);
ok('politika ztrátu nekrátí ani teď', r.vyplata === -150000, '— ' + r.vyplata);

// ── Meze toho, co jde slíbit ─────────────────────────────────────────────────
ok('nesmysl je nula', D.platnyMin('abc') === 0 && D.platnyMin(null) === 0);
ok('záporné minimum je nula', D.platnyMin(-5000) === 0);
ok('strop slibu je měsíční zisk firmy', D.stropMin(850000) === 850000);
ok('ztrátová firma nesmí slíbit nic', D.stropMin(-100000) === 0);

ok('prázdné vstupy nic neshodí', D.rozpad(null, null, null, null, null).vyplata === 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
