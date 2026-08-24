// HolyOS — jednotkové testy finančního enginu Bankovního Business Planu.
// Spuštění: node scripts/test-bank-plan-engine.js
// Porovnává výstupy s ručně spočítanými kontrolními příklady (§58 zadání).

const assert = require('assert');
const E = require('../services/bank-plan/engine');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }
function approx(name, got, exp, tol) { const t = tol == null ? 1e-6 : tol; assert.ok(Math.abs(got - exp) <= t, name + ' (got ' + got + ', exp ' + exp + ')'); console.log('  ✓ ' + name); passed++; }

console.log('MĚNA / FX');
ok('sourceCurrency PL → PLN', E.sourceCurrencyForCode('00003PL') === 'PLN');
ok('sourceCurrency IE → EUR', E.sourceCurrencyForCode('00001IE') === 'EUR');
ok('sourceCurrency generic FR → EUR', E.sourceCurrencyForCode('00099FR') === 'EUR');
ok('sourceCurrency 00021FR override → CZK (fyzicky ČR)', E.sourceCurrencyForCode('00021FR') === 'CZK');
ok('sourceCurrency override param', E.sourceCurrencyForCode('2TAP', { '2TAP': 'EUR' }) === 'EUR');
ok('sourceCurrency CZ → CZK', E.sourceCurrencyForCode('00015CZ') === 'CZK');
ok('sourceCurrency legacy → CZK', E.sourceCurrencyForCode('2TAP') === 'CZK');
ok('sourceCurrency 2SPL (legacy končící PL) → CZK', E.sourceCurrencyForCode('2SPL') === 'CZK');
ok('sourceCurrency 00007PL (číselný) → PLN', E.sourceCurrencyForCode('00007PL') === 'PLN');
const fx = { CZK: 1, EUR: 25, PLN: 5.8 };
approx('convert 100 EUR → CZK = 2500', E.convert(100, 'EUR', 'CZK', fx), 2500);
approx('convert 2500 CZK → EUR = 100', E.convert(2500, 'CZK', 'EUR', fx), 100);
approx('convert 100 PLN → EUR = 23.2', E.convert(100, 'PLN', 'EUR', fx), 100 * 5.8 / 25);

console.log('STATISTIKA');
const p = E.percentiles([10, 20, 30, 40, 50]);
approx('median [10..50] = 30', p.p50, 30);
approx('avg = 30', p.avg, 30);
ok('min/max/count', p.min === 10 && p.max === 50 && p.count === 5);
approx('p25 (interp) = 20', p.p25, 20);
ok('percentiles prázdné pole', E.percentiles([]).count === 0);

// Sezónnost: leden 100, únor 200 → index 66.7 / 133.3 (průměr 150)
const seas = E.seasonalityIndex({ '2024-01': 100, '2024-02': 200 });
approx('sezónnost leden ≈ 66.7', seas[0], 66.7, 0.05);
approx('sezónnost únor ≈ 133.3', seas[1], 133.3, 0.05);
ok('sezónnost bez dat = null', seas[5] === null);

// Kohorta: 2 lokality, otevřeny v různých měsících, stejný ramp
const cohort = E.cohortCurve([
  { openDate: '2024-01-01', monthly: { '2024-01': 100, '2024-02': 200 } },
  { openDate: '2024-03-01', monthly: { '2024-03': 120, '2024-04': 220 } },
], 6);
approx('kohorta month0 avg = 110', cohort[0].avg, 110);
approx('kohorta month1 avg = 210', cohort[1].avg, 210);
ok('kohorta month0 count = 2', cohort[0].count === 2);

console.log('UNIT ECONOMICS');
// revenue 100000, rent 10000, service 15%, energy 9.5%, payment 1%, maintenance 3%
const se = E.siteEconomics({ revenue: 100000, rentMonthly: 10000, servicePct: 15, energyPct: 9.5, paymentFeePct: 1, maintenanceReservePct: 3 });
approx('service = 15000', se.service, 15000);
approx('energy = 9500', se.energy, 9500);
approx('directOpex = 35500', se.directOpex, 10000 + 15000 + 9500 + 1000);
approx('siteEbitda = 64500', se.siteEbitda, 64500);
approx('ebitdaMargin = 0.645', se.ebitdaMargin, 0.645);
approx('opCashFlow = 61500', se.operatingCashFlow, 64500 - 3000);

console.log('DLUH');
// anuita: 100000, 12% p.a. → 1% měsíčně, 12 splátek. Ověřeno: ≈ 8884.88
approx('anuita 100k/1%/12 ≈ 8884.88', E.annuityPayment(100000, 0.01, 12), 8884.878867834166, 1e-3);
approx('anuita 0% = P/n', E.annuityPayment(1200, 0, 12), 100);
// splátkový kalendář: jedna tranše 120000, 0% úrok, maturita 12, grace 0 → 10000 jistina/měs, 12 měs
const ds = E.buildDebtSchedule([{ month: 0, principal: 120000, annualRatePct: 0, maturityMonths: 12, graceMonths: 0 }], 24);
approx('tranše: principal m0 = 10000', ds.perMonth[0].principal, 10000);
approx('tranše: closing m0 = 110000', ds.perMonth[0].closingPrincipal, 110000);
approx('tranše: closing m11 = 0', ds.perMonth[11].closingPrincipal, 0, 1e-6);
approx('tranše: žádná splátka po maturitě (m12)', ds.perMonth[12].payment, 0);
approx('drawnTotal = 120000', ds.totals.drawnTotal, 120000);
// grace: 100000, 12% p.a., maturita 12, grace 3 → první 3 měsíce jen úrok (1000), bez jistiny
const dg = E.buildDebtSchedule([{ month: 0, principal: 100000, annualRatePct: 12, maturityMonths: 12, graceMonths: 3 }], 12);
approx('grace m0 úrok = 1000', dg.perMonth[0].interest, 1000, 1e-6);
approx('grace m0 jistina = 0', dg.perMonth[0].principal, 0);
ok('po grace se jistina splácí (m3 > 0)', dg.perMonth[3].principal > 0);

console.log('DSCR');
const dscr = E.dscrSeries([1500, 1200, 900], [1000, 1000, 1000]);
approx('DSCR m0 = 1.5', dscr.perMonth[0].dscr, 1.5);
approx('DSCR min = 0.9', dscr.min, 0.9);
approx('DSCR avg = 1.2', dscr.avg, (1500 + 1200 + 900) / 3000);

console.log('RŮST + RAMP');
const gu = E.growthUnits(10, 6, 2, 0);
ok('růst m0 opening 10 closing 12', gu[0].opening === 10 && gu[0].closing === 12);
ok('růst m5 closing = 22', gu[5].closing === 22);
// ramp: nová kohorta 1 jednotka v m0, ramp [0.5, 1], full 1000 → m0=500, m1..=1000
const ramp = E.applyRampToCohorts([1, 0, 0], [0.5, 1], 1000, 3);
approx('ramp m0 = 500', ramp[0], 500);
approx('ramp m1 = 1000', ramp[1], 1000);
approx('ramp m2 = 1000 (drží poslední)', ramp[2], 1000);

console.log('CROSSOVER');
const cx = E.selfFinancingCrossover([100000, 180000, 210000, 260000], 52000, 4);
approx('required = 208000', cx.requiredMonthly, 208000);
ok('crossover dosažen v m2 (210k ≥ 208k)', cx.reached && cx.month === 2);
const cx2 = E.selfFinancingCrossover([100000, 150000], 52000, 4);
ok('crossover nedosažen', cx2.reached === false && cx2.month === null);

console.log('WATERFALL');
const wf = E.cashWaterfall({ revenue: 100000, directOpex: 40000, centralOpex: 5000, taxes: 3000, maintenanceReserve: 2000, debtService: 15000, minLiquidityReserve: 5000, equityCapexNewUnits: 10000 });
approx('EBITDA = 60000', wf.ebitda, 60000);
approx('portfolioEBITDA = 55000', wf.portfolioEbitda, 55000);
approx('FCF before growth = 35000', wf.fcfBeforeGrowth, 55000 - 3000 - 2000 - 15000);
approx('cashForExpansion = 30000', wf.cashForExpansion, 30000);
approx('closingCash = 20000', wf.closingCash, 20000);

console.log('\n✅ Všech ' + passed + ' testů prošlo.');
