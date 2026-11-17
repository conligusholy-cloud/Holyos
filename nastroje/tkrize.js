// Kdo je v nouzi.
//
// Rozhoduje to o tom, čí jméno se objeví ostatním na nástěnce — a být tam
// omylem je nepříjemné. Stejně tak nebýt tam, když už mi za chvíli propadne
// prádlomat.
const KRIZE = require('../services/game/krize');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

const ZA_HODINU = new Date(Date.now() + 3600000);
const ZA_TYDEN = new Date(Date.now() + 7 * 86400000);

// mesicu/castka/urok nás nezajímají, jen splátka, termín a zástava.
function pujcka(o) {
  return Object.assign({ stav: 'bezi', splatka: 100000, zmeskano: 0,
    dalsi_at: ZA_HODINU, zastava_spot: null, zastava_podil: null }, o || {});
}

// ── Bez půjček není co řešit ─────────────────────────────────────────────────
ok('kdo nikomu nedluží, je v pohodě',
  KRIZE.stav([], { cash: 0 }).stupen === 'ok');

// ── Kryté splátky ────────────────────────────────────────────────────────────
ok('na splátku s rezervou → ok',
  KRIZE.stav([pujcka({})], { cash: 500000 }).stupen === 'ok');

ok('těsně nad splátkou → varování',
  KRIZE.stav([pujcka({})], { cash: 120000 }).stupen === 'varovani',
  '— ' + KRIZE.stav([pujcka({})], { cash: 120000 }).stupen);

// ── Nemá na splátku ──────────────────────────────────────────────────────────
let s = KRIZE.stav([pujcka({})], { cash: 30000 });
ok('nedostatek na splatnou splátku → krize', s.stupen === 'krize', '— ' + s.stupen);
ok('chybí právě rozdíl', s.chybi === 70000, '— ' + s.chybi);

// ── Zmeškaná splátka ─────────────────────────────────────────────────────────
s = KRIZE.stav([pujcka({ zmeskano: 1 })], { cash: 5000000 });
ok('zmeškaná splátka je krize i při plné kapse', s.stupen === 'krize', '— ' + s.stupen);

// ── Blízko propadnutí ────────────────────────────────────────────────────────
s = KRIZE.stav([pujcka({ zastava_spot: 'praha-1' })], { cash: 0 });
ok('se zástavou propadá hned při první → propadne', s.stupen === 'propadne',
  '— ' + s.stupen + ', zbývá pokusů ' + s.zbyva_pokusu);

s = KRIZE.stav([pujcka({ zmeskano: 1 })], { cash: 0 });
ok('bez zástavy po první zmeškané ještě jen krize', s.stupen === 'krize',
  '— ' + s.stupen + ', zbývá pokusů ' + s.zbyva_pokusu);

s = KRIZE.stav([pujcka({ zmeskano: 2 })], { cash: 0 });
ok('bez zástavy po druhé zmeškané už propadne', s.stupen === 'propadne',
  '— ' + s.stupen + ', zbývá pokusů ' + s.zbyva_pokusu);

s = KRIZE.stav([pujcka({ zastava_podil: 0.2 })], { cash: 0 });
ok('zástava podílem se počítá stejně jako prádlomatem', s.stupen === 'propadne');

// ── Vzdálená splátka se nepočítá jako brzy splatná ───────────────────────────
s = KRIZE.stav([pujcka({ dalsi_at: ZA_TYDEN })], { cash: 0 });
ok('splátka za týden není brzy splatná', s.splatne_brzy === 0, '— ' + s.splatne_brzy);
ok('a bez zmeškané to není ani krize', s.stupen === 'ok', '— ' + s.stupen);

// ── Splacené a propadlé půjčky se ignorují ───────────────────────────────────
s = KRIZE.stav([pujcka({ stav: 'splaceno', zmeskano: 5 }),
  pujcka({ stav: 'propadlo', zmeskano: 9 })], { cash: 0 });
ok('doběhlé půjčky už nikoho netrápí', s.stupen === 'ok' && s.pujcek === 0,
  '— ' + s.stupen + ', běžících ' + s.pujcek);

// ── Víc půjček najednou ──────────────────────────────────────────────────────
s = KRIZE.stav([pujcka({ splatka: 60000 }), pujcka({ splatka: 40000 })], { cash: 90000 });
ok('splátky se sčítají', s.splatne_brzy === 100000 && s.chybi === 10000,
  '— splatné ' + s.splatne_brzy + ', chybí ' + s.chybi);

// Nejhorší půjčka určuje stupeň: jedna se zástavou mezi třemi bez ní.
s = KRIZE.stav([pujcka({}), pujcka({ zastava_spot: 'brno-0' }), pujcka({})], { cash: 0 });
ok('rozhoduje ta nejohroženější půjčka', s.stupen === 'propadne', '— ' + s.stupen);

// ── Nesmysly ve stavu nic neshodí ────────────────────────────────────────────
ok('prázdný stav hry se bere jako nula hotovosti',
  KRIZE.stav([pujcka({})], null).stupen === 'krize');
ok('záporná hotovost se bere jako nula',
  KRIZE.stav([pujcka({})], { cash: -5000 }).chybi === 100000);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
