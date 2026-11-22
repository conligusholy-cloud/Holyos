// Žebříček a Velín počítají zisk z uloženého stavu hráče. Stav se přepočítá
// až když hráč hru otevře, takže po zastropování boostu by tam dny svítil
// zisk z návštěvnosti, kterou už nikdo mít nemůže. Tenhle test hlídá, že se
// uložený stav s nadlimitním boostem přepočte dolů — a že se nesahá na
// stavy, které strop dodržují.
const assert = require('assert');
const Module = require('module');
const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return { prisma: {} };
  return puvodni.apply(this, arguments);
};
const ACC = require('../routes/game-account.routes');
const NAV = require('../services/game/navstevnost');

const zbyde = ACC._zbydeMesicne;
const kor = ACC._korekceBoostu;
assert.strictEqual(typeof zbyde, 'function', 'zbydeMesicne se nepodařilo načíst');
assert.strictEqual(typeof kor, 'function', 'korekceBoostu se nepodařilo načíst');

// Stroj: tržba 100 000, nájem 5 000. Energie 9 %, servis 13 %.
function stroj(trzba, najem) {
  const t = Number(trzba), n = Number(najem) || 0;
  return { eco: { model: 'mini', revenue: t, rent: n,
    profit: t - Math.round(t * 0.09) - Math.round(t * 0.13) - n } };
}
function stav(boost, refs, units) {
  return { boost, refs, units, pobocky: [], cash: 0 };
}
// Nezávislý výpočet poměru návštěvností — ne opis z kódu, ale ze vzorce:
// strop = 1,1 + boost, základ = 0,45 + refs × 0,05 + boost.
function pomer(boost, refs) {
  const t = (b) => Math.min(1.1 + b, 0.45 + refs * 0.05 + b);
  return t(NAV.BOOST_MAX) / t(boost);
}

// 1) Hráč pod stropem — nesmí se mu hnout ani koruna.
{
  const st = stav(0.45, 10, [stroj(100000, 5000), stroj(60000, 0)]);
  const cekam = st.units.reduce((a, u) => a + u.eco.profit, 0);
  assert.strictEqual(kor(st), 1, 'pod stropem se nemá korigovat');
  assert.strictEqual(zbyde(st), cekam, 'zisk hráče pod stropem se nesmí měnit');
}

// 2) Hráč přesně na stropu (0,90) — pořád žádná korekce.
{
  const st = stav(NAV.BOOST_MAX, 10, [stroj(100000, 5000)]);
  assert.strictEqual(kor(st), 1, 'na stropu se nemá korigovat');
  assert.strictEqual(zbyde(st), st.units[0].eco.profit, 'na stropu se zisk nemění');
}

// 3) Petulakův případ — 30 karet, boost 4,50.
{
  const st = stav(4.5, 10, [stroj(100000, 5000)]);
  const p = pomer(4.5, 10);
  assert.ok(Math.abs(kor(st) - p) < 1e-12, 'špatný poměr návštěvností: ' + kor(st));
  const trzba = 100000 * p;
  const cekam = Math.round(trzba - Math.round(trzba * 0.09) - Math.round(trzba * 0.13) - 5000);
  assert.strictEqual(zbyde(st), cekam, 'přepočtený zisk nesedí');
  // Zisk musí spadnout výrazně — ne o pár procent.
  assert.ok(zbyde(st) < st.units[0].eco.profit * 0.5,
    'zisk s nadlimitním boostem měl spadnout alespoň na polovinu');
}

// 4) Nájem se neškáluje. Stroj, kterému nájem sežere celou tržbu, musí jít
//    po korekci do minusu — kdyby se škáloval i nájem, zůstal by v plusu.
{
  const st = stav(4.5, 10, [stroj(100000, 70000)]);
  assert.ok(zbyde(st) < 0, 'nájem se zřejmě škáluje s návštěvností: ' + zbyde(st));
}

// 5) Běžící kampaň poměr zmírní — návštěvnost obou variant roste o stejné
//    číslo, takže se rozdíl relativně zmenší.
{
  const bez = stav(4.5, 10, [stroj(100000, 0)]);
  const sKampani = Object.assign(stav(4.5, 10, [stroj(100000, 0)]),
    { kampan: { add: 0.25, do: Date.now() + 86400000 } });
  assert.ok(kor(sKampani) > kor(bez),
    'kampaň se do poměru nepromítla: ' + kor(sKampani) + ' vs ' + kor(bez));
  const stara = Object.assign(stav(4.5, 10, [stroj(100000, 0)]),
    { kampan: { add: 0.25, do: Date.now() - 1000 } });
  assert.ok(Math.abs(kor(stara) - kor(bez)) < 1e-12, 'doběhlá kampaň se nemá počítat');
}

// 6) Prázdný a nesmyslný stav nesmí spadnout.
{
  assert.strictEqual(zbyde(null), 0, 'null stav');
  assert.strictEqual(zbyde({}), 0, 'prázdný stav');
  assert.strictEqual(kor({ boost: 'nesmysl' }), 1, 'nečíselný boost');
}

console.log('tzebricekstrop: ok');
// Router si při načtení nastartuje časovače; bez tvrdého konce by test visel
// a pak spadl na prisma, kterou tu schválně nemáme.
Module.prototype.require = puvodni;
process.exit(0);
