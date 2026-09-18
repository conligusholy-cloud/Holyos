// HolyOS — Obrat kiosku ze SIS pro servisní fakturaci (standalone, bez prisma).
// Počítá tržby předchozího uzavřeného měsíce (jen transakce status 'Successful').
'use strict';

function baseTxUrl() {
  return (process.env.SIS_KIOSK_TX_API_URL
    || (process.env.SIS_KIOSK_API_URL ? process.env.SIS_KIOSK_API_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions') : 'https://sis-test.infinitygrid.cloud/api/public/kiosk-transactions')
  ).replace(/\/$/, '');
}

// Vrací { code, currency, prevMonth, prevMonthYm, prevMonthName } pro předchozí kalendářní měsíc.
async function computePrevMonthRevenue(code) {
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  if (!apiKey) { const e = new Error('SIS_NOT_CONFIGURED'); e.code = 'SIS_NOT_CONFIGURED'; throw e; }
  code = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) { const e = new Error('BAD_CODE'); e.code = 'BAD_CODE'; throw e; }
  const CZ_MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const nowD = new Date();
  const startThisMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
  const startPrevMonth = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime();
  const prevD = new Date(startPrevMonth);
  const prevMonthYm = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  const base = baseTxUrl();
  const started = Date.now();
  let currency = null, sum = 0, offset = 0, pages = 0, total = 0, complete = false;
  while (pages < 200) {
    if (Date.now() - started > 20000) break;
    const url = base + '/' + encodeURIComponent(code) + '?limit=200&offset=' + offset;
    const controller = new AbortController();
    const to = setTimeout(function () { controller.abort(); }, 12000);
    let r;
    try { r = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal }); }
    catch (e) { clearTimeout(to); break; }
    clearTimeout(to);
    if (!r.ok) break;
    const payload = await r.json().catch(function () { return {}; });
    const txs = Array.isArray(payload.transactions) ? payload.transactions : [];
    if (typeof payload.total === 'number') total = payload.total;
    if (!txs.length) { complete = true; break; }
    let allOlder = true;
    for (const t of txs) {
      const ts = t.datetime ? new Date(t.datetime).getTime() : 0;
      if (ts && ts >= startPrevMonth) allOlder = false;
      if (String(t.status) !== 'Successful') continue;
      if (!currency && t.currency) currency = t.currency;
      if (ts >= startPrevMonth && ts < startThisMonth) sum += Number(t.amount) || 0;
    }
    offset += txs.length; pages++;
    if (allOlder) { complete = true; break; }
    if (total && offset >= total) { complete = true; break; }
  }
  return {
    code, currency: currency || 'CZK',
    prevMonth: Math.round(sum * 100) / 100,
    prevMonthYm, prevMonthName: CZ_MONTHS[prevD.getMonth()] + ' ' + prevD.getFullYear(),
    complete,
  };
}

module.exports = { computePrevMonthRevenue };
