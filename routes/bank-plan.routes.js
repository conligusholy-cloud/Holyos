// HolyOS — Bankovní Business Plan: API.
// Čte snapshot historie (AppSetting bank_plan.sis_history, plní ho scripts/build-bank-plan-history.js)
// a přes finanční engine počítá track record, distribuci, sezónnost a kohorty.
// Vše auditovatelné — čísla jdou zpět ke snapshotu a předpokladům.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../services/settings');
const E = require('../services/bank-plan/engine');
const SIS = require('../services/bank-plan/sis-history');

const HISTORY_KEY = 'bank_plan.sis_history';
const ASSUMPTIONS_KEY = 'bank_plan.assumptions';

// ─── Přebudování snapshotu na pozadí (server má SIS klíč i přístup k DB) ─────
let _buildState = { building: false, startedAt: null, finishedAt: null, error: null, summary: null };

async function _fetchKioskList() {
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  const url = (process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values').replace(/\/$/, '');
  const r = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('kiosk-values HTTP ' + r.status);
  const j = await r.json();
  return { kiosks: Array.isArray(j.kiosks) ? j.kiosks.map((k) => ({ code: k.code, label: k.label || k.code })) : [], header: { generatedAt: j.generatedAt, period: j.period, valueCurrency: j.valueCurrency } };
}

async function _runBuild(base) {
  _buildState = { building: true, startedAt: new Date().toISOString(), finishedAt: null, error: null, summary: null };
  try {
    if (!process.env.SIS_KIOSK_API_KEY) throw new Error('Chybí SIS_KIOSK_API_KEY na serveru.');
    const { kiosks, header } = await _fetchKioskList();
    const fetchTx = SIS.makeSisFetchTx(process.env);
    const hist = await SIS.buildHistory({ kiosks, fetchTx, base: base || 'CZK', fx: SIS.DEFAULT_FX, limit: 500 });
    hist.sisHeader = header;
    await setSetting(HISTORY_KEY, hist, { type: 'json', description: 'Snapshot historie ze SIS pro Bankovní Business Plan' });
    _buildState.summary = { realCount: hist.portfolio.realCount, activeCount: hist.portfolio.activeCount, closedCount: hist.portfolio.closedCount, testCount: hist.portfolio.testCount, locationMonths: hist.portfolio.locationMonths, globalFirst: hist.globalFirst, globalLast: hist.globalLast };
  } catch (e) {
    _buildState.error = String(e.message || e);
  } finally {
    _buildState.building = false;
    _buildState.finishedAt = new Date().toISOString();
  }
}

// POST /api/bank-plan/history/rebuild — spustí přebudování snapshotu na pozadí.
router.post('/history/rebuild', requireAuth, async (req, res, next) => {
  try {
    if (_buildState.building) return res.status(409).json({ error: 'Přebudování už běží.', state: _buildState });
    const base = (req.query.base || req.body && req.body.base || 'CZK').toUpperCase();
    _runBuild(base); // fire-and-forget (běží na pozadí, netrap request)
    res.json({ started: true, base });
  } catch (err) { next(err); }
});

// GET /api/bank-plan/history/status — stav přebudování + zda snapshot existuje.
router.get('/history/status', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    res.json({ state: _buildState, hasSnapshot: !!hist, generatedAt: hist && hist.generatedAt || null });
  } catch (err) { next(err); }
});

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
  excludedCodes: [],     // ručně vyřazené lokality (nesmysly/testy) — nepočítají se do plánu
  // SIS částky jsou S DPH (hrubé, co zákazník platí). Model počítá BEZ DPH → dělíme (1+sazba/100).
  // Sazba dle země/měny lokality: CZ 21 %, PL 23 %, IE/EUR 23 %.
  vatByCurrency: { CZK: 21, EUR: 23, PLN: 23 },
};

function monthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); }

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
    // Verze prádlomatu (V2/V3/V4) + nájem per lokalita z nastavení Compoundingu.
    const cfgMap = (await getSetting('compounding.kiosks', { type: 'json', defaultValue: {} })) || {};

    const excluded = new Set((A.excludedCodes || []).map((c) => String(c).trim().toUpperCase()));
    const nonTest = (hist.locations || []).filter((l) => l.classification !== 'test');
    const isExcluded = (l) => excluded.has(String(l.code).trim().toUpperCase());

    // DPH: SIS částky jsou S DPH → převedeme na BEZ DPH dle sazby země (měny) lokality.
    const vatMap = A.vatByCurrency || DEFAULT_ASSUMPTIONS.vatByCurrency;
    const netMonthly = (l) => {
      const gross = convertMonthly(l.monthly || {}, storedBase, base, fx);
      const cur = E.sourceCurrencyForCode(l.code);
      const div = 1 + ((vatMap[cur] != null ? vatMap[cur] : 21) / 100);
      const out = {}; Object.keys(gross).forEach((ym) => { out[ym] = gross[ym] / div; });
      return out;
    };

    const now = new Date();

    // Track record + portfolio: počítáme JEN z ne-vyřazených reálných lokalit (aktivní + uzavřené).
    const portfolioMonthly = {};
    let firstMs = null, lastMs = null, locationMonths = 0, totalTx = 0, realCount = 0, activeCount = 0, closedCount = 0;
    nonTest.forEach((l) => {
      if (isExcluded(l)) return;
      realCount++;
      if (l.classification === 'active') activeCount++; else if (l.classification === 'closed') closedCount++;
      totalTx += l.txCount || 0;
      const m = netMonthly(l); // tržby BEZ DPH
      Object.keys(m).forEach((ym) => { portfolioMonthly[ym] = (portfolioMonthly[ym] || 0) + m[ym]; });
      const od = l.openDate ? new Date(l.openDate) : null;
      const ld = l.lastTx ? new Date(l.lastTx) : null;
      if (od && !isNaN(od)) {
        if (firstMs == null || od < firstMs) firstMs = od;
        const end = (l.classification === 'closed' && ld && !isNaN(ld)) ? ld : now;
        locationMonths += Math.max(1, monthsBetween(od, end) + 1);
      }
      if (ld && !isNaN(ld) && (lastMs == null || ld > lastMs)) lastMs = ld;
    });
    const years = firstMs ? Math.round(((now - firstMs) / (365 * 86400000)) * 10) / 10 : null;
    const cumulativeRevenue = Object.keys(portfolioMonthly).reduce((a, ym) => a + portfolioMonthly[ym], 0);

    // Per-lokalita pro tabulku = všechny reálné (aktivní i uzavřené), s příznakem excluded.
    const perLoc = nonTest.map((l) => {
      const m = netMonthly(l); // BEZ DPH
      const avgRev = avgRecentMonthly(m, 12) || 0;
      const cfg = cfgMap[l.code] || {};
      const version = cfg.version ? String(cfg.version).toUpperCase() : null;
      const rent = (typeof cfg.rentMonthlyCzk === 'number') ? E.convert(cfg.rentMonthlyCzk, 'CZK', base, fx) : A.rentMonthlyDefault;
      const se = E.siteEconomics({ revenue: avgRev, rentMonthly: rent, servicePct: A.servicePct, energyPct: A.energyPct, paymentFeePct: A.paymentFeePct, maintenanceReservePct: A.maintenanceReservePct });
      return { code: l.code, label: l.label, version, avgRev, ebitda: se.siteEbitda, margin: se.ebitdaMargin, opCashFlow: se.operatingCashFlow, openDate: l.openDate, classification: l.classification, excluded: isExcluded(l) };
    });

    // Distribuce/kohorty jen z ZAHRNUTÝCH aktivních lokalit.
    const distSrc = perLoc.filter((x) => !x.excluded && x.classification === 'active');
    const revDist = E.percentiles(distSrc.map((x) => x.avgRev));
    const ebitdaDist = E.percentiles(distSrc.map((x) => x.ebitda));
    const marginDist = E.percentiles(distSrc.map((x) => x.margin));

    // Průměrný známý nájem (z Compoundingu) přes zahrnuté lokality — jako nápověda pro default.
    let rentSum = 0, rentN = 0;
    nonTest.forEach((l) => {
      if (isExcluded(l)) return;
      const cfg = cfgMap[l.code] || {};
      if (typeof cfg.rentMonthlyCzk === 'number' && isFinite(cfg.rentMonthlyCzk) && cfg.rentMonthlyCzk > 0) { rentSum += cfg.rentMonthlyCzk; rentN++; }
    });
    const rentStats = { avgKnownRentCzk: rentN ? Math.round(rentSum / rentN) : null, count: rentN, totalPlan: realCount };

    const seasonality = E.seasonalityIndex(portfolioMonthly);

    const cohort = E.cohortCurve(nonTest.filter((l) => !isExcluded(l) && l.classification === 'active' && l.openDate).map((l) => ({ openDate: l.openDate, monthly: netMonthly(l) })), 36);

    // Base Case EBITDA = medián − banking haircut (§49/§50)
    const medianEbitda = ebitdaDist.p50 || 0;
    const baseCaseEbitda = medianEbitda * (1 - (A.bankingHaircutPct || 0) / 100);

    res.json({
      base, generatedAt: hist.generatedAt, sisHeader: hist.sisHeader || null,
      trackRecord: {
        yearsData: years,
        realCount, activeCount, closedCount,
        excludedCount: excluded.size,
        locationMonths, totalTx,
        firstData: firstMs ? firstMs.toISOString().slice(0, 10) : hist.globalFirst,
        lastData: lastMs ? lastMs.toISOString().slice(0, 10) : hist.globalLast,
        cumulativeRevenue: Math.round(cumulativeRevenue),
      },
      unitEconomics: {
        revenueDist: revDist, ebitdaDist, marginDist,
        medianEbitda: Math.round(medianEbitda), baseCaseEbitda: Math.round(baseCaseEbitda), bankingHaircutPct: A.bankingHaircutPct,
      },
      seasonality,
      cohort,
      portfolioMonthly,
      rentStats,
      assumptions: A,
      locations: perLoc,
    });
  } catch (err) { next(err); }
});

// POST /api/bank-plan/exclude { code, excluded } — ručně vyřaď/vrať lokalitu do plánu.
router.post('/exclude', requireAuth, async (req, res, next) => {
  try {
    const code = String((req.body && req.body.code) || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality.' });
    const excluded = req.body && req.body.excluded !== false; // default true
    const A = await loadAssumptions();
    const set = new Set((A.excludedCodes || []).map((c) => String(c).trim().toUpperCase()));
    if (excluded) set.add(code); else set.delete(code);
    const next_ = Object.assign({}, A, { excludedCodes: Array.from(set) });
    await setSetting(ASSUMPTIONS_KEY, next_, { type: 'json', userId: req.user && req.user.id });
    res.json({ ok: true, excludedCodes: next_.excludedCodes });
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
