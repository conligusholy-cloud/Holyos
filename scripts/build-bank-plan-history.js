// HolyOS — sestaví snapshot historie ze SIS pro Bankovní Business Plan a uloží ho
// do AppSetting `bank_plan.sis_history` (rychlé čtení z UI, reprodukovatelné ke snapshotu).
//
// Běží mimo request (může trvat minuty) — pouští se lokálně nebo na serveru:
//   node scripts/build-bank-plan-history.js              # base CZK
//   node scripts/build-bank-plan-history.js --base=EUR
//   railway run node scripts/build-bank-plan-history.js  # v Railway kontextu (má SIS klíč i DB)
//
// Vyžaduje: SIS_KIOSK_API_KEY (+URL) a DATABASE_URL. Čte SIS, zapisuje jen AppSetting + JSON.

const fs = require('fs');
const path = require('path');

// .env fallback (SIS klíč, DB URL)
(function loadEnv() {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    t.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch (e) { /* .env nemusí existovat */ }
})();

const H = require('../services/bank-plan/sis-history');
const { setSetting } = require('../services/settings');

const args = {}; process.argv.slice(2).forEach((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); if (m) args[m[1]] = m[2] === '' ? true : m[2]; });
const BASE = (args.base || 'CZK').toUpperCase();

async function fetchKioskList() {
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  const url = (process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values').replace(/\/$/, '');
  const r = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('kiosk-values HTTP ' + r.status);
  const j = await r.json();
  return { kiosks: Array.isArray(j.kiosks) ? j.kiosks.map((k) => ({ code: k.code, label: k.label || k.code })) : [], header: { generatedAt: j.generatedAt, period: j.period, valueCurrency: j.valueCurrency } };
}

(async () => {
  if (!process.env.SIS_KIOSK_API_KEY) { console.error('❌ Chybí SIS_KIOSK_API_KEY.'); process.exit(1); }
  console.log('Base měna:', BASE);
  console.log('Načítám seznam lokalit ze SIS…');
  const { kiosks, header } = await fetchKioskList();
  console.log('  lokalit:', kiosks.length);

  const fetchTx = H.makeSisFetchTx(process.env);
  console.log('Stahuji plnou historii transakcí (může chvíli trvat)…');
  const t0 = Date.now();
  const hist = await H.buildHistory({ kiosks, fetchTx, base: BASE, fx: H.DEFAULT_FX, limit: 500 });
  hist.sisHeader = header;
  console.log('  hotovo za', Math.round((Date.now() - t0) / 1000), 's');
  console.log('  reálných lokalit:', hist.portfolio.realCount, '| aktivních:', hist.portfolio.activeCount, '| uzavřených:', hist.portfolio.closedCount, '| test:', hist.portfolio.testCount);
  console.log('  location-months:', hist.portfolio.locationMonths, '| historie od', hist.globalFirst, 'do', hist.globalLast);

  // JSON pro kontrolu
  const outDir = path.join(__dirname, 'out'); try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
  fs.writeFileSync(path.join(outDir, 'bank-plan-history.json'), JSON.stringify(hist, null, 2));
  console.log('  JSON:', path.join(outDir, 'bank-plan-history.json'));

  // Uložit do AppSetting (čte ho route /api/bank-plan/history)
  try {
    await setSetting('bank_plan.sis_history', hist, { type: 'json', description: 'Snapshot historie ze SIS pro Bankovní Business Plan' });
    console.log('  ✓ Uloženo do AppSetting bank_plan.sis_history');
  } catch (e) {
    console.error('  ⚠ Uložení do DB selhalo (běžíš bez DATABASE_URL?):', e.message);
    console.error('    JSON je i tak k dispozici výše.');
  }
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
