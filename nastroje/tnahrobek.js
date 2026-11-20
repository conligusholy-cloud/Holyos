// Sundání náhrobku z jednoho místa.
//
// Náhrobek drží stroj mimo hru. U stroje zabaveného soudem je to správně,
// u místa, které se do hry vrátilo jinak, je to ztráta zaplaceného stroje.
// Sundává se proto adresně — a tenhle test hlídá hlavně to, co se sundat
// NESMÍ: cizí náhrobky, zbytek stavu a stav, který vůbec nedává smysl.
const N = require('../services/game/nahrobek');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ─── Sundání ─────────────────────────────────────────────────────────────────
const stav = { cash: 6055, prodano: { 'horice-0': 1, 'fabriano-1': 1, 'foligno-0': 1 },
  units: [{ spotId: 'horice-2' }] };
const r = N.sundej(stav, 'horice-0');
ok('náhrobek se sundá', r.zmena === true && r.state.prodano['horice-0'] === undefined);
ok('ostatní náhrobky zůstávají — ty stroje soud zabavil',
  r.state.prodano['fabriano-1'] === 1 && r.state.prodano['foligno-0'] === 1);
ok('zbytek stavu zůstává', r.state.cash === 6055 && r.state.units.length === 1);

// Původní stav se nesmí změnit: kdyby se přepisoval na místě a zápis do
// databáze pak spadl, zůstal by v paměti rozdělaný.
ok('původní stav se nemění', stav.prodano['horice-0'] === 1);

// ─── Co se sundat nesmí ──────────────────────────────────────────────────────
ok('místo bez náhrobku → beze změny', N.sundej(stav, 'praha-5').zmena === false);
ok('místo, kde stroj stojí, ale náhrobek nemá → beze změny',
  N.sundej(stav, 'horice-2').zmena === false);
ok('prázdné id nic nesundá', N.sundej(stav, '').zmena === false);
ok('chybějící id nic nesundá', N.sundej(stav, undefined).zmena === false);

// Hráč bez uloženého stavu, stav bez seznamu, stav špatného tvaru. Tohle
// všechno server dostane dřív nebo později — výjimka by shodila administraci.
ok('stav null', N.sundej(null, 'horice-0').zmena === false);
ok('stav bez seznamu náhrobků', N.sundej({ cash: 1 }, 'horice-0').zmena === false);
ok('seznam náhrobků je pole', N.sundej({ prodano: ['horice-0'] }, 'horice-0').zmena === false);
ok('stav je pole', N.sundej([1, 2], 'horice-0').zmena === false);
ok('stav je řetězec', N.sundej('nic', 'horice-0').zmena === false);

// Id z prototypu objektu není náhrobek. Bez vlastní kontroly by 'constructor'
// prošlo jako existující klíč a stav by se zbytečně přepsal.
ok('constructor není náhrobek',
  N.sundej({ prodano: {} }, 'constructor').zmena === false);
ok('toString není náhrobek',
  N.sundej({ prodano: {} }, 'toString').zmena === false);

// Tvarové pojistky musí být vidět i tam, kde by se bez nich doopravdy něco
// sundalo — jinak by to byly mrtvé řádky, o kterých si každý myslí, že hlídají.
ok('index v poli se nebere jako náhrobek',
  N.sundej({ prodano: ['horice-0'] }, '0').zmena === false);
ok('prázdné id neprojde, ani když takový klíč existuje',
  N.sundej({ prodano: { '': 1 } }, '').zmena === false);
const polePoleStav = [1, 2];
polePoleStav.prodano = { 'horice-0': 1 };
ok('stav v poli neprojde, ani když seznam náhrobků má',
  N.sundej(polePoleStav, 'horice-0').zmena === false);

// ─── Co hra na místě vidí ────────────────────────────────────────────────────
ok('stroj na místě se pozná', N.maStroj(stav, 'horice-2') === true);
ok('místo bez stroje se pozná', N.maStroj(stav, 'horice-0') === false);
ok('stav bez seznamu strojů nic neshodí', N.maStroj({}, 'horice-0') === false);
ok('stav null nic neshodí', N.maStroj(null, 'horice-0') === false);

// ─── Výběr míst k úklidu duchů ───────────────────────────────────────────────
// Úklid duchů maže stroj ze záboru. Pustit ho na všechno je nebezpečné: mezi
// duchy sedí i místa s běžící výpovědí a místa se zaplaceným nákupem, kde
// stroj hře CHYBÍ, ne přebývá. Proto se uklízí podle seznamu — a tenhle test
// hlídá hlavně to, že se seznam bere vážně a že překlep v id není ticho.
//
// Funkce se tahá ze zdroje: srovnani.js si bere databázi a ta se v testu
// rozjíždět nemusí.
const zdroj = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'game', 'srovnani.js'), 'utf8');
const kus = zdroj.match(/function vyberDuchy\(vsichni, spoty\) \{[\s\S]*?\n\}/);
ok('v srovnani.js se našlo: vyberDuchy', !!kus);
if (kus) {
  const box = {};
  vm.createContext(box);
  vm.runInContext(kus[0] + '\n', box);
  const vyberDuchy = box.vyberDuchy;
  const duchove = [
    { spot: 'fabriano-1' }, { spot: 'foligno-0' }, { spot: 'ostrava-0' },
  ];
  const a = vyberDuchy(duchove, ['fabriano-1', 'foligno-0']);
  ok('uklidí se jen vybraná místa',
    a.duchove.length === 2 && a.duchove.every((d) => d.spot !== 'ostrava-0'));
  ok('nevybrané místo zůstane nedotčené', a.nenalezeno.length === 0);

  // Tohle je ta past: id s překlepem by jinak prošlo jako hotová práce.
  const b = vyberDuchy(duchove, ['fabriano-1', 'fabriano-11']);
  ok('místo, které mezi duchy není, se ozve',
    b.duchove.length === 1 && b.nenalezeno.join() === 'fabriano-11');

  // Prázdné pole je výběr ničeho, ne „všechno". Celý průjezd proto seznam
  // vůbec neposílá — kdyby posílal prázdný, uklidil by nic a tvářil se, že
  // je hotovo.
  ok('prázdný seznam uklidí nic', vyberDuchy(duchove, []).duchove.length === 0);
  ok('bez seznamu se nic neohlašuje jako nenalezené',
    vyberDuchy(duchove, undefined).nenalezeno.length === 0);
  // Seznam, ze kterého po očištění nic nezbylo, nesmí znamenat „ukliď
  // všechno". Jinak by překlep smazal stroje na všech místech najednou.
  ok('seznam samých mezer uklidí nic, ne všechno',
    vyberDuchy(duchove, ['', '  ']).duchove.length === 0);
  ok('až chybějící seznam znamená všechna',
    vyberDuchy(duchove, undefined).duchove.length === 3
    && vyberDuchy(duchove, null).duchove.length === 3);
  ok('mezery kolem id nevadí',
    vyberDuchy(duchove, [' fabriano-1 ']).duchove.length === 1);
  // Duch bez id nesmí shodit výběr.
  ok('duch bez id nic neshodí',
    vyberDuchy([{ spot: 'a' }, {}, null], ['a']).duchove.length === 1);
  ok('žádní duchové → nic k úklidu, ale výběr se ozve',
    vyberDuchy([], ['a']).duchove.length === 0
    && vyberDuchy([], ['a']).nenalezeno.join() === 'a');
}

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
