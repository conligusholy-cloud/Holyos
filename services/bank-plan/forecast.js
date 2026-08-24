// HolyOS — Bankovní Business Plan: měsíční forecast portfolia + financování.
// Čistý deterministický modul (bez DB/HTTP) — skládá engine funkce do integrovaného
// měsíčního modelu: růst → tržby (ramp nových kohort) → EBITDA → daně/rezervy →
// dluh (čerpání po jednotkách) → DSCR → cash waterfall → Self-Financing Crossover.
// Vše v jedné base měně. Vstupy jsou už po scénářových úpravách (revenueFactor apod.).

'use strict';

const E = require('./engine');

// rampCurve[k] = podíl (0..1) stabilizované tržby v k-tém měsíci provozu nové lokality.
// Odvození z kohortních mediánů: cohortMedian[k] / stabilized (poslední/plateau), cap 1.
function rampFromCohort(cohort, stabilized) {
  if (!Array.isArray(cohort) || !cohort.length || !stabilized) return [1];
  return cohort.map((c) => {
    const v = (c && c.median != null) ? c.median : stabilized;
    const f = v / stabilized;
    return Math.max(0, Math.min(1.2, Math.round(f * 100) / 100));
  });
}

function buildForecast(p) {
  const months = Math.max(1, Math.floor(p.months || 120));
  const startUnits = Math.max(0, Math.floor(p.startUnits || 0));
  const perUnitRevenue = Number(p.perUnitRevenue) || 0;   // stabilizovaná měsíční tržba bez DPH / jednotku (base)
  const margin = Number(p.ebitdaMargin) || 0;              // 0..1
  const centralMonthly = Number(p.centralCostMonthly) || 0;
  const taxPct = Number(p.taxRatePct) || 0;
  const maintPct = Number(p.maintenanceReservePct) || 0;   // % z tržby
  const minLiquidity = Number(p.minLiquidity) || 0;
  const rampCurve = (Array.isArray(p.rampCurve) && p.rampCurve.length) ? p.rampCurve : [1];

  const newPerMonth = Math.max(0, Number(p.newUnitsPerMonth) || 0);
  const targetUnits = Math.max(0, Number(p.targetUnitsPerMonth) || 0);
  const unitAllIn = Number(p.unitAllInCapex) || 0;         // all-in CAPEX / jednotku (base)
  const unitCostBase = Number(p.unitCostBase) || unitAllIn; // cena stroje (pro crossover target), base
  const bankPct = Math.min(100, Math.max(0, Number(p.bankFinancingPct) || 0));
  const ratePct = Number(p.interestRatePct) || 0;
  const maturity = Math.max(1, Math.floor(p.maturityMonths || 84));
  const grace = Math.max(0, Math.floor(p.graceMonths || 0));
  const facilityLimit = (p.facilityLimit != null) ? Number(p.facilityLimit) : Infinity;

  // 1) Plán nových jednotek (deterministický) + čerpání dluhu po jednotkách (do limitu facility).
  // Stavíme STÁLE svým tempem (newPerMonth). Úvěr financuje část každé jednotky až do
  // vyčerpání rámce; jednotky nad rámec (nebo jejich část) se hradí z vlastního kapitálu/cash.
  // Růst se tedy nezastaví, jen se po vyčerpání rámce přesune na vlastní zdroje.
  const newCohorts = new Array(months).fill(0);
  const drawdowns = [];
  const equityPerUnit = unitAllIn * (1 - bankPct / 100);
  const debtPerUnit = unitAllIn * (bankPct / 100);
  let drawnCumulative = 0;
  const equityByMonth = new Array(months).fill(0);
  for (let m = 0; m < months; m++) {
    const add = newPerMonth;
    newCohorts[m] = add;
    if (add <= 0) continue;
    let debtDraw = 0;
    if (debtPerUnit > 0 && isFinite(facilityLimit)) {
      const remaining = Math.max(0, facilityLimit - drawnCumulative);
      debtDraw = Math.min(add * debtPerUnit, remaining); // částečné čerpání ok — rámec je v penězích
    } else if (debtPerUnit > 0) {
      debtDraw = add * debtPerUnit; // bez limitu
    }
    if (debtDraw > 0) { drawdowns.push({ month: m, principal: debtDraw, annualRatePct: ratePct, maturityMonths: maturity, graceMonths: grace }); drawnCumulative += debtDraw; }
    // Vlastní zdroje = celý all-in těchto jednotek minus to, co pokryl úvěr.
    equityByMonth[m] = (add * unitAllIn) - debtDraw;
  }

  // 2) Tržby: stávající jednotky stabilně + nové kohorty přes ramp.
  const existingRev = startUnits * perUnitRevenue;
  const newRev = E.applyRampToCohorts(newCohorts, rampCurve, perUnitRevenue, months);
  const unitsSeries = E.growthUnits(startUnits, months, newCohorts, 0);

  // 3) Dluh — splátkový kalendář ze všech tranší.
  const debt = E.buildDebtSchedule(drawdowns, months);

  // 4) Měsíční řádky + waterfall.
  const rows = [];
  const cfadsArr = [], dsArr = [], cashForExpArr = [], crossArr = [];
  let closingCash = 0;
  for (let m = 0; m < months; m++) {
    const revenue = existingRev + newRev[m];
    const ebitda = revenue * margin;
    const portfolioEbitda = ebitda - centralMonthly;
    const interest = debt.perMonth[m].interest;
    const debtService = debt.perMonth[m].payment;
    const maintenance = revenue * maintPct / 100;
    const taxable = Math.max(0, portfolioEbitda - interest);
    const tax = taxable * taxPct / 100;
    const cfads = portfolioEbitda - tax - maintenance;
    const dscr = debtService > 0 ? cfads / debtService : null;
    const fcfBeforeGrowth = cfads - debtService;
    const cashForExpansion = fcfBeforeGrowth - minLiquidity;
    const equityCapex = equityByMonth[m];
    closingCash += (fcfBeforeGrowth - equityCapex);
    // Crossover počítáme BEZ splátky úvěru (jako by byly stroje splacené) — i daň bez úrokového štítu.
    const taxNoDebt = Math.max(0, portfolioEbitda) * taxPct / 100;
    const crossCash = portfolioEbitda - taxNoDebt - maintenance - minLiquidity;
    cfadsArr.push(cfads); dsArr.push(debtService); cashForExpArr.push(cashForExpansion); crossArr.push(crossCash);
    rows.push({
      month: m, openUnits: unitsSeries[m].opening, newUnits: unitsSeries[m].added, closingUnits: unitsSeries[m].closing,
      revenue, ebitda, portfolioEbitda, interest, principal: debt.perMonth[m].principal, debtService,
      outstanding: debt.perMonth[m].closingPrincipal, tax, maintenance, cfads, dscr,
      fcfBeforeGrowth, cashForExpansion, equityCapex, closingCash,
    });
  }

  // 5) DSCR souhrn + crossover.
  const dscrSum = E.dscrSeries(cfadsArr, dsArr);
  // Crossover = kdy volné cash flow BEZ splátek úvěru (stroje jako splacené) utáhne cíl.
  const crossover = E.selfFinancingCrossover(crossArr, unitCostBase, targetUnits);
  const crossRow = crossover.reached ? rows[crossover.month] : null;

  const peakDebt = rows.reduce((a, r) => Math.max(a, r.outstanding), 0);
  const totalEquity = equityByMonth.reduce((a, x) => a + x, 0);
  const unitsEnd = rows.length ? rows[rows.length - 1].closingUnits : startUnits;

  return {
    months, rows,
    summary: {
      startUnits, unitsEnd, newTotal: newCohorts.reduce((a, x) => a + x, 0),
      minDscr: dscrSum.min, avgDscr: dscrSum.avg,
      peakDebt: Math.round(peakDebt), drawnTotal: Math.round(debt.totals.drawnTotal), totalEquity: Math.round(totalEquity),
      crossover: crossover.reached ? {
        month: crossover.month, requiredMonthly: Math.round(crossover.requiredMonthly),
        units: crossRow.closingUnits, revenue: Math.round(crossRow.revenue), portfolioEbitda: Math.round(crossRow.portfolioEbitda),
        outstanding: Math.round(crossRow.outstanding), cashForExpansion: Math.round(crossArr[crossover.month]),
      } : { reached: false, requiredMonthly: Math.round(crossover.requiredMonthly) },
    },
  };
}

module.exports = { buildForecast, rampFromCohort };
