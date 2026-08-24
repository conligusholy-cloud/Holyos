// HolyOS — Bankovní Business Plan: finanční engine.
// Čisté, deterministické funkce bez DB/HTTP — plně jednotkově testovatelné (§63 zadání:
// přesnost > UI). Vstup → výstup. Všechny částky bezrozměrné (volající zajistí měnu).
//
// Obsah:
//   MĚNA/FX ......... sourceCurrencyForCode, toBase, convert
//   STATISTIKA ...... percentiles, seasonalityIndex, cohortCurve
//   UNIT ECONOMICS .. siteEconomics
//   DLUH ............ annuityPayment, buildDebtSchedule
//   BANKOVNÍ METRIKY. dscrSeries, debtMetrics
//   RŮST ............ growthUnits, applyRampToCohorts
//   CROSSOVER ....... selfFinancingCrossover
//   WATERFALL ....... cashWaterfall

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// MĚNA / FX
// ─────────────────────────────────────────────────────────────────────────────

// Zdrojová měna lokality dle kódu (SIS pole `currency` je nespolehlivé).
// PL → PLN, IE → EUR, CZ + legacy (alfanumerické) → CZK.
// overrides = { KÓD: 'CZK'|'EUR'|'PLN' } — ruční přepis pro mylně označené kódy.
// POZOR: 00021FR je fyzicky v ČR (Ústí nad Orlicí) → default override na CZK.
const DEFAULT_CURRENCY_OVERRIDES = { '00021FR': 'CZK' };
function sourceCurrencyForCode(code, overrides) {
  const c = String(code || '').trim().toUpperCase();
  const ov = Object.assign({}, DEFAULT_CURRENCY_OVERRIDES, overrides || {});
  if (ov[c]) return ov[c];
  // Zemi bereme JEN u číselných kódů (nové: 00003PL, 00001IE). Legacy kódy (2SPL, 2TAP,
  // 0YZN, 68HC…) končí písmeny náhodou → vždy CZK.
  const m = c.match(/^\d{3,}(PL|IE|FR|CZ)$/);
  if (m) {
    if (m[1] === 'PL') return 'PLN';
    if (m[1] === 'IE' || m[1] === 'FR') return 'EUR';
    return 'CZK';
  }
  return 'CZK'; // legacy + vše ostatní
}

// Převod částky z měny `from` do `base` přes tabulku kurzů vyjádřených jako
// "kolik jednotek base za 1 jednotku měny" NENÍ — používáme kurzy k CZK.
// fx = { CZK:1, EUR:25, PLN:5.8 } … tj. hodnota 1 jednotky měny v CZK.
function convert(amount, from, base, fx) {
  const a = Number(amount) || 0;
  const f = (fx && fx[from]) || (from === 'CZK' ? 1 : null);
  const b = (fx && fx[base]) || (base === 'CZK' ? 1 : null);
  if (!f || !b) return a; // chybí kurz → nepřeváděj (radši nezkresluj)
  const inCzk = a * f;
  return inCzk / b;
}

// Zkratka: převeď částku lokality (dle kódu) do base měny.
function toBase(amount, code, base, fx) {
  return convert(amount, sourceCurrencyForCode(code), base, fx);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTIKA
// ─────────────────────────────────────────────────────────────────────────────

// Percentil lineární interpolací (metoda jako Excel PERCENTILE.INC).
function percentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (!n) return null;
  if (n === 1) return sortedAsc[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

// Distribuce hodnot portfolia: P10/25/50/75/90 + avg/min/max/count.
function percentiles(values) {
  const arr = (values || []).map(Number).filter((x) => isFinite(x)).sort((a, b) => a - b);
  const n = arr.length;
  if (!n) return { count: 0, p10: null, p25: null, p50: null, p75: null, p90: null, avg: null, min: null, max: null };
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    count: n,
    p10: percentile(arr, 10), p25: percentile(arr, 25), p50: percentile(arr, 50),
    p75: percentile(arr, 75), p90: percentile(arr, 90),
    avg: sum / n, min: arr[0], max: arr[n - 1],
  };
}

// Sezónní index z měsíční řady { 'YYYY-MM': amount }. 100 = průměrný měsíc.
// Vrací pole 12 hodnot (index 0 = leden). Měsíce bez dat se do průměru nepočítají.
function seasonalityIndex(monthly) {
  const buckets = Array.from({ length: 12 }, () => []);
  Object.keys(monthly || {}).forEach((ym) => {
    const m = parseInt(String(ym).split('-')[1], 10);
    if (m >= 1 && m <= 12 && isFinite(monthly[ym])) buckets[m - 1].push(Number(monthly[ym]));
  });
  const monthAvg = buckets.map((b) => (b.length ? b.reduce((a, x) => a + x, 0) / b.length : null));
  const present = monthAvg.filter((x) => x != null);
  const overall = present.length ? present.reduce((a, x) => a + x, 0) / present.length : 0;
  return monthAvg.map((v) => (v == null || !overall ? null : Math.round((v / overall) * 1000) / 10));
}

// Kohortní křivka: pro sadu lokalit s datem otevření a měsíční řadou spočítej
// průměr/medián tržby podle "počtu měsíců od otevření" (month 0 = měsíc otevření).
// locations: [{ openDate: 'YYYY-MM-01'|Date, monthly: { 'YYYY-MM': amount } }]
function cohortCurve(locations, maxMonths) {
  const M = maxMonths || 36;
  const byM = Array.from({ length: M + 1 }, () => []);
  (locations || []).forEach((loc) => {
    const od = new Date(loc.openDate);
    if (isNaN(od)) return;
    const oy = od.getFullYear(), om = od.getMonth();
    Object.keys(loc.monthly || {}).forEach((ym) => {
      const parts = String(ym).split('-');
      const y = parseInt(parts[0], 10), mo = parseInt(parts[1], 10) - 1;
      if (!isFinite(y) || !isFinite(mo)) return;
      const idx = (y - oy) * 12 + (mo - om);
      if (idx >= 0 && idx <= M) byM[idx].push(Number(loc.monthly[ym]) || 0);
    });
  });
  return byM.map((vals, m) => {
    const s = percentiles(vals);
    return { month: m, count: s.count, avg: s.avg, median: s.p50 };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT ECONOMICS (ekonomika jedné lokality)
// ─────────────────────────────────────────────────────────────────────────────
// Revenue (bez DPH) − přímé OPEX = Site EBITDA; − maintenance reserve = Op. Cash Flow.
// Vše měsíční, v base měně. Procenta jako podíl z revenue.
function siteEconomics(input) {
  const revenue = Number(input.revenue) || 0;             // měsíční obrat bez DPH
  const rent = Number(input.rentMonthly) || 0;
  const servicePct = Number(input.servicePct) || 0;       // % z revenue
  const energyPct = Number(input.energyPct) || 0;         // % z revenue
  const water = Number(input.waterMonthly) || 0;
  const insurance = Number(input.insuranceMonthly) || 0;
  const paymentFeePct = Number(input.paymentFeePct) || 0; // % z revenue
  const consumables = Number(input.consumablesMonthly) || 0;
  const other = Number(input.otherMonthly) || 0;
  const maintenancePct = Number(input.maintenanceReservePct) || 0; // % z revenue

  const service = revenue * servicePct / 100;
  const energy = revenue * energyPct / 100;
  const paymentFee = revenue * paymentFeePct / 100;
  const directOpex = rent + service + energy + water + insurance + paymentFee + consumables + other;
  const siteEbitda = revenue - directOpex;
  const maintenanceReserve = revenue * maintenancePct / 100;
  const operatingCashFlow = siteEbitda - maintenanceReserve;
  const ebitdaMargin = revenue ? siteEbitda / revenue : 0;
  return {
    revenue, directOpex, service, energy, paymentFee,
    siteEbitda, ebitdaMargin, maintenanceReserve, operatingCashFlow,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DLUH
// ─────────────────────────────────────────────────────────────────────────────

// Anuitní splátka (jistina+úrok) pro danou jistinu, měsíční sazbu a počet splátek.
function annuityPayment(principal, monthlyRate, nper) {
  const P = Number(principal) || 0;
  const r = Number(monthlyRate) || 0;
  const n = Number(nper) || 0;
  if (n <= 0) return 0;
  if (r === 0) return P / n;
  return P * r / (1 - Math.pow(1 + r, -n));
}

// Splátkový kalendář portfolia z jednotlivých čerpání (tranší).
// drawdowns: [{ month: <index 0..H>, principal, annualRatePct, maturityMonths, graceMonths }]
// months: horizont (počet měsíců). Vrací:
//   perMonth[i] = { interest, principal, payment, closingPrincipal }
//   totals = { drawnTotal }
// Grace = jen úrok (bez splátky jistiny) po graceMonths od čerpání; poté anuita na zbytek.
function buildDebtSchedule(drawdowns, months) {
  const H = Number(months) || 0;
  const perMonth = Array.from({ length: H }, () => ({ interest: 0, principal: 0, payment: 0, closingPrincipal: 0 }));
  let drawnTotal = 0;

  (drawdowns || []).forEach((d) => {
    const start = Math.max(0, Math.floor(Number(d.month) || 0));
    const P = Number(d.principal) || 0;
    if (P <= 0 || start >= H) return;
    drawnTotal += P;
    const r = (Number(d.annualRatePct) || 0) / 100 / 12;
    const maturity = Math.max(1, Math.floor(Number(d.maturityMonths) || 84));
    const grace = Math.max(0, Math.floor(Number(d.graceMonths) || 0));
    const amortN = Math.max(1, maturity - grace);
    const pay = annuityPayment(P, r, amortN);
    let bal = P;
    for (let k = 0; k < maturity && (start + k) < H; k++) {
      const i = start + k;
      const interest = bal * r;
      let principalPaid = 0;
      if (k < grace) {
        // grace: platí se jen úrok
        perMonth[i].interest += interest;
        perMonth[i].payment += interest;
      } else {
        principalPaid = Math.min(bal, pay - interest);
        if (principalPaid < 0) principalPaid = 0;
        bal -= principalPaid;
        perMonth[i].interest += interest;
        perMonth[i].principal += principalPaid;
        perMonth[i].payment += interest + principalPaid;
      }
    }
  });

  // Doplň zůstatek jistiny (closingPrincipal) kumulativně napříč všemi tranšemi.
  // Spočítáme z drawn − splacené jistiny do daného měsíce.
  let cumDrawn = 0, cumPrincipalPaid = 0;
  const drawByMonth = {};
  (drawdowns || []).forEach((d) => { const m = Math.max(0, Math.floor(Number(d.month) || 0)); drawByMonth[m] = (drawByMonth[m] || 0) + (Number(d.principal) || 0); });
  for (let i = 0; i < H; i++) {
    cumDrawn += drawByMonth[i] || 0;
    cumPrincipalPaid += perMonth[i].principal;
    perMonth[i].closingPrincipal = Math.max(0, cumDrawn - cumPrincipalPaid);
  }
  return { perMonth, totals: { drawnTotal } };
}

// ─────────────────────────────────────────────────────────────────────────────
// BANKOVNÍ METRIKY
// ─────────────────────────────────────────────────────────────────────────────

// DSCR = Cash Flow Available for Debt Service / Debt Service (po měsících).
function dscrSeries(cfads, debtService) {
  const H = Math.max(cfads.length, debtService.length);
  const perMonth = [];
  let min = null, sumCfads = 0, sumDs = 0;
  for (let i = 0; i < H; i++) {
    const cf = Number(cfads[i]) || 0;
    const ds = Number(debtService[i]) || 0;
    sumCfads += cf; sumDs += ds;
    const dscr = ds > 0 ? cf / ds : null;
    if (dscr != null && (min == null || dscr < min)) min = dscr;
    perMonth.push({ month: i, cfads: cf, debtService: ds, dscr });
  }
  return { perMonth, min, avg: sumDs > 0 ? sumCfads / sumDs : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// RŮST PORTFOLIA
// ─────────────────────────────────────────────────────────────────────────────
// Model počtu jednotek měsíc po měsíci. new/closed jsou pole nebo konstanta.
function growthUnits(opening, months, newPerMonth, closedPerMonth) {
  const H = Number(months) || 0;
  const out = [];
  let units = Number(opening) || 0;
  for (let i = 0; i < H; i++) {
    const added = Array.isArray(newPerMonth) ? (Number(newPerMonth[i]) || 0) : (Number(newPerMonth) || 0);
    const closed = Array.isArray(closedPerMonth) ? (Number(closedPerMonth[i]) || 0) : (Number(closedPerMonth) || 0);
    const openU = units;
    units = Math.max(0, units + added - closed);
    out.push({ month: i, opening: openU, added, closed, closing: units });
  }
  return out;
}

// Aplikuj ramp-up profil na kohorty: rampCurve[k] = podíl (0..1) plné tržby v k-tém
// měsíci provozu. Vrací měsíční portfolio revenue z náběhu nových kohort.
// newCohorts[i] = počet nových jednotek spuštěných v měsíci i; fullRevenue = stabilizovaná měsíční tržba/jednotka.
function applyRampToCohorts(newCohorts, rampCurve, fullRevenue, months) {
  const H = Number(months) || 0;
  const rev = new Array(H).fill(0);
  const lastRamp = rampCurve.length ? rampCurve[rampCurve.length - 1] : 1;
  for (let start = 0; start < H; start++) {
    const cnt = Number(newCohorts[start]) || 0;
    if (!cnt) continue;
    for (let i = start; i < H; i++) {
      const age = i - start;
      const factor = age < rampCurve.length ? rampCurve[age] : lastRamp;
      rev[i] += cnt * fullRevenue * factor;
    }
  }
  return rev;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-FINANCING CROSSOVER
// ─────────────────────────────────────────────────────────────────────────────
// První měsíc, kdy disponibilní cash flow (na expanzi) ≥ požadovaná reinvestice
// (targetUnitsPerMonth × unitCost). Vrací {month, reached, requiredMonthly}.
function selfFinancingCrossover(cashAvailableForExpansion, unitCost, targetUnitsPerMonth) {
  const required = (Number(unitCost) || 0) * (Number(targetUnitsPerMonth) || 0);
  for (let i = 0; i < cashAvailableForExpansion.length; i++) {
    if ((Number(cashAvailableForExpansion[i]) || 0) >= required) {
      return { reached: true, month: i, requiredMonthly: required, value: cashAvailableForExpansion[i] };
    }
  }
  return { reached: false, month: null, requiredMonthly: required, value: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CASH WATERFALL (jeden měsíc) — §31 zadání
// ─────────────────────────────────────────────────────────────────────────────
function cashWaterfall(m) {
  const revenue = Number(m.revenue) || 0;
  const directOpex = Number(m.directOpex) || 0;
  const ebitda = revenue - directOpex;
  const centralOpex = Number(m.centralOpex) || 0;
  const portfolioEbitda = ebitda - centralOpex;
  const taxes = Number(m.taxes) || 0;
  const maintenance = Number(m.maintenanceReserve) || 0;
  const debtService = Number(m.debtService) || 0;
  const fcfBeforeGrowth = portfolioEbitda - taxes - maintenance - debtService;
  const minLiquidity = Number(m.minLiquidityReserve) || 0;
  const cashForExpansion = fcfBeforeGrowth - minLiquidity;
  const equityCapex = Number(m.equityCapexNewUnits) || 0;
  const closingCash = cashForExpansion - equityCapex;
  return { revenue, directOpex, ebitda, centralOpex, portfolioEbitda, taxes, maintenance, debtService, fcfBeforeGrowth, minLiquidity, cashForExpansion, equityCapex, closingCash };
}

// ─────────────────────────────────────────────────────────────────────────────
// DERIVACE PROVOZNÍCH % Z EKONOMIKY JEDNOHO PRÁDLOMATU (V3)
// ─────────────────────────────────────────────────────────────────────────────
// Zrcadlí konstanty z modules/prodejni-objednavky/pradlomat-economy.js (varianta V3).
// Energie = voda + stočné + elektřina napříč cykly (praní + sušení).
// Servis (pro bankovní model) = fixní provoz bez nájmu (údržba, SW, internet, infolinka,
//   pojištění, servis) + spotřeba detergentů. Nájem a platební poplatky se řeší zvlášť.
// Vrací % z obratu BEZ DPH.
const UNIT_V3 = {
  cena_elektriny: 0.198, cena_vodne: 2.629, cena_stocne: 2.526,
  cena_prasku: 2.348, cena_avivaze: 1.662,
  voda_velka: 160, el_velka: 1.05, prasek_velka: 0.09, aviv_velka: 0.03,
  voda_mala: 60, el_mala: 0.53, prasek_mala: 0.04, aviv_mala: 0.02,
  susicka_15: 1.8, dph: 0.21, obrat_na_zakaznika: 11.33, zakazniku_za_den: 8,
  udrzba: 83, software: 62, internet: 12, infolinka: 21, pojisteni: 12, servis: 62,
};
function deriveUnitModelPct(cfg) {
  const d = Object.assign({}, UNIT_V3, cfg || {});
  const vodne = d.cena_vodne + d.cena_stocne;
  const vv = { voda: (d.voda_velka / 1000) * vodne, el: d.el_velka * d.cena_elektriny, pr: d.prasek_velka * d.cena_prasku, av: d.aviv_velka * d.cena_avivaze };
  const vm = { voda: (d.voda_mala / 1000) * vodne, el: d.el_mala * d.cena_elektriny, pr: d.prasek_mala * d.cena_prasku, av: d.aviv_mala * d.cena_avivaze };
  const washEng = ((vv.voda + vv.el) + (vm.voda + vm.el)) / 2;
  const washDet = ((vv.pr + vv.av / 2) + (vm.pr + vm.av / 2)) / 2;
  const dryEng = ((d.susicka_15 * 2 * d.cena_elektriny) + (d.susicka_15 * d.cena_elektriny)) / 2;
  const energyPerCust = washEng + dryEng;
  const detPerCust = washDet;
  const zm = d.zakazniku_za_den * 30.5;
  const obratNet = (zm * d.obrat_na_zakaznika) / (1 + d.dph);
  const energyM = zm * energyPerCust;
  const detM = zm * detPerCust;
  const fixedM = d.udrzba + d.software + d.internet + d.infolinka + d.pojisteni + d.servis;
  const servisM = fixedM + detM;
  return {
    energyPct: Math.round(energyM / obratNet * 1000) / 10,
    servicePct: Math.round(servisM / obratNet * 1000) / 10,
    detergentPct: Math.round(detM / obratNet * 1000) / 10,
    obratNetEur: Math.round(obratNet),
  };
}

module.exports = {
  sourceCurrencyForCode, convert, toBase, deriveUnitModelPct,
  percentile, percentiles, seasonalityIndex, cohortCurve,
  siteEconomics,
  annuityPayment, buildDebtSchedule,
  dscrSeries,
  growthUnits, applyRampToCohorts,
  selfFinancingCrossover, cashWaterfall,
};
