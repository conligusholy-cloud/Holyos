// HolyOS — Bankovní Business Plan: API.
// Čte snapshot historie (AppSetting bank_plan.sis_history, plní ho scripts/build-bank-plan-history.js)
// a přes finanční engine počítá track record, distribuci, sezónnost a kohorty.
// Vše auditovatelné — čísla jdou zpět ke snapshotu a předpokladům.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../services/settings');
const E = require('../services/bank-plan/engine');

const HISTORY_KEY = 'bank_plan.sis_history';
const ASSUMPTIONS_KEY = 'bank_plan.assumptions';

// Výchozí předpoklady (ASSUMPTION) — editovatelné přes /assumptions.
const DEFAULT_ASSUMPTIONS = {
  fx: { CZK: 1, EUR: 25, PLN: 5.8 },
  servicePct: 15,        // % z obratu
  energyPct: 9.5,
  paymentFeePct: 1.5,
  rentMonthlyDefault: 8000, // base měna (CZK) — když lokalita nemá vlastní nájem
  maintenanceReservePct: 3,
  bankingHaircutPct: 15, // srážka Base Case proti historickému mediánu
  unitCostEur: 52000,    // cena prádlomatu
  targetUnitsPerMonth: 4,
};

async function loadAssumptions() {
  const a = await getSetting(ASSUMPTIONS_KEY, { type: 'json', defaultValue: null });
  return Object.assign({}, DEFAULT_ASSUMPTIONS, a || {});
}

// Průměr z posledních N kompletních měsíců (poslední = často částečný → vynech).
function avgRecentMonthly(monthly, n) {
  const yms = Object.keys(monthly || {}).sort();
  if (!yms.length) return null;
  const complete = yms.slice(0, -1); // vynech poslední (částečný) měsíc
  const use = complete.slice(-(n || 12));
  if (!use.length) return null;
  return use.reduce((a, ym) => a + (Number(monthly[ym]) || 0), 0) / use.length;
}

// Převod celé měsíční řady mezi měnami (stored base → požadovaná base) přes fx k CZK.
function convertMonthly(monthly, fromBase, toBase, fx) {
  if (fromBase === toBase) return Object.assign({}, monthly);
  const out = {};
  Object.keys(monthly || {}).forEach((ym) => { out[ym] = E.convert(monthly[ym], fromBase, toBase, fx); });
  return out;
}

// GET /api/bank-plan/history — surový snapshot (pro debug / audit).
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    if (!hist) return res.status(404).json({ error: 'Snapshot historie zatím není. Spusť scripts/build-bank-plan-history.js.' });
    res.json(hist);
  } catch (err) { next(err); }
});

// GET /api/bank-plan/overview?base=CZK|EUR — track record, distribuce, sezónnost, kohorty.
router.get('/overview', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    if (!hist) return res.status(404).json({ error: 'Snapshot historie zatím není. Spusť scripts/build-bank-plan-history.js.' });
    const A = await loadAssumptions();
    const fx = A.fx || DEFAULT_ASSUMPTIONS.fx;
    const base = (req.query.base || hist.base || 'CZK').toUpperCase();
    const storedBase = hist.base || 'CZK';

    const locations = (hist.locations || []).filter((l) => l.classification !== 'test');
    const active = locations.filter((l) => l.classification === 'active');

    // Track record
    const now = new Date();
    const first = hist.globalFirst ? new Date(hist.globalFirst) : null;
    const years = first ? Math.round(((now - first) / (365 * 86400000)) * 10) / 10 : null;
    const portfolioMonthly = convertMonthly(hist.portfolio.monthly || {}, storedBase, base, fx);
    const cumulativeRevenue = Object.keys(portfolioMonthly).reduce((a, ym) => a + portfolioMonthly[ym], 0);

    // Per-lokalita: průměrná měsíční tržba (posl. 12 kompletních měsíců) v base
    const perLoc = active.map((l) => {
      const m = convertMonthly(l.monthly || {}, storedBase, base, fx);
      const avgRev = avgRecentMonthly(m, 12) || 0;
      const rent = (typeof l.rentMonthly === 'number') ? E.convert(l.rentMonthly, storedBase, base, fx) : A.rentMonthlyDefault;
      const se = E.siteEconomics({ revenue: avgRev, rentMonthly: rent, servicePct: A.servicePct, energyPct: A.energyPct, paymentFeePct: A.paymentFeePct, maintenanceReservePct: A.maintenanceReservePct });
      return { code: l.code, label: l.label, avgRev, ebitda: se.siteEbitda, margin: se.ebitdaMargin, opCashFlow: se.operatingCashFlow, openDate: l.openDate };
    });

    const revDist = E.percentiles(perLoc.map((x) => x.avgRev));
    const ebitdaDist = E.percentiles(perLoc.map((x) => x.ebitda));
    const marginDist = E.percentiles(perLoc.map((x) => x.margin));

    // Sezónnost z portfolia
    const seasonality = E.seasonalityIndex(portfolioMonthly);

    // Kohortní křivka (tržby dle měsíců od otevření) — jen aktivní s datem otevření
    const cohort = E.cohortCurve(active.filter((l) => l.openDate).map((l) => ({ openDate: l.openDate, monthly: convertMonthly(l.monthly || {}, storedBase, base, fx) })), 36);

    // Base Case EBITDA = medián − banking haircut (§49/§50)
    const medianEbitda = ebitdaDist.p50 || 0;
    const baseCaseEbitda = medianEbitda * (1 - (A.bankingHaircutPct || 0) / 100);

    res.json({
      base, generatedAt: hist.generatedAt, sisHeader: hist.sisHeader || null,
      trackRecord: {
        yearsData: years,
        realCount: hist.portfolio.realCount, activeCount: hist.portfolio.activeCount, closedCount: hist.portfolio.closedCount,
        locationMonths: hist.portfolio.locationMonths, totalTx: hist.portfolio.totalTx,
        firstData: hist.globalFirst, lastData: hist.globalLast,
        cumulativeRevenue: Math.round(cumulativeRevenue),
      },
      unitEconomics: {
        revenueDist: revDist, ebitdaDist, marginDist,
        medianEbitda: Math.round(medianEbitda), baseCaseEbitda: Math.round(baseCaseEbitda), bankingHaircutPct: A.bankingHaircutPct,
      },
      seasonality,
      cohort,
      portfolioMonthly,
      assumptions: A,
      locations: perLoc,
    });
  } catch (err) { next(err); }
});

// GET/PUT /api/bank-plan/assumptions — čtení a editace předpokladů (ASSUMPTION).
router.get('/assumptions', requireAuth, async (req, res, next) => {
  try { res.json(await loadAssumptions()); } catch (err) { next(err); }
});
router.put('/assumptions', requireAuth, async (req, res, next) => {
  try {
    const cur = await loadAssumptions();
    const next_ = Object.assign({}, cur, req.body || {});
    await setSetting(ASSUMPTIONS_KEY, next_, { type: 'json', userId: req.user && req.user.id });
    res.json({ ok: true, assumptions: next_ });
  } catch (err) { next(err); }
});

module.exports = router;
