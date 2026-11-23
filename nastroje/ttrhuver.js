// =============================================================================
// HolyOS — Laundromat Tycoon: nákup hotové provozovny z tržiště se neplatí dvakrát
// =============================================================================
// Spoluúčast (20 %) je to NEJMÉNĚ, co banka chce z vlastní kapsy. Do výpočtu
// se ale posílala jako „tolik chci zaplatit sám", takže si i hráč s osmi
// miliony v hotovosti bral na provozovnu za 1,4 mil. maximální úvěr: v hře
// mu z účtu odešla celá cena a k tomu mu zůstal dluh na 80 % — vypadalo to,
// že zaplatil dvakrát.
//
// Všude jinde ve hře canFinance() bez zadání platí z kapsy, co jde, a půjčuje
// jen zbytek. Tenhle test hlídá, že to tak dělá i tržiště.
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

// Skutečné canFinance() a trhFinance() z game.js, okolí dosazené.
function postav(hotovost) {
  const ctx = vm.createContext({ Math, Number, console,
    CASH_RESERVE: 120000, TRH_SPOLUUCAST: 0.2,
    S: { cash: hotovost, loan: 0, bank: 50000000, profile: 'p' },
    PROFILES: { p: {} },
    zastavaStrop: () => 50000000,
    maSkraloup: () => false,
    monthlyProfit: () => 16000000,
    splatkyMesicne: () => 0,
    stropPodleZisku: () => 50000000,
    trhZiskUMe: () => ({ profit: 60000 }),
    tx: (k) => k, kcFull: (x) => String(x),
  });
  vm.runInContext(telo(HRA, 'canFinance') + '\n' + telo(HRA, 'trhFinance')
    + '\nthis.F = trhFinance;', ctx);
  return ctx.F;
}

// ─── Tomášův případ: 8,5 mil. v hotovosti, provozovna za 1 437 281 ──────────
{
  console.log('\nKdo na to má, nebere úvěr');
  const F = postav(8500000);
  const f = F({ cena: 1437281, model: 'flex' }, null);
  ma(f.ok, 'koupě projde');
  ma(f.need === 0, 'banka nepůjčuje nic', f.need);
  ma(f.own === 1437281, 'platí se celá cena z kapsy', f.own);
  ma(f.own + f.need === 1437281, 'a dohromady to dává cenu, ne dvojnásobek');
}

// ─── Kdo na to nemá, dostane úvěr jako dřív ─────────────────────────────────
{
  console.log('\nKdo na to nemá, si půjčí');
  const F = postav(500000);
  const f = F({ cena: 1437281, model: 'flex' }, null);
  ma(f.ok, 'koupě projde');
  ma(f.own === 380000, 'z kapsy jde všechno kromě rezervy', f.own);
  ma(f.need === 1057281, 'zbytek doplatí banka', f.need);
  ma(f.own + f.need === 1437281, 'součet je cena');
  ma(f.own >= Math.ceil(1437281 * 0.2), 'a spoluúčast je nad minimem');
}

// ─── Pod spoluúčastí banka nepůjčí ──────────────────────────────────────────
{
  console.log('\nSpoluúčast pořád platí');
  const F = postav(200000);          // 200 000 < 20 % z 1 437 281
  const f = F({ cena: 1437281, model: 'flex' }, null);
  ma(!f.ok, 'bez spoluúčasti koupě neprojde');
  ma(f.minVlastni === Math.ceil(1437281 * 0.2), 'minimum je pětina ceny', f.minVlastni);
  ma(!!f.duvod, 'a hráč se dozví proč');
}

// ─── Ruční volba se respektuje a nepustí pod minimum ────────────────────────
{
  console.log('\nRuční volba');
  const F = postav(8500000);
  const a = F({ cena: 1000000, model: 'flex' }, 300000);
  ma(a.own === 300000 && a.need === 700000, 'kdo chce platit míň, platí míň',
    a.own + ' / ' + a.need);
  const b = F({ cena: 1000000, model: 'flex' }, 50000);
  ma(b.own === 200000, 'pod spoluúčast to nepustí', b.own);
}

// ─── A v kódu nesmí zbýt staré „zaplať jen minimum" ─────────────────────────
{
  console.log('\nV kódu');
  ma(/canFinance\(n\.cena, chci == null \? null :/.test(HRA),
    'bez zadání se platí z kapsy, co jde');
  ma(!/chci == null \? minVlastni :/.test(HRA), 'spoluúčast se nedosazuje jako přání');
  ma(/trhFinance\(n, null\)/.test(HRA), 'panel i nákup se ptají stejně');
  // Úvěr se do hry zapisuje jen tehdy, když ho banka opravdu dala.
  ma(/if \(f2\.need > 0\) \{/.test(HRA), 'bez úvěru se žádný dluh nezakládá');
}

console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
