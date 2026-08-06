// =============================================================================
// HolyOS — Měsíční tržby lokalit ze SIS (report pro studii Orlen)
// =============================================================================
// Stáhne CELOU historii transakcí ze SIS pro zadané lokality, sečte tržby po
// měsících, spočítá celkový obrat, počet transakcí, začátek/konec a rozpad
// praní/sušení. Vypíše přehled a uloží CSV (orlen_trzby_mesicne.csv).
//
// Spuštění (lokálně, SIS klíč z .env):
//   node scripts/orlen-revenue-report.js
//   node scripts/orlen-revenue-report.js "Průhonice" "Uherský Brod" "Poděbrady"
//   node scripts/orlen-revenue-report.js 00021CZ 2CTX        (lze i kódy)
// Když nezadáš argumenty, vezme Průhonice + Uherský Brod + Poděbrady.

'use strict';
const fs = require('fs');
const path = require('path');
try {
  const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  t.split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; });
} catch (e) { /* .env nemusí existovat */ }

const KEY = process.env.SIS_KIOSK_API_KEY;
const VALUES_URL = process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
const TX_URL = (process.env.SIS_KIOSK_TX_API_URL || VALUES_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions')).replace(/\/$/, '');

const args = process.argv.slice(2);
const targets = args.length ? args : ['Pruhonice', 'Uhersky Brod', 'Podebrady'];
// Porovnání bez ohledu na diakritiku (v SIS bývají názvy bez háčků/čárek).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function jget(url) {
  const r = await fetch(url, { headers: { 'X-API-Key': KEY, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' u ' + url);
  return r.json();
}
async function allTx(code) {
  let offset = 0, out = [], total = null, pages = 0;
  while (pages < 1000) {
    const p = await jget(TX_URL + '/' + encodeURIComponent(code) + '?limit=200&offset=' + offset);
    const txs = Array.isArray(p.transactions) ? p.transactions : [];
    if (typeof p.total === 'number') total = p.total;
    if (!txs.length) break;
    out = out.concat(txs); offset += txs.length; pages++;
    if (total != null && offset >= total) break;
  }
  return out;
}
function classify(tx) {
  const s = JSON.stringify(tx).toLowerCase();
  if (/wash|pra[čc]/.test(s)) return 'washer';
  if (/dry|su[šs]/.test(s)) return 'dryer';
  return 'other';
}
// Velikost pračky z popisu: vrátí 8 / 18 / null (18 kontrolujeme dřív než 8).
function washerKg(tx) {
  const s = String(tx.description || JSON.stringify(tx)).toLowerCase();
  const m = s.match(/(\d{1,2})\s*kg/);
  return m ? parseInt(m[1], 10) : null;
}
const money = (n) => Math.round(n).toLocaleString('cs-CZ') + ' Kč';

(async () => {
  if (!KEY) { console.error('Chybí SIS_KIOSK_API_KEY v .env — nelze číst SIS.'); process.exit(1); }
  console.log('SIS transakce z: ' + TX_URL + '\n');
  const kv = await jget(VALUES_URL);
  const kiosks = Array.isArray(kv.kiosks) ? kv.kiosks : [];
  const chosen = [];
  targets.forEach((tg) => {
    const direct = kiosks.find((k) => norm(k.code) === norm(tg));
    if (direct) { if (!chosen.find((c) => c.code === direct.code)) chosen.push(direct); return; }
    kiosks.filter((k) => norm(k.label).includes(norm(tg)) || norm(k.code).includes(norm(tg)))
      .forEach((f) => { if (!chosen.find((c) => c.code === f.code)) chosen.push(f); });
  });
  if (!chosen.length) { console.error('Nenašel jsem lokality: ' + targets.join(', ')); process.exit(1); }

  const report = {};
  for (const k of chosen) {
    process.stdout.write('Načítám ' + k.code + ' — ' + (k.label || '') + ' … ');
    let txs;
    try { txs = await allTx(k.code); } catch (e) { console.log('CHYBA: ' + e.message); continue; }
    console.log(txs.length + ' transakcí');
    if (txs[0]) console.log('   (pole transakce: ' + Object.keys(txs[0]).join(', ') + ')');
    const ok = txs.filter((t) => String(t.status) === 'Successful');
    const monthly = {}, monthlyWash = {}, monthlyCust = {}; let total = 0, first = null, last = null;
    const split = { washer: 0, dryer: 0, other: 0 }, splitCount = { washer: 0, dryer: 0, other: 0 };
    const wSize = { 8: 0, 18: 0, jiné: 0 }, wSizeAmt = { 8: 0, 18: 0, jiné: 0 };
    const events = []; // surové časy praní pro analýzu obsazenosti
    ok.forEach((t) => {
      const ts = t.datetime ? new Date(t.datetime) : null; if (!ts || isNaN(ts)) return;
      const amt = Number(t.amount) || 0; total += amt;
      const ym = ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0');
      monthly[ym] = (monthly[ym] || 0) + amt;
      if (!first || ts < first) first = ts; if (!last || ts > last) last = ts;
      const c = classify(t); split[c] += amt; splitCount[c]++;
      // Zákazník = každé praní (malé i velké) i každé sušení.
      if (c === 'washer' || c === 'dryer') monthlyCust[ym] = (monthlyCust[ym] || 0) + 1;
      if (c === 'washer') { monthlyWash[ym] = (monthlyWash[ym] || 0) + 1; const kg = washerKg(t); const key = (kg === 8 || kg === 18) ? kg : 'jiné'; wSize[key]++; wSizeAmt[key] += amt; events.push({ iso: ts.toISOString(), kind: c, kg: (kg === 8 || kg === 18) ? kg : '' }); }
    });
    report[k.code] = { label: k.label, total, count: ok.length, first, last, monthly, monthlyWash, monthlyCust, split, splitCount, wSize, wSizeAmt, events };
    console.log('   Období: ' + (first ? first.toISOString().slice(0, 10) : '—') + ' → ' + (last ? last.toISOString().slice(0, 10) : '—'));
    console.log('   Celkový obrat (úspěšné): ' + money(total) + '  (' + ok.length + ' transakcí)');
    console.log('   Praní ' + money(split.washer) + ' (' + splitCount.washer + '×) · Sušení ' + money(split.dryer) + ' (' + splitCount.dryer + '×)' + (split.other ? (' · Jiné ' + money(split.other)) : ''));
    const wc = splitCount.washer || 1;
    console.log('   Pračky: 8 kg ' + wSize[8] + '× (' + Math.round(wSize[8] / wc * 100) + ' %, ' + money(wSizeAmt[8]) + ') · 18 kg ' + wSize[18] + '× (' + Math.round(wSize[18] / wc * 100) + ' %, ' + money(wSizeAmt[18]) + ')' + (wSize['jiné'] ? (' · jiné ' + wSize['jiné'] + '×') : ''));
    console.log('   Měsíčně:');
    Object.keys(monthly).sort().forEach((ym) => console.log('     ' + ym + ': ' + money(monthly[ym])));
    console.log('');
  }

  const rows = [['code', 'label', 'month', 'revenue_czk', 'tx_washer_czk', 'tx_dryer_czk']];
  Object.keys(report).forEach((code) => {
    const r = report[code];
    Object.keys(r.monthly).sort().forEach((ym) => rows.push([code, '"' + String(r.label || '').replace(/"/g, '') + '"', ym, Math.round(r.monthly[ym]), '', '']));
  });
  const outp = path.join(__dirname, '..', 'orlen_trzby_mesicne.csv');
  fs.writeFileSync(outp, rows.map((r) => r.join(',')).join('\n'), 'utf8');

  // Rozpad praček 8 kg vs 18 kg per lokalita — do samostatného CSV (spolehlivé čtení).
  const prows = [['code', 'label', 'washer_total_count', 'w8_count', 'w8_czk', 'w18_count', 'w18_czk', 'w_other_count']];
  Object.keys(report).forEach((code) => {
    const r = report[code]; const w = r.wSize || {}, wa = r.wSizeAmt || {};
    prows.push([code, '"' + String(r.label || '').replace(/"/g, '') + '"', r.splitCount.washer, w[8] || 0, Math.round(wa[8] || 0), w[18] || 0, Math.round(wa[18] || 0), w['jiné'] || 0]);
  });
  const outp2 = path.join(__dirname, '..', 'orlen_pracky_8vs18.csv');
  fs.writeFileSync(outp2, prows.map((r) => r.join(',')).join('\n'), 'utf8');

  // Měsíční počet zákazníků (praní 8kg + 18kg dohromady) per lokalita — pro graf.
  const zrows = [['code', 'label', 'month', 'wash_count', 'customers']];
  Object.keys(report).forEach((code) => {
    const r = report[code]; const mw = r.monthlyWash || {}, mc = r.monthlyCust || {};
    Object.keys(mc).sort().forEach((ym) => zrows.push([code, '"' + String(r.label || '').replace(/"/g, '') + '"', ym, mw[ym] || 0, mc[ym]]));
  });
  const outp3 = path.join(__dirname, '..', 'orlen_zakaznici_mesicne.csv');
  fs.writeFileSync(outp3, zrows.map((r) => r.join(',')).join('\n'), 'utf8');

  // Surové časy praní (datetime + velikost) pro analýzu obsazenosti malé vs velké pračky.
  const erows = [['code', 'datetime', 'kind', 'kg']];
  Object.keys(report).forEach((code) => {
    (report[code].events || []).forEach((e) => erows.push([code, e.iso, e.kind, e.kg]));
  });
  const outp4 = path.join(__dirname, '..', 'orlen_transakce_raw.csv');
  fs.writeFileSync(outp4, erows.map((r) => r.join(',')).join('\n'), 'utf8');
  console.log('CSV uloženy:\n  ' + outp + '\n  ' + outp2 + '\n  ' + outp3 + '\n  ' + outp4 + '\nNemusíš nic kopírovat — přečtu si je ze složky.');
})().catch((e) => { console.error('Chyba:', e); process.exit(1); });
