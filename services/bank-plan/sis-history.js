// HolyOS — Bankovní Business Plan: sestavení historie ze SIS.
// Čistá logika agregace (fetch injektovaný přes fetchTx → testovatelné bez sítě).
// Z SIS transakcí poskládá měsíční řadu tržeb per lokalita, převede do base měny,
// odfiltruje vadná data (datum < 2010, test kiosky) a odvodí datum otevření = 1. transakce.

'use strict';

const E = require('./engine');

const DEFAULT_FX = { CZK: 1, EUR: 25, PLN: 5.8 };
const MIN_TX_REAL = 200;          // pod tímto počtem transakcí = test/legacy, vyřadit
const CLOSED_AFTER_DAYS = 90;     // bez transakce déle než X dní = uzavřená/přesunutá
const MIN_VALID_YEAR = 2010;      // datum starší = vadné (SIS vrací 0001-01-01 apod.)

function ymOf(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function monthsBetween(aMs, bMs) { const a = new Date(aMs), b = new Date(bMs); return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); }

// Projde všechny transakce jedné lokality (stránkování přes fetchTx) a vrátí
// měsíční sumy úspěšných transakcí ve ZDROJOVÉ měně + first/last/počty.
// fetchTx(code, limit, offset) → { transactions:[{datetime,status,amount,currency}], total }
async function aggregateKiosk(code, fetchTx, opts) {
  const limit = (opts && opts.limit) || 500;
  const maxPages = (opts && opts.maxPages) || 5000;
  const monthly = {};
  let first = null, last = null, count = 0, successCount = 0, offset = 0, pages = 0, complete = false, total = null, badDates = 0;
  while (pages < maxPages) {
    const res = await fetchTx(code, limit, offset);
    const txs = (res && Array.isArray(res.transactions)) ? res.transactions : [];
    if (res && typeof res.total === 'number') total = res.total;
    if (!txs.length) { complete = true; break; }
    for (const t of txs) {
      count++;
      const ts = t.datetime ? new Date(t.datetime).getTime() : 0;
      const validDate = ts && new Date(ts).getFullYear() >= MIN_VALID_YEAR;
      if (!validDate) { badDates++; }
      else {
        if (first == null || ts < first) first = ts;
        if (last == null || ts > last) last = ts;
      }
      if (String(t.status) === 'Successful') {
        successCount++;
        if (validDate) { const ym = ymOf(ts); monthly[ym] = (monthly[ym] || 0) + (Number(t.amount) || 0); }
      }
    }
    offset += txs.length; pages++;
    if (total != null && offset >= total) { complete = true; break; }
  }
  return { code, monthly, first, last, count, successCount, badDates, complete, pages };
}

// Klasifikace lokality z agregace + kontextu.
function classify(agg, nowMs) {
  const isTest = (agg.count || 0) < MIN_TX_REAL || !agg.first;
  const inactiveDays = agg.last ? (nowMs - agg.last) / 86400000 : Infinity;
  const isClosed = !isTest && inactiveDays >= CLOSED_AFTER_DAYS;
  return { isTest, isClosed, isActive: !isTest && !isClosed };
}

// Sestaví celou historii portfolia. kiosks = [{code,label}], fetchTx injektovaný.
// Vrací per-lokalitu (měsíční řada v base měně, datum otevření, klasifikace) + portfolio agregát.
async function buildHistory(params) {
  const kiosks = params.kiosks || [];
  const fetchTx = params.fetchTx;
  const base = params.base || 'CZK';
  const fx = params.fx || DEFAULT_FX;
  const nowMs = params.nowMs || Date.now();

  const locations = [];
  const portfolioMonthly = {};
  let globalFirst = null, globalLast = null, locationMonths = 0;
  let activeCount = 0, closedCount = 0, testCount = 0, totalTx = 0;

  for (const k of kiosks) {
    const code = String(k.code);
    const agg = await aggregateKiosk(code, fetchTx, params);
    const cur = E.sourceCurrencyForCode(code);
    // převod měsíční řady do base měny
    const monthlyBase = {};
    Object.keys(agg.monthly).forEach((ym) => { monthlyBase[ym] = E.convert(agg.monthly[ym], cur, base, fx); });
    const cls = classify(agg, nowMs);
    totalTx += agg.count;
    if (cls.isTest) testCount++;
    else {
      if (cls.isActive) activeCount++; else closedCount++;
      const endMs = cls.isClosed ? agg.last : nowMs;
      if (agg.first) { locationMonths += Math.max(1, monthsBetween(agg.first, endMs) + 1); }
      // přičti do portfolia (jen reálné lokality)
      Object.keys(monthlyBase).forEach((ym) => { portfolioMonthly[ym] = (portfolioMonthly[ym] || 0) + monthlyBase[ym]; });
      if (agg.first && (globalFirst == null || agg.first < globalFirst)) globalFirst = agg.first;
      if (agg.last && (globalLast == null || agg.last > globalLast)) globalLast = agg.last;
    }
    locations.push({
      code, label: k.label || code, currency: cur,
      openDate: agg.first ? new Date(agg.first).toISOString().slice(0, 10) : null,
      openDateSource: agg.first ? 'sis_first_tx' : null, // později lze přepsat na 'manual'
      lastTx: agg.last ? new Date(agg.last).toISOString().slice(0, 10) : null,
      txCount: agg.count, successCount: agg.successCount, badDates: agg.badDates,
      complete: agg.complete,
      classification: cls.isTest ? 'test' : (cls.isClosed ? 'closed' : 'active'),
      monthly: monthlyBase,
    });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    base, fx,
    globalFirst: globalFirst ? new Date(globalFirst).toISOString().slice(0, 10) : null,
    globalLast: globalLast ? new Date(globalLast).toISOString().slice(0, 10) : null,
    portfolio: { monthly: portfolioMonthly, locationMonths, activeCount, closedCount, testCount, totalTx, realCount: activeCount + closedCount },
    locations,
  };
}

// Default fetchTx proti SIS (server-side, klíč z env). Vrací { transactions, total }.
function makeSisFetchTx(env) {
  const apiKey = (env && env.SIS_KIOSK_API_KEY) || process.env.SIS_KIOSK_API_KEY;
  const valuesUrl = (env && env.SIS_KIOSK_API_URL) || process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
  const txUrl = ((env && env.SIS_KIOSK_TX_API_URL) || process.env.SIS_KIOSK_TX_API_URL
    || valuesUrl.replace(/kiosk-values\/?$/, 'kiosk-transactions')).replace(/\/$/, '');
  return async function fetchTx(code, limit, offset) {
    const url = txUrl + '/' + encodeURIComponent(code) + '?limit=' + limit + '&offset=' + offset;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal });
      clearTimeout(to);
      if (!r.ok) return { transactions: [], total: 0, error: 'HTTP ' + r.status };
      return await r.json();
    } catch (e) { clearTimeout(to); return { transactions: [], total: 0, error: String(e.message || e) }; }
  };
}

module.exports = { aggregateKiosk, classify, buildHistory, makeSisFetchTx, DEFAULT_FX, MIN_TX_REAL, CLOSED_AFTER_DAYS };
