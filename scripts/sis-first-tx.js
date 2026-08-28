// HolyOS — najde kiosk podle názvu a vypíše PRVNÍ (nejstarší) transakci ze SIS.
// Použití (lokálně, SIS klíč z .env nebo env):
//   node scripts/sis-first-tx.js "Ostrov nad Ohří"
//   node scripts/sis-first-tx.js --code=2CTV
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    t.split(/\r?\n/).forEach((line) => { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/); if (m) out[m[1]] = m[2].trim(); });
  } catch (e) {}
  return out;
}
const env = loadEnv();
const API_KEY = process.env.SIS_KIOSK_API_KEY || env.SIS_KIOSK_API_KEY;
const VALUES_URL = (process.env.SIS_KIOSK_API_URL || env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values').replace(/\/$/, '');
const TX_URL = (process.env.SIS_KIOSK_TX_API_URL || env.SIS_KIOSK_TX_API_URL || VALUES_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions')).replace(/\/$/, '');

const argv = process.argv.slice(2);
let CODE = null; const terms = [];
argv.forEach((a) => { const m = a.match(/^--code=(.*)$/); if (m) CODE = m[1]; else terms.push(a); });
const SEARCH = terms.join(' ').trim();
const norm = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

if (!API_KEY) { console.error('Chybí SIS_KIOSK_API_KEY (v .env nebo env).'); process.exit(1); }
if (!CODE && !SEARCH) { console.error('Zadej název, např.: node scripts/sis-first-tx.js "Ostrov nad Ohří"'); process.exit(1); }

async function sisFetch(url) {
  const c = new AbortController(); const to = setTimeout(() => c.abort(), 30000);
  try { const r = await fetch(url, { headers: { 'X-API-Key': API_KEY, 'Accept': 'application/json' }, signal: c.signal }); clearTimeout(to); if (!r.ok) return { error: 'HTTP ' + r.status }; return { data: await r.json() }; }
  catch (e) { clearTimeout(to); return { error: String(e.message || e) }; }
}

(async function () {
  let code = CODE, label = CODE || '';
  if (!code) {
    const { data, error } = await sisFetch(VALUES_URL);
    if (error) { console.error('kiosk-values: ' + error); process.exit(1); }
    const list = (data && (data.kiosks || data.locations || data.items)) || (Array.isArray(data) ? data : []);
    const nq = norm(SEARCH);
    const hit = list.find((k) => norm((k.label || '') + ' ' + (k.name || '') + ' ' + (k.companyName || '') + ' ' + (k.address || '')).indexOf(nq) !== -1);
    if (!hit) { console.error('Kiosk „' + SEARCH + '" nenalezen v kiosk-values. Zkus jiný název nebo --code=.'); process.exit(1); }
    code = hit.code; label = hit.label || hit.name || code;
  }
  console.log('Kiosk: ' + label + ' (kód ' + code + ') — hledám nejstarší transakci…');
  let first = null, firstAmt = null, count = 0, offset = 0, pages = 0, total = null;
  while (pages < 5000) {
    const { data, error } = await sisFetch(TX_URL + '/' + encodeURIComponent(code) + '?limit=500&offset=' + offset);
    if (error) { console.error('kiosk-transactions: ' + error); break; }
    const txs = Array.isArray(data.transactions) ? data.transactions : [];
    if (typeof data.total === 'number') total = data.total;
    if (!txs.length) break;
    for (const t of txs) { const ts = t.datetime ? new Date(t.datetime).getTime() : 0; if (ts && (first == null || ts < first)) { first = ts; firstAmt = t.amount; } count++; }
    offset += txs.length; pages++;
    if (total && offset >= total) break;
  }
  if (first == null) { console.log('Žádné transakce nenalezeny.'); return; }
  console.log('První transakce: ' + new Date(first).toLocaleString('cs-CZ') + (firstAmt != null ? ('  (' + firstAmt + ')') : '') + '  · celkem transakcí: ' + count);
})().catch((e) => { console.error(e); process.exit(1); });
