// HolyOS — testy SIS history service (mock fetch, bez sítě).
// Spuštění: node scripts/test-bank-plan-history.js

const assert = require('assert');
const H = require('../services/bank-plan/sis-history');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }
function approx(name, got, exp, tol) { const t = tol == null ? 1e-6 : tol; assert.ok(Math.abs(got - exp) <= t, name + ' (got ' + got + ', exp ' + exp + ')'); console.log('  ✓ ' + name); passed++; }

// Mock transakce per kód. Vracíme stránkovaně.
const DB = {
  // CZ lokalita: 300 tx (reálná), leden+únor 2025
  '00001CZ': gen('2025-01-15', 150, 100).concat(gen('2025-02-15', 150, 100)),
  // PL lokalita: 300 tx, částky v PLN (100), převod na CZK ×5.8
  '00001PL': gen('2025-01-10', 300, 100),
  // Test kiosk: jen 5 tx → vyřadit
  'TEST': gen('2022-02-01', 5, 50),
  // Uzavřená: 250 tx, poslední 2024-01 (dávno) → closed
  '2DEAD': gen('2023-06-01', 250, 80),
  // Vadná data: 210 tx s rokem 0001 → nemají valid datum
  'BADCZ': genBad(210, 100),
};
function gen(startISO, n, amount) {
  const out = []; const d = new Date(startISO);
  for (let i = 0; i < n; i++) { const dt = new Date(d.getTime() + i * 3600000); out.push({ datetime: dt.toISOString(), status: 'Successful', amount }); }
  return out;
}
function genBad(n, amount) { const out = []; for (let i = 0; i < n; i++) out.push({ datetime: '0001-01-01T00:00:00Z', status: 'Successful', amount }); return out; }

function makeFetch(db) {
  return async function fetchTx(code, limit, offset) {
    const all = db[code] || [];
    const slice = all.slice(offset, offset + limit);
    return { transactions: slice, total: all.length };
  };
}

(async () => {
  const nowMs = new Date('2025-03-01').getTime();
  const fx = { CZK: 1, EUR: 25, PLN: 5.8 };

  console.log('AGREGACE JEDNÉ LOKALITY');
  const agg = await H.aggregateKiosk('00001CZ', makeFetch(DB), { limit: 100 });
  approx('CZ leden suma = 15000 (150×100)', agg.monthly['2025-01'], 15000);
  approx('CZ únor suma = 15000', agg.monthly['2025-02'], 15000);
  ok('CZ počet tx = 300', agg.count === 300);
  ok('CZ complete', agg.complete === true);

  console.log('VADNÁ DATA');
  const bad = await H.aggregateKiosk('BADCZ', makeFetch(DB), { limit: 100 });
  ok('BADCZ nemá first (všechna data vadná)', bad.first === null);
  ok('BADCZ badDates = 210', bad.badDates === 210);
  ok('BADCZ žádná měsíční data', Object.keys(bad.monthly).length === 0);

  console.log('KLASIFIKACE');
  ok('TEST = test (málo tx)', H.classify(await H.aggregateKiosk('TEST', makeFetch(DB), {}), nowMs).isTest);
  ok('2DEAD = closed (stará poslední tx)', H.classify(await H.aggregateKiosk('2DEAD', makeFetch(DB), {}), nowMs).isClosed);
  ok('00001CZ = active', H.classify(agg, nowMs).isActive);

  console.log('PORTFOLIO + MĚNA');
  const hist = await H.buildHistory({
    kiosks: [{ code: '00001CZ' }, { code: '00001PL' }, { code: 'TEST' }, { code: '2DEAD' }, { code: 'BADCZ' }],
    fetchTx: makeFetch(DB), base: 'CZK', fx, nowMs, limit: 100,
  });
  ok('realCount = 3 (CZ, PL, DEAD; TEST+BAD ven)', hist.portfolio.realCount === 3);
  ok('activeCount = 2 (CZ, PL)', hist.portfolio.activeCount === 2);
  ok('closedCount = 1 (DEAD)', hist.portfolio.closedCount === 1);
  ok('testCount = 2 (TEST, BADCZ)', hist.portfolio.testCount === 2);
  // PL leden: 300×100 PLN = 30000 PLN → CZK ×5.8 = 174000; CZ leden 15000 → portfolio 2025-01 = 189000
  approx('portfolio 2025-01 v CZK = 189000', hist.portfolio.monthly['2025-01'], 189000);
  // base = EUR test
  const histEur = await H.buildHistory({ kiosks: [{ code: '00001CZ' }], fetchTx: makeFetch(DB), base: 'EUR', fx, nowMs, limit: 100 });
  approx('CZ leden 15000 CZK → EUR = 600', histEur.locations[0].monthly['2025-01'], 600);

  console.log('DATUM OTEVŘENÍ');
  const cz = hist.locations.find((l) => l.code === '00001CZ');
  ok('openDate = 2025-01-15 z první tx', cz.openDate === '2025-01-15');
  ok('openDateSource = sis_first_tx', cz.openDateSource === 'sis_first_tx');

  console.log('\n✅ Všech ' + passed + ' testů prošlo.');
})().catch((e) => { console.error('❌ TEST SELHAL:', e.message); process.exit(1); });
