// HolyOS — testy forecast enginu Bankovního Business Planu.
// node scripts/test-bank-plan-forecast.js
const assert = require('assert');
const F = require('../services/bank-plan/forecast');

let passed = 0;
function ok(n, c) { assert.ok(c, n); console.log('  ✓ ' + n); passed++; }
function approx(n, g, e, t) { t = t == null ? 1e-6 : t; assert.ok(Math.abs(g - e) <= t, n + ' (got ' + g + ', exp ' + e + ')'); console.log('  ✓ ' + n); passed++; }

console.log('RAMP z kohort');
var ramp = F.rampFromCohort([{ median: 50 }, { median: 75 }, { median: 100 }], 100);
approx('ramp[0]=0.5', ramp[0], 0.5); approx('ramp[2]=1', ramp[2], 1);

console.log('FORECAST základ (bez dluhu)');
var f0 = F.buildForecast({
  months: 12, startUnits: 10, perUnitRevenue: 30000, ebitdaMargin: 0.5,
  maintenanceReservePct: 0, taxRatePct: 0, minLiquidity: 0,
  rampCurve: [1], newUnitsPerMonth: 0, unitAllInCapex: 0, unitCostBase: 1300000, targetUnitsPerMonth: 4,
  bankFinancingPct: 0,
});
approx('m0 revenue = 300000 (10×30000)', f0.rows[0].revenue, 300000);
approx('m0 ebitda = 150000', f0.rows[0].ebitda, 150000);
ok('bez dluhu je DSCR null', f0.rows[0].dscr === null);
ok('units konstantní 10', f0.rows[11].closingUnits === 10);

console.log('FORECAST růst + ramp');
var f1 = F.buildForecast({
  months: 6, startUnits: 0, perUnitRevenue: 1000, ebitdaMargin: 1,
  maintenanceReservePct: 0, taxRatePct: 0, minLiquidity: 0,
  rampCurve: [0.5, 1], newUnitsPerMonth: 1, unitAllInCapex: 0, unitCostBase: 100, targetUnitsPerMonth: 1,
  bankFinancingPct: 0,
});
// m0: 1 nová jednotka, ramp 0.5 → 500; m1: první jde na 1.0 (1000) + nová 0.5 (500) = 1500
approx('m0 revenue = 500', f1.rows[0].revenue, 500);
approx('m1 revenue = 1500', f1.rows[1].revenue, 1500);
ok('units rostou na 6', f1.rows[5].closingUnits === 6);

console.log('FORECAST dluh + facility limit');
var f2 = F.buildForecast({
  months: 12, startUnits: 0, perUnitRevenue: 0, ebitdaMargin: 0,
  newUnitsPerMonth: 5, unitAllInCapex: 1000000, unitCostBase: 1000000, bankFinancingPct: 70,
  interestRatePct: 6, maturityMonths: 84, graceMonths: 0,
  facilityLimit: 2100000, // unese jen 3 jednotky (3×700k = 2.1M)
  targetUnitsPerMonth: 4,
});
// dluh/jednotku = 700k; limit 2.1M → celkem 3 jednotky čerpáno, pak stop
approx('drawnTotal = 2 100 000', f2.summary.drawnTotal, 2100000, 1);
ok('m0 přidá jen 3 jednotky (facility strop)', f2.rows[0].newUnits === 3);
ok('m1 už nepřidá (facility vyčerpána)', f2.rows[1].newUnits === 0);
ok('equity total = 900k (3×300k)', Math.abs(f2.summary.totalEquity - 900000) < 1);

console.log('FORECAST DSCR + crossover');
var f3 = F.buildForecast({
  months: 24, startUnits: 20, perUnitRevenue: 40000, ebitdaMargin: 0.5,
  maintenanceReservePct: 3, taxRatePct: 19, minLiquidity: 100000,
  rampCurve: [1], newUnitsPerMonth: 0, unitAllInCapex: 1300000, unitCostBase: 1300000, bankFinancingPct: 70,
  interestRatePct: 6, maturityMonths: 84, graceMonths: 0, facilityLimit: 0, targetUnitsPerMonth: 4,
});
ok('DSCR bez dluhu (facility 0) je null', f3.summary.minDscr === null);
ok('crossover required = 4×1.3M = 5.2M', f3.summary.crossover.requiredMonthly === 5200000);

console.log('\n✅ Všech ' + passed + ' testů prošlo.');
