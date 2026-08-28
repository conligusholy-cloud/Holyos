// HolyOS — vypíše tržby (vč. DPH) po měsících za posledních 12 UKONČENÝCH kalendářních měsíců
// pro danou lokalitu (do Přílohy č. 3 smlouvy). + celkový součet a průměr.
// Použití (lokálně, SIS klíč z .env):
//   node scripts/sis-monthly-revenue.js "Ostrov nad Ohří"
//   node scripts/sis-monthly-revenue.js --code=2SHU
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const out = {};
  try { fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach((line) => { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/); if (m) out[m[1]] = m[2].trim(); }); } catch (e) {}
  return out;
}
const env = loadEnv();
const API_KEY = process.env.SIS_KIOSK_API_KEY || env.SIS_KIOSK_API_KEY;
const VALUES_URL = (process.env.SIS_KIOSK_API_URL || env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values').replace(/\/$/, '');
const TX_URL = (process.env.SIS_KIOSK_TX_API_URL || env.SIS_KIOSK_TX_API_URL || VALUES_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions')).replace(/\/$/, '');
const CZ = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
const norm = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const argv = process.argv.slice(2); let CODE = null; const terms = [];
argv.forEach((a) => { const m = a.match(/^--code=(.*)$/); if (m) CODE = m[1]; else terms.push(a); });
const SEARCH = terms.join(' ').trim();
if (!API_KEY) { console.error('Chybí SIS_KIOSK_API_KEY.'); process.exit(1); }
if (!CODE && !SEARCH) { console.error('Zadej název: node scripts/sis-monthly-revenue.js "Ostrov nad Ohří"'); process.exit(1); }

async function sisFetch(url) {
  const c = new AbortController(); const to = setTimeout(() => c.abort(), 30000);
  try { const r = await fetch(url, { headers: { 'X-API-Key': API_KEY, 'Accept': 'application/json' }, signal: c.signal }); clearTimeout(to); if (!r.ok) return { error: 'HTTP ' + r.status }; return { data: await r.json() }; }
  catch (e) { clearTimeout(to); return { error: String(e.message || e) }; }
}
const money = (n) => Math.round(n).toLocaleString('cs-CZ') + ' Kč';

(async function () {
  let code = CODE, label = CODE || '';
  if (!code) {
    const { data, error } = await sisFetch(VALUES_URL);
    if (error) { console.error('kiosk-values: ' + error); process.exit(1); }
    const list = (data && (data.kiosks || data.locations || data.items)) || (Array.isArray(data) ? data : []);
    const nq = norm(SEARCH);
    const hit = list.find((k) => norm((k.label || '') + ' ' + (k.name || '') + ' ' + (k.companyName || '') + ' ' + (k.address || '')).indexOf(nq) !== -1);
    if (!hit) { console.error('Kiosk „' + SEARCH + '" nenalezen.'); process.exit(1); }
    code = hit.code; label = hit.label || hit.name || code;
  }
  // Posledních 12 UKONČENÝCH měsíců (bez aktuálního).
  const now = new Date();
  const keys = [];
  for (let i = 12; i >= 1; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
  const wanted = new Set(keys);
  const sums = {}; keys.forEach((k) => sums[k] = 0);

  let offset = 0, pages = 0, total = null;
  while (pages < 5000) {
    const { data, error } = await sisFetch(TX_URL + '/' + encodeURIComponent(code) + '?limit=500&offset=' + offset);
    if (error) { console.error('kiosk-transactions: ' + error); break; }
    const txs = Array.isArray(data.transactions) ? data.transactions : [];
    if (typeof data.total === 'number') total = data.total;
    if (!txs.length) break;
    for (const t of txs) {
      if (String(t.status) !== 'Successful') continue;
      const ts = t.datetime ? new Date(t.datetime) : null; if (!ts) continue;
      const ym = ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0');
      if (wanted.has(ym)) sums[ym] += (Number(t.amount) || 0);
    }
    offset += txs.length; pages++;
    if (total && offset >= total) break;
  }
  const first = keys[0].split('-'); const last = keys[keys.length - 1].split('-');
  console.log('\nLokalita: ' + label + ' (kód ' + code + ')');
  console.log('Období: ' + CZ[Number(first[1]) - 1] + ' ' + first[0] + ' – ' + CZ[Number(last[1]) - 1] + ' ' + last[0] + ' (vč. DPH)\n');
  let sum = 0;
  keys.slice().reverse().forEach((k) => { const p = k.split('-'); sum += sums[k]; console.log('  ' + (CZ[Number(p[1]) - 1] + ' ' + p[0]).padEnd(16) + money(sums[k])); });
  console.log('  ' + '-'.repeat(30));
  console.log('  ' + 'Celkem 12 měsíců'.padEnd(16) + money(sum));
  console.log('  ' + 'Průměr měsíčně'.padEnd(16) + money(sum / 12) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
