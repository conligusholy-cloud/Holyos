// HolyOS — SIS probe: zjistí NEJSTARŠÍ dostupná data ze SIS API per lokalita.
// Pro business plán potřebujeme vědět, jak hluboko do historie SIS sahá a jestli
// se z první transakce dá odvodit "datum uvedení do provozu".
//
// Co dělá:
//   1) Zavolá kiosk-values → seznam lokalit + hlavičku (yearFrom, period, generatedAt).
//   2) Pro každou lokalitu prochází kiosk-transactions stránku po stránce AŽ NA KONEC
//      (transakce chodí od nejnovějších) a hledá NEJSTARŠÍ datum + počet + sumu.
//   3) Vypíše tabulku: kód, název, první tx (nejstarší), poslední tx, počet tx.
//   4) Vypíše celkově nejstarší datum napříč portfoliem a uloží JSON do
//      scripts/out/sis-oldest.json (per-lokalita first/last tx = základ pro datum otevření).
//
// Použití (lokálně, kde je .env se SIS klíčem a přístup k SIS):
//   node scripts/sis-oldest-data-probe.js                # celé portfolio (může chvíli trvat)
//   node scripts/sis-oldest-data-probe.js --code=00015CZ # jen jedna lokalita (rychlé)
//   node scripts/sis-oldest-data-probe.js --limit=500 --maxpages=3000
//
// Nic nezapisuje do DB ani SIS. Jen čte.

const fs = require('fs');
const path = require('path');

// ── Načtení SIS klíče/URL z .env (fallback na process.env) ──────────────────
function loadEnv() {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    t.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m) out[m[1]] = m[2].trim();
    });
  } catch (e) { /* .env nemusí existovat */ }
  return out;
}
const env = loadEnv();
const API_KEY = process.env.SIS_KIOSK_API_KEY || env.SIS_KIOSK_API_KEY;
const VALUES_URL = (process.env.SIS_KIOSK_API_URL || env.SIS_KIOSK_API_URL
  || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values').replace(/\/$/, '');
const TX_URL = (process.env.SIS_KIOSK_TX_API_URL || env.SIS_KIOSK_TX_API_URL
  || VALUES_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions')).replace(/\/$/, '');

// ── Argumenty ───────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); if (m) args[m[1]] = m[2] === '' ? true : m[2]; });
const ONLY_CODE = args.code || null;
const PAGE = Math.min(Math.max(parseInt(args.limit, 10) || 500, 1), 1000);
const MAX_PAGES = parseInt(args.maxpages, 10) || 5000; // strop pro jistotu

async function sisFetch(url) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch(url, { headers: { 'X-API-Key': API_KEY, 'Accept': 'application/json' }, signal: controller.signal });
    clearTimeout(to);
    if (!r.ok) return { error: 'HTTP ' + r.status };
    return { data: await r.json() };
  } catch (e) { clearTimeout(to); return { error: String(e.message || e) }; }
}

// Projde VŠECHNY transakce lokality a vrátí { first, last, count, successCount, sum, currency, complete }.
async function scanKiosk(code) {
  let first = null, last = null, count = 0, successCount = 0, sum = 0, currency = null, offset = 0, pages = 0, complete = false, total = null;
  while (pages < MAX_PAGES) {
    const url = TX_URL + '/' + encodeURIComponent(code) + '?limit=' + PAGE + '&offset=' + offset;
    const { data, error } = await sisFetch(url);
    if (error) return { code, error, first, last, count, successCount, sum, currency, complete };
    const txs = Array.isArray(data.transactions) ? data.transactions : [];
    if (typeof data.total === 'number') total = data.total;
    if (!txs.length) { complete = true; break; }
    for (const t of txs) {
      const ts = t.datetime ? new Date(t.datetime).getTime() : 0;
      if (ts) {
        if (first == null || ts < first) first = ts;
        if (last == null || ts > last) last = ts;
      }
      count++;
      if (String(t.status) === 'Successful') { successCount++; sum += Number(t.amount) || 0; if (!currency && t.currency) currency = t.currency; }
    }
    offset += txs.length; pages++;
    if (total != null && offset >= total) { complete = true; break; }
  }
  return { code, first, last, count, successCount, sum: Math.round(sum), currency, complete, pages, total };
}

function fmt(ts) { return ts ? new Date(ts).toISOString().slice(0, 10) : '—'; }

(async () => {
  if (!API_KEY) { console.error('❌ Chybí SIS_KIOSK_API_KEY (.env ani env). Spusť tam, kde je klíč.'); process.exit(1); }
  console.log('SIS kiosk-values:', VALUES_URL);
  console.log('SIS kiosk-transactions:', TX_URL);
  console.log('');

  const { data: vals, error: vErr } = await sisFetch(VALUES_URL);
  if (vErr) { console.error('❌ kiosk-values selhalo:', vErr); process.exit(1); }
  let kiosks = Array.isArray(vals.kiosks) ? vals.kiosks : [];
  console.log('── Hlavička kiosk-values ──');
  console.log('  generatedAt:', vals.generatedAt || '—', '| period:', JSON.stringify(vals.period) || '—', '| yearFrom:', vals.yearFrom || '—', '| valueCurrency:', vals.valueCurrency || '—');
  console.log('  počet lokalit:', kiosks.length);
  console.log('');

  if (ONLY_CODE) kiosks = kiosks.filter((k) => String(k.code) === String(ONLY_CODE));
  if (!kiosks.length) { console.error('Žádná lokalita ke zpracování.'); process.exit(1); }

  const rows = [];
  let globalFirst = null, globalLast = null;
  for (let i = 0; i < kiosks.length; i++) {
    const k = kiosks[i];
    process.stdout.write('  [' + (i + 1) + '/' + kiosks.length + '] ' + k.code + ' … ');
    const r = await scanKiosk(String(k.code));
    r.label = k.label || k.code;
    rows.push(r);
    if (r.first && (globalFirst == null || r.first < globalFirst)) globalFirst = r.first;
    if (r.last && (globalLast == null || r.last > globalLast)) globalLast = r.last;
    console.log(r.error ? ('CHYBA: ' + r.error) : ('první ' + fmt(r.first) + ' · poslední ' + fmt(r.last) + ' · tx ' + r.count + (r.complete ? '' : ' (nedokončeno!)')));
  }

  console.log('');
  console.log('── Souhrn ──');
  console.log('  Nejstarší datum napříč portfoliem:', fmt(globalFirst));
  console.log('  Nejnovější datum:', fmt(globalLast));
  const withData = rows.filter((r) => r.first).length;
  console.log('  Lokalit s transakcemi:', withData, '/', rows.length);
  const noData = rows.filter((r) => !r.first && !r.error);
  if (noData.length) console.log('  Bez transakcí (možná stará data mimo SIS):', noData.map((r) => r.code).join(', '));

  // Uložit JSON pro další zpracování (odvození data otevření = first tx).
  const outDir = path.join(__dirname, 'out');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { /* ok */ }
  const outPath = path.join(outDir, 'sis-oldest.json');
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    header: { generatedAt: vals.generatedAt, period: vals.period, yearFrom: vals.yearFrom, valueCurrency: vals.valueCurrency },
    globalFirst: fmt(globalFirst), globalLast: fmt(globalLast),
    kiosks: rows.map((r) => ({ code: r.code, label: r.label, firstTx: fmt(r.first), lastTx: fmt(r.last), txCount: r.count, successCount: r.successCount, sum: r.sum, currency: r.currency, complete: r.complete, error: r.error || null })),
  }, null, 2));
  console.log('  JSON uložen:', outPath);
})();
