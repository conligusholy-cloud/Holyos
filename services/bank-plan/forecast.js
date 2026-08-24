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
  // Odpisy: každá NOVÁ jednotka se rovnoměrně odepisuje po depMonths (daňový štít).
  const depMonths = Math.max(0, Math.floor(p.depreciationMonths || 0));
  const unitDep = Number(p.unitDepBase) || 0;
  const monthlyDepPerUnit = (depMonths > 0 && unitDep > 0) ? unitDep / depMonths : 0;

  // 1) Plán nových jednotek (deterministický) + čerpání dluhu po jednotkách (do limitu facility).
  // Stavíme svým tempem (newPerMonth), ale JEN dokud vydrží úvěrový rámec. Každá jednotka
  // = úvěr (bankPct %) + povinné spolufinancování z vlastních zdrojů. Po vyčerpání rámce
  // se výstavba zastaví (prostaví se pouze objem financovaný bankou + příslušná equity).
  const newCohorts = new Array(months).fill(0);
  const drawdowns = [];
  const equityPerUnit = unitAllIn * (1 - bankPct / 100);
  const debtPerUnit = unitAllIn * (bankPct / 100);
  let drawnCumulative = 0;
  const equityByMonth = new Array(months).fill(0);
  for (let m = 0; m < months; m++) {
    let add = newPerMonth;
    if (debtPerUnit > 0 && isFinite(facilityLimit)) {
      const remaining = Math.max(0, facilityLimit - drawnCumulative);
      const maxByFacility = Math.floor(remaining / debtPerUnit + 1e-9); // kolik jednotek ještě rámec unese
      add = Math.min(add, maxByFacility);
    }
    newCohorts[m] = add;
    if (add <= 0) continue;
    if (debtPerUnit > 0) { drawdowns.push({ month: m, principal: debtPerUnit * add, annualRatePct: ratePct, maturityMonths: maturity, graceMonths: grace }); drawnCumulative += debtPerUnit * add; }
    equityByMonth[m] = equityPerUnit * add; // jen povinné spolufinancování
  }

  // 2) Tržby: stávající jednotky stabilně + nové kohorty přes ramp.
  const existingRev = startUnits * perUnitRevenue;
  const newRev = E.applyRampToCohorts(newCohorts, rampCurve, perUnitRevenue, months);
  const unitsSeries = E.growthUnits(startUnits, months, newCohorts, 0);

  // 3) Dluh — splátkový kalendář ze všech tranší.
  const debt = E.buildDebtSchedule(drawdowns, months);

  // Odpisy po měsících (z nových kohort, každá jednotka po depMonths).
  const depArr = new Array(months).fill(0);
  if (monthlyDepPerUnit > 0) {
    for (let k = 0; k < months; k++) {
      const cnt = newCohorts[k]; if (!cnt) continue;
      for (let m = k; m < Math.min(months, k + depMonths); m++) depArr[m] += cnt * monthlyDepPerUnit;
    }
  }

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
    const depreciation = depArr[m];
    const taxable = Math.max(0, portfolioEbitda - interest - depreciation); // odpisy = daňový štít
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

// Reinvestiční režim: kromě financované výstavby (rámec) se z NAKUMULOVANÉHO volného
// cash flow kupují další stroje — kdykoliv pool ≥ cena stroje (all-in), postav další.
// Financované jednotky = dluh (do rámce) + externí equity; reinvestiční jednotky = z cash flow.
function buildReinvestForecast(p) {
  const months = Math.max(1, Math.floor(p.months || 120));
  const startUnits = Math.max(0, Math.floor(p.startUnits || 0));
  const perUnitRevenue = Number(p.perUnitRevenue) || 0;
  const margin = Number(p.ebitdaMargin) || 0;
  const centralMonthly = Number(p.centralCostMonthly) || 0;
  const taxPct = Number(p.taxRatePct) || 0;
  const minLiquidity = Number(p.minLiquidity) || 0;
  const rampCurve = (Array.isArray(p.rampCurve) && p.rampCurve.length) ? p.rampCurve : [1];
  const lastRamp = rampCurve[rampCurve.length - 1];
  const ramp = (age) => (age < rampCurve.length ? rampCurve[age] : lastRamp);
  const newPerMonth = Math.max(0, Number(p.newUnitsPerMonth) || 0);
  const targetUnits = Math.max(0, Number(p.targetUnitsPerMonth) || 0);
  const unitAllIn = Number(p.unitAllInCapex) || 0;
  const unitCostBase = Number(p.unitCostBase) || unitAllIn;
  const bankPct = Math.min(100, Math.max(0, Number(p.bankFinancingPct) || 0));
  const ratePct = Number(p.interestRatePct) || 0;
  const maturity = Math.max(1, Math.floor(p.maturityMonths || 84));
  const grace = Math.max(0, Math.floor(p.graceMonths || 0));
  const facilityLimit = (p.facilityLimit != null) ? Number(p.facilityLimit) : Infinity;
  const depMonths = Math.max(0, Math.floor(p.depreciationMonths || 0));
  const monthlyDepPerUnit = (depMonths > 0 && (Number(p.unitDepBase) || 0) > 0) ? (Number(p.unitDepBase) / depMonths) : 0;
  const monthlyRate = ratePct / 100 / 12;
  const debtPerUnit = unitAllIn * bankPct / 100;
  const equityPerUnit = unitAllIn - debtPerUnit;

  const cohorts = [];          // nové jednotky { start, count }
  const tranches = [];         // dluhové tranše { start, balance, pay }
  let drawn = 0, cashPool = 0, totalEquity = 0, reinvestCapex = 0, unitsTotal = startUnits, financedTotal = 0;
  const rows = [], cfadsArr = [], dsArr = [], crossArr = [];

  for (let m = 0; m < months; m++) {
    // Tržby: stávající stabilně + nové kohorty přes ramp.
    let rev = startUnits * perUnitRevenue;
    for (const c of cohorts) { const age = m - c.start; if (age >= 0) rev += c.count * perUnitRevenue * ramp(age); }
    const ebitda = rev * margin - centralMonthly;
    // Dluh (po tranších).
    let interest = 0, principal = 0, debtService = 0, outstanding = 0;
    for (const t of tranches) {
      const age = m - t.start;
      if (age >= 0 && age < maturity && t.balance > 1e-6) {
        const it = t.balance * monthlyRate;
        if (age < grace) { interest += it; debtService += it; }
        else { const pr = Math.min(t.balance, t.pay - it); t.balance -= pr; interest += it; principal += pr; debtService += it + pr; }
      }
      outstanding += Math.max(0, t.balance);
    }
    // Odpisy nových kohort.
    let depreciation = 0;
    for (const c of cohorts) { const age = m - c.start; if (age >= 0 && age < depMonths) depreciation += c.count * monthlyDepPerUnit; }
    const taxable = Math.max(0, ebitda - interest - depreciation);
    const tax = taxable * taxPct / 100;
    const fcf = ebitda - tax - debtService; // volné cash flow před růstem
    cashPool += fcf;

    let built = 0, equityThisMonth = 0;
    // 1) Financovaná výstavba tempem (dluh z rámce + externí equity).
    let paceLeft = newPerMonth;
    while (paceLeft > 0 && debtPerUnit > 0) {
      const room = isFinite(facilityLimit) ? (facilityLimit - drawn) : Infinity;
      if (room >= debtPerUnit) {
        tranches.push({ start: m, balance: debtPerUnit, pay: E.annuityPayment(debtPerUnit, monthlyRate, Math.max(1, maturity - grace)) });
        drawn += debtPerUnit; totalEquity += equityPerUnit; financedTotal++; equityThisMonth += equityPerUnit;
        cohorts.push({ start: m, count: 1 }); unitsTotal++; built++; paceLeft--;
      } else break;
    }
    // 2) Reinvestice: dokud nakumulovaný cash (nad rezervu) stačí na stroj, kup další (bez dluhu).
    let guard = 0;
    while ((cashPool - minLiquidity) >= unitAllIn && guard < 1000) {
      cashPool -= unitAllIn; reinvestCapex += unitAllIn;
      cohorts.push({ start: m, count: 1 }); unitsTotal++; built++; guard++;
    }

    const cfads = ebitda - tax;
    const dscr = debtService > 0 ? cfads / debtService : null;
    const crossCash = ebitda - Math.max(0, ebitda) * taxPct / 100 - minLiquidity; // bez splátek (jako splacené)
    cfadsArr.push(cfads); dsArr.push(debtService); crossArr.push(crossCash);
    rows.push({ month: m, closingUnits: unitsTotal, financedUnits: financedTotal, reinvestUnits: (unitsTotal - startUnits - financedTotal), newUnits: built, revenue: rev, ebitda, portfolioEbitda: ebitda, interest, principal, debtService, outstanding, tax, cfads, dscr, fcfBeforeGrowth: fcf, cashPool: Math.round(cashPool), equityCapex: equityThisMonth });
  }

  const dscrSum = E.dscrSeries(cfadsArr, dsArr);
  const crossover = E.selfFinancingCrossover(crossArr, unitCostBase, targetUnits);
  const crossRow = crossover.reached ? rows[crossover.month] : null;
  const peakDebt = rows.reduce((a, r) => Math.max(a, r.outstanding), 0);
  return {
    months, rows, mode: 'reinvest',
    summary: {
      startUnits, unitsEnd: rows.length ? rows[rows.length - 1].closingUnits : startUnits,
      newTotal: unitsTotal - startUnits, minDscr: dscrSum.min, avgDscr: dscrSum.avg,
      peakDebt: Math.round(peakDebt), drawnTotal: Math.round(drawn), totalEquity: Math.round(totalEquity), reinvestCapex: Math.round(reinvestCapex),
      crossover: crossover.reached ? { month: crossover.month, requiredMonthly: Math.round(crossover.requiredMonthly), units: crossRow.closingUnits, revenue: Math.round(crossRow.revenue), portfolioEbitda: Math.round(crossRow.portfolioEbitda), outstanding: Math.round(crossRow.outstanding), cashForExpansion: Math.round(crossArr[crossover.month]) } : { reached: false, requiredMonthly: Math.round(crossover.requiredMonthly) },
    },
  };
}

module.exports = { buildForecast, buildReinvestForecast, rampFromCohort };
