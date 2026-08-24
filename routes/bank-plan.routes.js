// HolyOS — Bankovní Business Plan: API.
// Čte snapshot historie (AppSetting bank_plan.sis_history, plní ho scripts/build-bank-plan-history.js)
// a přes finanční engine počítá track record, distribuci, sezónnost a kohorty.
// Vše auditovatelné — čísla jdou zpět ke snapshotu a předpokladům.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../services/settings');
const { prisma } = require('../config/database');
const E = require('../services/bank-plan/engine');
const SIS = require('../services/bank-plan/sis-history');

// Derivace servis/energie % z ŽIVÉ ekonomiky jednoho prádlomatu (businessToolDefaults).
// Když upravíš hodnoty v pomůcce „Ekonomika prádlomatu" a uložíš, tady se přepočítají.
async function _unitModelPct() {
  let cfg = {};
  try {
    const row = await prisma.businessToolDefaults.findUnique({ where: { tool: 'pradlomat-economy' }, select: { data_json: true } });
    if (row && row.data_json && typeof row.data_json === 'object') cfg = row.data_json;
  } catch (e) { /* fallback na konstanty V3 */ }
  return E.deriveUnitModelPct(cfg);
}

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
  // Odvozeno z ekonomiky jednoho prádlomatu (V3): servis (fixní bez nájmu + detergenty) ~12,9 %,
  // energie (voda+stočné+elektřina) ~13,4 % z obratu bez DPH.
  servicePct: 12.9,      // % z obratu
  energyPct: 13.4,
  paymentFeePct: 1.5,
  rentMonthlyDefault: 8000, // base měna (CZK) — když lokalita nemá vlastní nájem
  maintenanceReservePct: 0, // údržba je už zahrnutá v servisu → default 0 (žádné dvojí počítání)
  bankingHaircutPct: 15, // srážka Base Case proti historickému mediánu
  unitCostEur: 52000,    // cena prádlomatu
  targetUnitsPerMonth: 4,
  excludedCodes: [],     // ručně vyřazené lokality (nesmysly/testy) — nepočítají se do plánu
  // SIS částky jsou S DPH (hrubé, co zákazník platí). Model počítá BEZ DPH → dělíme (1+sazba/100).
  // Sazba dle země/měny lokality: CZ 21 %, PL 23 %, IE/EUR 23 %.
  vatByCurrency: { CZK: 21, EUR: 23, PLN: 23 },
  // Jsou nájmy (v Compoundingu i default) zadané S DPH? Když ano, model je převede na bez DPH.
  rentVatIncluded: false,
  // Ruční přepis měny lokality (mylné kódy). Např. 00021FR je fyzicky v ČR → CZK (řeší i engine default).
  currencyByCode: {},
  // Analýza rizik (§19 zadání) — editovatelné; probability/impact: nízká|střední|vysoká.
  risks: [
    { label: 'Riziko lokality', probability: 'střední', impact: 'střední', mitigation: 'Diverzifikace přes 80+ provozoven; výběr míst dle historických dat o výkonu; možnost přesunu stroje.' },
    { label: 'Riziko poptávky', probability: 'nízká', impact: 'střední', mitigation: 'Samoobslužné praní má stabilní, neelastickou poptávku; 5 let historie napříč lokalitami a sezónami.' },
    { label: 'Technologické riziko', probability: 'nízká', impact: 'střední', mitigation: 'Standardizovaná osvědčená technologie, záruka a garance odkupu; monitoring přes SIS.' },
    { label: 'Servisní riziko', probability: 'nízká', impact: 'nízká', mitigation: 'Vlastní servisní síť, vzdálený monitoring, rezerva na údržbu v modelu.' },
    { label: 'Energetické riziko', probability: 'střední', impact: 'střední', mitigation: 'Ceny energií promítnuty do modelu; možnost úpravy cen služeb; stress test na inflaci energií.' },
    { label: 'Úrokové riziko', probability: 'střední', impact: 'střední', mitigation: 'Stress scénář s vyšší sazbou; DSCR drží rezervu; možnost fixace.' },
    { label: 'Kurzové riziko (EUR/CZK)', probability: 'střední', impact: 'nízká', mitigation: 'Technologie v EUR, tržby v CZK/EUR/PLN; stress na kurz; možnost zajištění.' },
    { label: 'Riziko likvidity', probability: 'nízká', impact: 'vysoká', mitigation: 'Minimální hotovostní rezerva v modelu; postupné čerpání jen při pořízení jednotky.' },
    { label: 'Riziko expanze', probability: 'střední', impact: 'střední', mitigation: 'Růst vázán na dostupný rámec; každé čerpání = konkrétní produktivní aktivum, ne růst naslepo.' },
    { label: 'Riziko protistran', probability: 'nízká', impact: 'nízká', mitigation: 'Vysoký počet drobných koncových zákazníků (žádná koncentrace); platby předem u stroje.' },
  ],
  // Financování a růst (Fáze 5). Částky v CZK, převedou se do base měny.
  financing: {
    horizonMonths: 120,
    newUnitsPerMonth: 2,
    bankFinancingPct: 70,
    interestRatePct: 6.5,
    maturityMonths: 84,
    graceMonths: 6,
    facilityLimitCzk: 20000000,
    allInExtraEur: 8000,      // instalace/doprava/přípojky navíc k ceně stroje
    taxRatePct: 19,
    centralCostMonthlyCzk: 0, // centrální náklady portfolia/měs
    minLiquidityCzk: 500000,  // minimální hotovostní rezerva
    startUnitsOverride: null,  // null = skutečná aktivní síť; 0 = greenfield (partner staví od nuly)
    depreciationYears: 5,      // doba odpisu prádlomatu (daňový štít)
  },
  // Scénáře — ODVOZENÉ Z HISTORICKÉ DISTRIBUCE per-lokalitního výkonu (ne arbitrární haircut).
  // Base = P50 (medián), Downside = P25, Historical Stress = P10. Combined = P10 + zhoršené
  // náklady/úrok/ramp. Revenue factor se počítá dynamicky (Pxx / P50) z aktuálních dat.
  scenarios: {
    base:     { label: 'Base', basis: 'p50', dscrTarget: 1.30 },
    downside: { label: 'Downside', revenueFactor: 0.90, dscrTarget: 1.20 },
    stress:   { label: 'Stress', revenueFactor: 0.80, dscrTarget: 1.00 },
    combined: { label: 'Combined Bank Stress', revenueFactor: 0.80, dscrTarget: 1.00,
                energyUpliftPct: 20, serviceUpliftPct: 10, interestAddPct: 2.0, rampExtraMonths: 3, fxStressPct: 0 },
  },
  // Stabilizovaný výkon lokality pro percentily (§17/§18): vyloučit ramp-up, min. historie.
  stabilization: {
    enabled: true,          // false = zpět na prostý 12M průměr
    minHistoryMonths: 6,    // min. počet kvalifikovaných měsíců, jinak lokalita mimo percentily
    includeRampUp: false,   // false = vyloučit ramp-up měsíce (dle kohorty)
    stabilizeFromMonth: null, // null = auto z kohortní křivky (95 % plateau)
    includeClosed: false,   // zahrnout uzavřené lokality do percentilů
  },
};

const F = require('../services/bank-plan/forecast');

function monthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); }

async function loadAssumptions() {
  const a = await getSetting(ASSUMPTIONS_KEY, { type: 'json', defaultValue: null });
  const merged = Object.assign({}, DEFAULT_ASSUMPTIONS, a || {});
  merged.maintenanceReservePct = 0; // údržba je zahrnutá v servisu → žádná samostatná rezerva (bez dvojího počítání)
  merged.bankingHaircutPct = 0;     // haircut nahrazen scénáři odvozenými z percentilů
  merged.scenarios = DEFAULT_ASSUMPTIONS.scenarios; // percentilové scénáře — ignoruj staré uložené (revenueFactor)
  return merged;
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
    // Měna se bere z původní (raw) řady v měně lokality; přepis mylných kódů přes currencyByCode.
    const vatMap = A.vatByCurrency || DEFAULT_ASSUMPTIONS.vatByCurrency;
    const curOverrides = A.currencyByCode || {};
    const netMonthly = (l) => {
      const cur = E.sourceCurrencyForCode(l.code, curOverrides);
      const useSource = !!l.monthlySource;              // nový snapshot = raw v původní měně
      const raw = useSource ? l.monthlySource : (l.monthly || {});
      const fromCur = useSource ? cur : storedBase;     // starý snapshot = už v base měně
      const div = 1 + ((vatMap[cur] != null ? vatMap[cur] : 21) / 100);
      const out = {};
      Object.keys(raw).forEach((ym) => { out[ym] = E.convert(raw[ym], fromCur, base, fx) / div; });
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
      const rentDiv = A.rentVatIncluded ? (1 + ((vatMap.CZK != null ? vatMap.CZK : 21) / 100)) : 1; // nájem s DPH → na bez DPH
      const rentCzk = (typeof cfg.rentMonthlyCzk === 'number') ? cfg.rentMonthlyCzk : A.rentMonthlyDefault;
      const rent = E.convert(rentCzk / rentDiv, 'CZK', base, fx);
      const se = E.siteEconomics({ revenue: avgRev, rentMonthly: rent, servicePct: A.servicePct, energyPct: A.energyPct, paymentFeePct: A.paymentFeePct, maintenanceReservePct: A.maintenanceReservePct });
      return { code: l.code, label: l.label, version, currency: E.sourceCurrencyForCode(l.code, curOverrides), avgRev, ebitda: se.siteEbitda, margin: se.ebitdaMargin, opCashFlow: se.operatingCashFlow, openDate: l.openDate, classification: l.classification, excluded: isExcluded(l) };
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
    // Volatilita + nejhorší klouzavá období (§19/§20) — z měsíční řady portfolia.
    const volatility = E.volatilityStats(portfolioMonthly);
    const worstRolling = {
      m3: E.worstRolling(portfolioMonthly, 3),
      m12: E.worstRolling(portfolioMonthly, 12),
    };

    const cohort = E.cohortCurve(nonTest.filter((l) => !isExcluded(l) && l.classification === 'active' && l.openDate).map((l) => ({ openDate: l.openDate, monthly: netMonthly(l) })), 36);

    // Base scénář EBITDA = medián × faktor Base scénáře (Base = medián +15 %).
    const medianEbitda = ebitdaDist.p50 || 0;
    const baseFactor = (A.scenarios && A.scenarios.base && A.scenarios.base.revenueFactor) || 1;
    const baseCaseEbitda = medianEbitda * baseFactor;
    const baseFactorPct = Math.round((baseFactor - 1) * 1000) / 10;

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
        medianEbitda: Math.round(medianEbitda), baseCaseEbitda: Math.round(baseCaseEbitda), baseFactorPct: baseFactorPct,
      },
      seasonality,
      volatility, worstRolling,
      cohort,
      portfolioMonthly,
      rentStats,
      unitModel: await _unitModelPct(), // referenční % z ŽIVÉ ekonomiky jednoho prádlomatu
      assumptions: A,
      locations: perLoc,
    });
  } catch (err) { next(err); }
});

// Společný výpočet vstupů portfolia (median net tržba/jednotku, marže, kohorta, počet aktivních).
async function _portfolioInputs(hist, A, base) {
  const fx = A.fx || DEFAULT_ASSUMPTIONS.fx;
  const storedBase = hist.base || 'CZK';
  const vatMap = A.vatByCurrency || DEFAULT_ASSUMPTIONS.vatByCurrency;
  const curOverrides = A.currencyByCode || {};
  const excluded = new Set((A.excludedCodes || []).map((c) => String(c).trim().toUpperCase()));
  const isExcluded = (l) => excluded.has(String(l.code).trim().toUpperCase());
  const netMonthly = (l) => {
    const cur = E.sourceCurrencyForCode(l.code, curOverrides);
    const useSource = !!l.monthlySource;
    const raw = useSource ? l.monthlySource : (l.monthly || {});
    const fromCur = useSource ? cur : storedBase;
    const div = 1 + ((vatMap[cur] != null ? vatMap[cur] : 21) / 100);
    const out = {}; Object.keys(raw).forEach((ym) => { out[ym] = E.convert(raw[ym], fromCur, base, fx) / div; });
    return out;
  };
  const avgRecent = (m, n) => { const yms = Object.keys(m).sort(); const use = yms.slice(0, -1).slice(-(n || 12)); return use.length ? use.reduce((a, ym) => a + (m[ym] || 0), 0) / use.length : 0; };
  const stab = Object.assign({}, DEFAULT_ASSUMPTIONS.stabilization, A.stabilization || {});
  const active = (hist.locations || []).filter((l) => l.classification === 'active' && !isExcluded(l));
  // Populace pro percentily: aktivní (+ volitelně uzavřené), bez vyloučených.
  const pool = (hist.locations || []).filter((l) => !isExcluded(l) && (l.classification === 'active' || (stab.includeClosed && l.classification === 'closed')));
  const cohort = E.cohortCurve(pool.filter((l) => l.openDate).map((l) => ({ openDate: l.openDate, monthly: netMonthly(l) })), 36);
  const fromMonth = (stab.stabilizeFromMonth != null && stab.stabilizeFromMonth !== '') ? Number(stab.stabilizeFromMonth) : E.stabilizationMonth(cohort);
  const cfgMap = (await getSetting('compounding.kiosks', { type: 'json', defaultValue: {} })) || {};
  // Stabilizovaná tržba/lokalita (nebo 12M průměr, když stabilizace vypnutá). Krátká historie → mimo percentily.
  let rentSum = 0, rentN = 0, stabExcluded = 0;
  const revs = [], marginArr = [];
  pool.forEach((l) => {
    const m = netMonthly(l);
    const stabVal = stab.enabled
      ? E.stabilizedSiteValue(m, l.openDate, fromMonth, { minHistoryMonths: stab.minHistoryMonths, includeRampUp: stab.includeRampUp })
      : avgRecent(m, 12);
    if (stabVal == null) { stabExcluded++; return; } // nesplňuje min. historii
    revs.push(stabVal);
    const cfg = cfgMap[l.code] || {};
    const rent = (typeof cfg.rentMonthlyCzk === 'number') ? E.convert(cfg.rentMonthlyCzk, 'CZK', base, fx) : A.rentMonthlyDefault;
    rentSum += rent; rentN++;
    marginArr.push(E.siteEconomics({ revenue: stabVal, rentMonthly: rent, servicePct: A.servicePct, energyPct: A.energyPct, paymentFeePct: A.paymentFeePct, maintenanceReservePct: A.maintenanceReservePct }).ebitdaMargin);
  });
  const revDist = E.percentiles(revs);
  const marginDist = E.percentiles(marginArr);
  // Nájem pro scénáře = STEJNÝ jako v „Ukázce jedné lokality" (default, VAT-adjust),
  // ať EBITDA scénářů sedí s dlaždicí (ne průměr skutečných nájmů).
  const vatCZK = (A.vatByCurrency && A.vatByCurrency.CZK != null) ? A.vatByCurrency.CZK : 21;
  const rentDiv = A.rentVatIncluded ? (1 + vatCZK / 100) : 1;
  const rentDefaultBase = E.convert((A.rentMonthlyDefault || 0) / rentDiv, 'CZK', base, fx);
  return {
    activeCount: active.length, medRevenue: revDist.p50 || 0, medMargin: marginDist.p50 || 0,
    revDist, rentBaseAvg: rentDefaultBase, rentActualAvg: rentN ? rentSum / rentN : 0, cohort,
    stabilization: { enabled: !!stab.enabled, fromMonth, includedSites: revs.length, excludedShortHistory: stabExcluded, minHistoryMonths: stab.minHistoryMonths },
  };
}

// Ekonomika scénáře odvozená z PERCENTILU historické distribuce (Base=P50, Downside=P25,
// Stress=P10) + zhoršené náklady/úrok/ramp u Combined. EBITDA se dopočítá NELINEÁRNĚ:
// fixní nájem zůstává, variabilní % (servis/energie/poplatky) škáluje s tržbou → při nižší
// tržbě marže klesá (fixní náklady deleverage). Vrací i revenueFactor = Pxx/P50.
function scenarioEconomics(inp, A, fin, sc) {
  const rd = inp.revDist || {};
  const basis = sc.basis || (sc.revenueFactor != null ? 'faktor' : 'p50');
  const p50 = rd.p50 || inp.medRevenue || 0;
  // Pevný revenueFactor (např. Downside 0,90, Stress 0,80) přebije percentilový základ.
  const rev = (sc.revenueFactor != null) ? p50 * Number(sc.revenueFactor)
            : (rd[basis] != null ? rd[basis] : p50);
  const svc = (Number(A.servicePct) || 0) * (1 + (Number(sc.serviceUpliftPct) || 0) / 100);
  const en = (Number(A.energyPct) || 0) * (1 + (Number(sc.energyUpliftPct) || 0) / 100);
  const fee = Number(A.paymentFeePct) || 0;
  const varPct = svc + en + fee;
  const rent = Number(inp.rentBaseAvg) || 0;
  const ebitda = rev - rent - rev * varPct / 100;
  const margin = rev ? ebitda / rev : 0;
  return {
    basis, perUnitRevenue: rev, perUnitEbitda: ebitda, margin,
    revenueFactor: p50 ? rev / p50 : 1,
    interestRatePct: (Number(fin.interestRatePct) || 0) + (Number(sc.interestAddPct) || 0),
    rampExtraMonths: Math.max(0, Math.floor(Number(sc.rampExtraMonths) || 0)),
  };
}

// GET /api/bank-plan/forecast?base=&scenario=base|downside|stress|combined — model financování a růstu.
router.get('/forecast', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    if (!hist) return res.status(404).json({ error: 'Snapshot historie zatím není. Spusť přebudování dat.' });
    const A = await loadAssumptions();
    const fx = A.fx || DEFAULT_ASSUMPTIONS.fx;
    const base = (req.query.base || hist.base || 'CZK').toUpperCase();
    const fin = Object.assign({}, DEFAULT_ASSUMPTIONS.financing, A.financing || {});
    const scName = ['base', 'downside', 'stress', 'combined'].includes(String(req.query.scenario)) ? String(req.query.scenario) : 'base';
    const scenarios = Object.assign({}, DEFAULT_ASSUMPTIONS.scenarios, A.scenarios || {});
    const sc = scenarios[scName] || scenarios.base;

    const inp = await _portfolioInputs(hist, A, base);
    // Scénář = percentil historické distribuce (Base P50 / Downside P25 / Stress P10) + nelineární EBITDA.
    const se = scenarioEconomics(inp, A, fin, sc);
    const perUnitRevenue = se.perUnitRevenue;
    const toBase = (czk) => E.convert(czk, 'CZK', base, fx);
    const unitCostBase = E.convert((A.unitCostEur || 52000), 'EUR', base, fx);
    const unitAllIn = E.convert((A.unitCostEur || 52000) + (fin.allInExtraEur || 0), 'EUR', base, fx);
    let rampCurve = F.rampFromCohort(inp.cohort, inp.medRevenue || 1);
    // Combined stress: nové lokality najíždějí pomaleji (+X měsíců nízkého výkonu na začátku rampy).
    if (se.rampExtraMonths > 0 && rampCurve.length) rampCurve = Array(se.rampExtraMonths).fill(rampCurve[0]).concat(rampCurve);
    // Počáteční síť: skutečná aktivní, nebo ruční přepis (0 = greenfield pro partnery v jiných zemích).
    const startUnits = (fin.startUnitsOverride != null && fin.startUnitsOverride !== '')
      ? Math.max(0, Math.floor(Number(fin.startUnitsOverride)))
      : inp.activeCount;
    const greenfield = startUnits === 0;

    // Výchozí je reinvestiční režim (samofinancovaný růst z cash flow); ?mode=facility vypne.
    const mode = String(req.query.mode || '') === 'facility' ? 'facility' : 'reinvest';
    const builder = mode === 'reinvest' ? F.buildReinvestForecast : F.buildForecast;
    const fc = builder({
      months: fin.horizonMonths, startUnits: startUnits,
      perUnitRevenue, ebitdaMargin: se.margin,
      centralCostMonthly: toBase(fin.centralCostMonthlyCzk), taxRatePct: fin.taxRatePct,
      maintenanceReservePct: A.maintenanceReservePct, minLiquidity: toBase(fin.minLiquidityCzk),
      rampCurve, newUnitsPerMonth: fin.newUnitsPerMonth,
      unitAllInCapex: unitAllIn, unitCostBase, bankFinancingPct: fin.bankFinancingPct,
      interestRatePct: se.interestRatePct,
      maturityMonths: fin.maturityMonths, graceMonths: fin.graceMonths,
      facilityLimit: toBase(fin.facilityLimitCzk), targetUnitsPerMonth: A.targetUnitsPerMonth || 4,
      depreciationMonths: (fin.depreciationYears || 0) * 12, unitDepBase: unitAllIn,
    });

    // ── Ukázka jedné lokality (reprezentativní, mediánová) — celý rozpad měsíčně ──
    const vatCZK = (A.vatByCurrency && A.vatByCurrency.CZK != null) ? A.vatByCurrency.CZK : 21;
    const rentDiv = A.rentVatIncluded ? (1 + vatCZK / 100) : 1;
    const rentU = E.convert((A.rentMonthlyDefault || 0) / rentDiv, 'CZK', base, fx);
    // Ukázka jedné lokality = SKUTEČNÝ medián (bez haircutu/scénáře), ať sedí s horními KPI.
    // Haircut/scénář se používá jen v agregátním forecastu (DSCR, crossover).
    const revenueU = inp.medRevenue;
    const serviceU = revenueU * A.servicePct / 100;
    const energyU = revenueU * A.energyPct / 100;
    const feeU = revenueU * A.paymentFeePct / 100;
    const directOpexU = rentU + serviceU + energyU + feeU;
    const ebitdaU = revenueU - directOpexU;
    const maintU = revenueU * A.maintenanceReservePct / 100;
    const mRate = ((fin.interestRatePct || 0) + (sc.interestAddPct || 0)) / 100 / 12;
    const debtPerUnit = unitAllIn * (fin.bankFinancingPct / 100);
    const paymentU = E.annuityPayment(debtPerUnit, mRate, Math.max(1, fin.maturityMonths - fin.graceMonths));
    const interestU = debtPerUnit * mRate;
    const depMonthsU = (fin.depreciationYears || 0) * 12;
    const deprU = depMonthsU > 0 ? unitAllIn / depMonthsU : 0; // měsíční odpis (daňový štít během odpisu)
    const taxU = Math.max(0, ebitdaU - interestU - deprU) * (fin.taxRatePct || 0) / 100;
    const netWithDebtU = ebitdaU - maintU - paymentU - taxU;
    // Po splacení stroje je i odepsaný → daň z plné EBITDA (bez štítu).
    const taxNoDebtU = Math.max(0, ebitdaU) * (fin.taxRatePct || 0) / 100;
    const netPaidOffU = ebitdaU - maintU - taxNoDebtU;
    const rnd = (x) => Math.round(x);
    const unitBreakdown = {
      revenue: rnd(revenueU), rent: rnd(rentU), service: rnd(serviceU), energy: rnd(energyU), fee: rnd(feeU),
      directOpex: rnd(directOpexU), ebitda: rnd(ebitdaU), ebitdaMargin: revenueU ? ebitdaU / revenueU : 0,
      noi: rnd(ebitdaU - maintU), // NOI = provozní zisk před daní i splátkou (= EBITDA − údržba; údržba je defaultně v servisu)
      maintenance: rnd(maintU), payment: rnd(paymentU), tax: rnd(taxU), depreciation: rnd(deprU), depreciationYears: (fin.depreciationYears || 0),
      netWithDebt: rnd(netWithDebtU), netPaidOff: rnd(netPaidOffU),
      allIn: rnd(unitAllIn), debtPerUnit: rnd(debtPerUnit), equityPerUnit: rnd(unitAllIn - debtPerUnit),
    };

    res.json({
      base, scenario: scName, mode, unitBreakdown, greenfield, startUnits,
      inputs: { activeCount: inp.activeCount, startUnits: startUnits, greenfield: greenfield, medRevenue: Math.round(inp.medRevenue), medMargin: inp.medMargin, perUnitRevenue: Math.round(perUnitRevenue), unitCostBase: Math.round(unitCostBase), unitAllIn: Math.round(unitAllIn), rampCurve, targetUnitsPerMonth: (A.targetUnitsPerMonth || 4), buildPace: fin.newUnitsPerMonth },
      financing: fin, scenarios, activeScenario: sc,
      scenarioMeta: (function(){
        const maintM = se.perUnitRevenue * (Number(A.maintenanceReservePct) || 0) / 100;
        const cfadsUnit = se.perUnitEbitda - maintM;
        const debtPerUnit = unitAllIn * (fin.bankFinancingPct || 0) / 100;
        const amortN = Math.max(1, (fin.maturityMonths || 84) - (fin.graceMonths || 0));
        const annuity = E.annuityPayment(debtPerUnit, se.interestRatePct / 100 / 12, amortN);
        const dscrUnit = annuity > 0 ? cfadsUnit / annuity : null;
        return {
          key: scName, label: sc.label || scName, basis: se.basis,
          revenueFactor: Math.round(se.revenueFactor * 1000) / 1000,
          perUnitRevenue: Math.round(se.perUnitRevenue), perUnitEbitda: Math.round(se.perUnitEbitda),
          perUnitAnnuity: Math.round(annuity), interestRatePct: Math.round(se.interestRatePct * 100) / 100,
          dscrUnit: dscrUnit, dscrTarget: Number(sc.dscrTarget) || null,
          pass: (dscrUnit != null && sc.dscrTarget) ? (dscrUnit >= sc.dscrTarget) : null,
        };
      })(),
      summary: fc.summary, rows: fc.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/bank-plan/scenarios — srovnání všech scénářů (Base/Downside/HistStress/Combined)
// s covenant PASS/FAIL. Datově dynamické z percentilů historické distribuce.
router.get('/scenarios', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    if (!hist) return res.status(404).json({ error: 'Snapshot historie zatím není.' });
    const A = await loadAssumptions();
    const fx = A.fx || DEFAULT_ASSUMPTIONS.fx;
    const base = (req.query.base || hist.base || 'CZK').toUpperCase();
    const fin = Object.assign({}, DEFAULT_ASSUMPTIONS.financing, A.financing || {});
    const mode = String(req.query.mode || '') === 'facility' ? 'facility' : 'reinvest';
    const builder = mode === 'reinvest' ? F.buildReinvestForecast : F.buildForecast;
    const inp = await _portfolioInputs(hist, A, base);
    const toBase = (czk) => E.convert(czk, 'CZK', base, fx);
    const unitCostBase = E.convert((A.unitCostEur || 52000), 'EUR', base, fx);
    const unitAllIn = E.convert((A.unitCostEur || 52000) + (fin.allInExtraEur || 0), 'EUR', base, fx);
    const startUnits = (fin.startUnitsOverride != null && fin.startUnitsOverride !== '') ? Math.max(0, Math.floor(Number(fin.startUnitsOverride))) : inp.activeCount;
    const scenarios = Object.assign({}, DEFAULT_ASSUMPTIONS.scenarios, A.scenarios || {});
    const order = ['base', 'downside', 'stress', 'combined'];
    const out = order.filter((k) => scenarios[k]).map((k) => {
      const sc = scenarios[k];
      const se = scenarioEconomics(inp, A, fin, sc);
      let rampCurve = F.rampFromCohort(inp.cohort, inp.medRevenue || 1);
      if (se.rampExtraMonths > 0 && rampCurve.length) rampCurve = Array(se.rampExtraMonths).fill(rampCurve[0]).concat(rampCurve);
      const fc = builder({
        months: fin.horizonMonths, startUnits, perUnitRevenue: se.perUnitRevenue, ebitdaMargin: se.margin,
        centralCostMonthly: toBase(fin.centralCostMonthlyCzk), taxRatePct: fin.taxRatePct,
        maintenanceReservePct: A.maintenanceReservePct, minLiquidity: toBase(fin.minLiquidityCzk),
        rampCurve, newUnitsPerMonth: fin.newUnitsPerMonth, unitAllInCapex: unitAllIn, unitCostBase,
        bankFinancingPct: fin.bankFinancingPct, interestRatePct: se.interestRatePct,
        maturityMonths: fin.maturityMonths, graceMonths: fin.graceMonths,
        facilityLimit: toBase(fin.facilityLimitCzk), targetUnitsPerMonth: A.targetUnitsPerMonth || 4,
        depreciationMonths: (fin.depreciationYears || 0) * 12, unitDepBase: unitAllIn,
      });
      const s = fc.summary || {};
      const target = Number(sc.dscrTarget) || null;
      const maint = se.perUnitRevenue * (Number(A.maintenanceReservePct) || 0) / 100;
      const cfadsUnit = se.perUnitEbitda - maint;
      // Ustálený DSCR na jednotku = NOI/CFADS jednotky ÷ její anuita (na financovanou část).
      // Nezávislý na časování instalací (ne portfolio-lifetime průměr, který nafoukne růst).
      const debtPerUnit = unitAllIn * (fin.bankFinancingPct || 0) / 100;
      const amortN = Math.max(1, (fin.maturityMonths || 84) - (fin.graceMonths || 0));
      const annuity = E.annuityPayment(debtPerUnit, se.interestRatePct / 100 / 12, amortN);
      const dscrUnit = annuity > 0 ? cfadsUnit / annuity : null;
      return {
        key: k, label: sc.label || k, basis: se.basis,
        revenueFactor: Math.round(se.revenueFactor * 1000) / 1000,
        perUnitRevenue: Math.round(se.perUnitRevenue), perUnitEbitda: Math.round(se.perUnitEbitda),
        perUnitCfads: Math.round(cfadsUnit), perUnitAnnuity: Math.round(annuity),
        interestRatePct: Math.round(se.interestRatePct * 100) / 100,
        dscrUnit: dscrUnit, avgDscrPortfolio: s.avgDscr, minDscrPortfolio: s.minDscr, dscrTarget: target,
        pass: (dscrUnit != null && target) ? (dscrUnit >= target) : null,
      };
    });
    res.json({ base, mode, scenarios: out, percentiles: inp.revDist });
  } catch (err) { next(err); }
});

// GET /api/bank-plan/debt-sizing — max. bezpečný dluh/jednotku (§12).
// Dluh se přizpůsobí výkonu (§22): najde max jistinu, aby Base DSCR ≥ target a Downside DSCR ≥ target.
router.get('/debt-sizing', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    if (!hist) return res.status(404).json({ error: 'Snapshot historie zatím není.' });
    const A = await loadAssumptions();
    const fx = A.fx || DEFAULT_ASSUMPTIONS.fx;
    const base = (req.query.base || hist.base || 'CZK').toUpperCase();
    const fin = Object.assign({}, DEFAULT_ASSUMPTIONS.financing, A.financing || {});
    const inp = await _portfolioInputs(hist, A, base);
    const scenarios = Object.assign({}, DEFAULT_ASSUMPTIONS.scenarios, A.scenarios || {});
    const unitAllIn = E.convert((A.unitCostEur || 52000) + (fin.allInExtraEur || 0), 'EUR', base, fx);
    const maintPct = Number(A.maintenanceReservePct) || 0;
    const tenor = Math.max(1, (fin.maturityMonths || 84) - (fin.graceMonths || 0));
    // Vyhodnoť vazbu pro Base (target ~1.30) a Downside (target ~1.20) — bere se přísnější.
    const legs = ['base', 'downside'].filter((k) => scenarios[k]).map((k) => {
      const sc = scenarios[k];
      const se = scenarioEconomics(inp, A, fin, sc);
      const cfads = se.perUnitEbitda - se.perUnitRevenue * maintPct / 100;
      const r = se.interestRatePct / 100 / 12;
      const target = Number(sc.dscrTarget) || 0;
      const maxDebt = E.maxDebtForDscr(cfads, target, r, tenor);
      return { key: k, label: sc.label || k, cfadsPerUnit: Math.round(cfads), dscrTarget: target, maxDebtPerUnit: Math.round(maxDebt) };
    });
    const bindable = legs.filter((l) => l.maxDebtPerUnit > 0);
    const binding = bindable.length ? bindable.reduce((a, b) => (b.maxDebtPerUnit < a.maxDebtPerUnit ? b : a)) : null;
    const maxSafeDebt = binding ? Math.min(binding.maxDebtPerUnit, unitAllIn) : 0;
    const maxLtcPct = unitAllIn > 0 ? Math.round(maxSafeDebt / unitAllIn * 1000) / 10 : 0;
    res.json({
      base, unitAllIn: Math.round(unitAllIn), tenorMonths: tenor, graceMonths: fin.graceMonths || 0,
      interestRatePct: fin.interestRatePct || 0,
      legs, bindingScenario: binding ? binding.key : null,
      maxSafeDebtPerUnit: Math.round(maxSafeDebt), maxLtcPct,
      requiredEquityPerUnit: Math.round(unitAllIn - maxSafeDebt),
      currentBankPct: fin.bankFinancingPct, currentDebtPerUnit: Math.round(unitAllIn * (fin.bankFinancingPct || 0) / 100),
    });
  } catch (err) { next(err); }
});

// POST /api/bank-plan/risks/ai-assess — AI zhodnotí rizika v kontextu reálných čísel plánu.
router.post('/risks/ai-assess', requireAuth, async (req, res, next) => {
  try {
    const hist = await getSetting(HISTORY_KEY, { type: 'json', defaultValue: null });
    if (!hist) return res.status(404).json({ error: 'Snapshot historie zatím není.' });
    const A = await loadAssumptions();
    const risks = A.risks || DEFAULT_ASSUMPTIONS.risks;
    // Kontext = reálné výstupy modelu (Base + Stress), ať AI nehádá.
    const base = 'CZK';
    const inp = await _portfolioInputs(hist, A, base);
    const fin = Object.assign({}, DEFAULT_ASSUMPTIONS.financing, A.financing || {});
    const mkFc = (scName) => {
      const scenarios = Object.assign({}, DEFAULT_ASSUMPTIONS.scenarios, A.scenarios || {});
      const sc = scenarios[scName] || scenarios.base;
      const se = scenarioEconomics(inp, A, fin, sc);
      const toBase = (czk) => E.convert(czk, 'CZK', base, A.fx || DEFAULT_ASSUMPTIONS.fx);
      const unitCostBase = E.convert((A.unitCostEur || 52000), 'EUR', base, A.fx || DEFAULT_ASSUMPTIONS.fx);
      const unitAllIn = E.convert((A.unitCostEur || 52000) + (fin.allInExtraEur || 0), 'EUR', base, A.fx || DEFAULT_ASSUMPTIONS.fx);
      const start = (fin.startUnitsOverride != null && fin.startUnitsOverride !== '') ? Math.max(0, Math.floor(Number(fin.startUnitsOverride))) : inp.activeCount;
      let rampCurve = F.rampFromCohort(inp.cohort, inp.medRevenue || 1);
      if (se.rampExtraMonths > 0 && rampCurve.length) rampCurve = Array(se.rampExtraMonths).fill(rampCurve[0]).concat(rampCurve);
      return F.buildReinvestForecast({ months: fin.horizonMonths, startUnits: start, perUnitRevenue: se.perUnitRevenue, ebitdaMargin: se.margin, centralCostMonthly: toBase(fin.centralCostMonthlyCzk), taxRatePct: fin.taxRatePct, maintenanceReservePct: A.maintenanceReservePct, minLiquidity: toBase(fin.minLiquidityCzk), rampCurve, newUnitsPerMonth: fin.newUnitsPerMonth, unitAllInCapex: unitAllIn, unitCostBase, bankFinancingPct: fin.bankFinancingPct, interestRatePct: se.interestRatePct, maturityMonths: fin.maturityMonths, graceMonths: fin.graceMonths, facilityLimit: toBase(fin.facilityLimitCzk), targetUnitsPerMonth: A.targetUnitsPerMonth || 4, depreciationMonths: (fin.depreciationYears || 0) * 12, unitDepBase: unitAllIn });
    };
    const fcBase = mkFc('base'); const fcStress = mkFc('stress');

    const ctx = {
      trackRecord: { years: null, activeCount: inp.activeCount },
      yearsData: (() => { const f = hist.globalFirst ? new Date(hist.globalFirst) : null; return f ? Math.round((Date.now() - f) / (365 * 86400000) * 10) / 10 : null; })(),
      locations: inp.activeCount, medianRevenueCzk: Math.round(inp.medRevenue), medianMarginPct: Math.round(inp.medMargin * 1000) / 10,
      baseMinDscr: fcBase.summary.minDscr, baseAvgDscr: fcBase.summary.avgDscr, stressMinDscr: fcStress.summary.minDscr,
      crossover: fcBase.summary.crossover, peakDebt: fcBase.summary.peakDebt, facilityCzk: fin.facilityLimitCzk, interestPct: fin.interestRatePct,
    };

    const sm = require('../services/ai/sales-manager');
    const sys = 'Jsi zkušený úvěrový analytik banky. Dostaneš seznam rizik projektu financování sítě samoobslužných prádelen (prádlomatů) a REÁLNÉ výstupy finančního modelu. Ke KAŽDÉMU riziku: (a) navrhni pravděpodobnost a dopad — POUZE jednu z hodnot "nízká", "střední", "vysoká" — na základě dodaných čísel a povahy rizika; (b) napiš stručné konkrétní zhodnocení a doporučení OPŘENÉ O DODANÁ ČÍSLA (DSCR, crossover, počet lokalit, historie). NEVYMÝŠLEJ hodnoty, které nemáš. Buď věcný, konzervativní, bez marketingu. Odpověz POUZE platným JSON: {"items":[{"label":"<přesně název rizika>","probability":"nízká|střední|vysoká","impact":"nízká|střední|vysoká","assessment":"<1-2 věty>","recommendation":"<1 věta>"}]}. Piš česky.';
    const usr = 'Rizika (JSON):\n' + JSON.stringify(risks.map((r) => ({ label: r.label, probability: r.probability, impact: r.impact, mitigation: r.mitigation }))) + '\n\nReálné výstupy modelu (JSON):\n' + JSON.stringify(ctx);
    const out = await sm.callClaudeJSON(sys, usr, 1600);
    if (!out || !Array.isArray(out.items)) return res.status(502).json({ error: 'AI nevrátila použitelný výstup.' });
    res.json({ ok: true, items: out.items, context: ctx });
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
