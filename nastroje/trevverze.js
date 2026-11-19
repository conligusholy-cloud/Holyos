// Verze uloženého stavu: kdo smí přepsat koho.
//
// Tenhle test existuje kvůli konkrétní ztrátě. Hráč ConteDeJure dostal
// 19. 11. 2026 ve 20:52 z fondu 57 M, ve 20:58 jimi splatil úvěr na 50 M —
// a ve 21:13 ho jeho vlastní druhá rozehraná hra přepsala starým stavem.
// Peníze i splátka byly pryč a úvěr se vrátil na plných 50 000 000 L$.
// Projelo to proto, že ta stará hra svoji verzi neznala a server tehdy bral
// chybějící verzi jako „nekontroluj“.
//
// Pojistka má dvě možné chyby a obě jsou drahé. Když pustí míň, než má,
// nepůjde založit nová hra. Když pustí víc, mizí hráčům peníze. Proto se tu
// zkouší obojí a každá pojistka se schválně rozbije, ať je vidět, že test
// opravdu chytá to, co má.
const V = require('../services/game/stav-verze');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

const STAV = { profile: 'a', cash: 1 };

// ── Chybějící verze ─────────────────────────────────────────────────────────
ok('bez verze do účtu bez stavu projde',
  V.konflikt(null, 0, null) === false);
ok('bez verze do účtu bez stavu projde i když je rev undefined',
  V.konflikt(undefined, 0, null) === false);
ok('bez verze do účtu, který už stav MÁ, je konflikt',
  V.konflikt(null, 7, STAV) === true);
// Tohle je přesně ta ztráta: stav uložený, ale verze shodou okolností 0.
ok('bez verze do účtu se stavem a nulovou verzí je taky konflikt',
  V.konflikt(null, 0, STAV) === true);
ok('bez verze do účtu s verzí, ale bez stavu, je taky konflikt',
  V.konflikt(null, 3, null) === true);

// ── Verze sedí / nesedí ─────────────────────────────────────────────────────
ok('shodná verze projde', V.konflikt(5, 5, STAV) === false);
ok('shodná verze projde i jako řetězec', V.konflikt('5', 5, STAV) === false);
ok('starší verze je konflikt', V.konflikt(4, 5, STAV) === true);
ok('novější verze je taky konflikt', V.konflikt(6, 5, STAV) === true);
ok('nula proti nule projde (první uložení)', V.konflikt(0, 0, null) === false);
ok('nečíselná verze je konflikt', V.konflikt('abc', 5, STAV) === true);

// ── Rozbití pojistek ────────────────────────────────────────────────────────
// Každá pojistka se nahradí tou chybnou variantou a musí být vidět, že test
// na ni spadne. Bez tohohle by test mohl být prázdný a nikdo by to nepoznal.
function rozbij(nazev, chybna, pripady) {
  const spadlo = pripady.some(function (p) {
    return chybna(p[0], p[1], p[2]) !== p[3];
  });
  ok('rozbité „' + nazev + '“ test chytí', spadlo);
}

// Stará díra: chybějící verze = nekontroluj.
rozbij('bez verze se nekontroluje',
  function (rev, stateRev, state) {
    const akt = Number(stateRev || 0);
    return rev != null && Number(rev) !== akt;
  },
  [[null, 7, STAV, true], [null, 0, STAV, true], [null, 0, null, false]]);

// Opačná chyba: odmítat i první uložení nové hry.
rozbij('bez verze se vždycky odmítá',
  function (rev, stateRev, state) {
    if (rev == null) return true;
    return Number(rev) !== Number(stateRev || 0);
  },
  [[null, 0, null, false], [5, 5, STAV, false]]);

// Chyba, která by pustila nečíselnou verzi.
rozbij('nečíslo se bere jako shoda',
  function (rev, stateRev, state) {
    const akt = Number(stateRev || 0);
    const maStav = akt > 0 || !!(state && typeof state === 'object');
    if (rev == null) return maStav;
    return false;
  },
  [['abc', 5, STAV, true], [4, 5, STAV, true]]);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
