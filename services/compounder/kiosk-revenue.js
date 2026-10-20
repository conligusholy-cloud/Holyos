// HolyOS — Obrat kiosku ze SIS pro servisní fakturaci (standalone, bez prisma).
// Počítá tržby předchozího uzavřeného měsíce (jen transakce status 'Successful').
// Volitelně jen za část měsíce (opts.from / opts.to, YYYY-MM-DD včetně) — začátek/konec smlouvy uprostřed měsíce.
'use strict';

function baseTxUrl() {
  return (process.env.SIS_KIOSK_TX_API_URL
    || (process.env.SIS_KIOSK_API_URL ? process.env.SIS_KIOSK_API_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions') : 'https://sis-test.infinitygrid.cloud/api/public/kiosk-transactions')
  ).replace(/\/$/, '');
}

// Pražský čas bez ohledu na časové pásmo serveru
function pragueOffsetMs(ts) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
function pragueMidnight(y, m, d) { // m = 0–11; půlnoc pražského dne jako UTC timestamp
  let ts = Date.UTC(y, m, d); ts -= pragueOffsetMs(ts); ts = Date.UTC(y, m, d) - pragueOffsetMs(ts);
  return ts;
}
function pragueYmd(date) { return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }); }
const ymdParts = (s) => { const a = String(s).slice(0, 10).split('-').map(Number); return { y: a[0], m: a[1] - 1, d: a[2] }; };

// Vrací { code, currency, prevMonth, prevMonthYm, prevMonthName, period_from, period_to, partial, days, month_days } pro předchozí kalendářní měsíc.
// prevMonth = obrat za fakturované období (celý měsíc, nebo jen jeho část podle opts.from / opts.to).
async function computePrevMonthRevenue(code, opts) {
  opts = opts || {};
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  if (!apiKey) { const e = new Error('SIS_NOT_CONFIGURED'); e.code = 'SIS_NOT_CONFIGURED'; throw e; }
  code = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) { const e = new Error('BAD_CODE'); e.code = 'BAD_CODE'; throw e; }
  const CZ_MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const today = ymdParts(pragueYmd(Date.now()));
  let pm = today.m - 1 < 0 ? 11 : today.m - 1; let py = today.m - 1 < 0 ? today.y - 1 : today.y;
  if (opts.ym && /^\d{4}-\d{2}$/.test(opts.ym)) { py = parseInt(opts.ym.slice(0, 4), 10); pm = parseInt(opts.ym.slice(5, 7), 10) - 1; } // libovolný měsíc místo předchozího
  const monthDays = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
  const prevMonthYm = py + '-' + String(pm + 1).padStart(2, '0');
  const monthFrom = prevMonthYm + '-01', monthTo = prevMonthYm + '-' + String(monthDays).padStart(2, '0');
  // Období = průnik měsíce a doby trvání smlouvy
  let from = monthFrom, to = monthTo;
  if (opts.from && String(opts.from).slice(0, 10) > from) from = String(opts.from).slice(0, 10);
  if (opts.to && String(opts.to).slice(0, 10) < to) to = String(opts.to).slice(0, 10);
  const empty = from > to; // smlouva v tomto měsíci vůbec neběžela
  const f = ymdParts(from), t = ymdParts(to);
  const startTs = pragueMidnight(f.y, f.m, f.d);
  const endTs = pragueMidnight(t.y, t.m, t.d) + 86400000; // konec dne `to` (exkluzivně)
  const monthStartTs = pragueMidnight(py, pm, 1);
  const base = baseTxUrl();
  const started = Date.now();
  let currency = null, sum = 0, offset = 0, pages = 0, total = 0, complete = false;
  while (pages < 200 && !empty) {
    if (Date.now() - started > 20000) break;
    const url = base + '/' + encodeURIComponent(code) + '?limit=200&offset=' + offset;
    const controller = new AbortController();
    const to2 = setTimeout(function () { controller.abort(); }, 12000);
    let r;
    try { r = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal }); }
    catch (e) { clearTimeout(to2); break; }
    clearTimeout(to2);
    if (!r.ok) break;
    const payload = await r.json().catch(function () { return {}; });
    const txs = Array.isArray(payload.transactions) ? payload.transactions : [];
    if (typeof payload.total === 'number') total = payload.total;
    if (!txs.length) { complete = true; break; }
    let allOlder = true;
    for (const tx of txs) {
      const ts = tx.datetime ? new Date(tx.datetime).getTime() : 0;
      if (ts && ts >= monthStartTs) allOlder = false;
      if (String(tx.status) !== 'Successful') continue;
      if (!currency && tx.currency) currency = tx.currency;
      if (ts >= startTs && ts < endTs) sum += Number(tx.amount) || 0;
    }
    offset += txs.length; pages++;
    if (allOlder) { complete = true; break; }
    if (total && offset >= total) { complete = true; break; }
  }
  const days = empty ? 0 : Math.round((Date.UTC(t.y, t.m, t.d) - Date.UTC(f.y, f.m, f.d)) / 86400000) + 1;
  const partial = !empty && (from !== monthFrom || to !== monthTo);
  const dm = (s) => { const p = ymdParts(s); return p.d + '. ' + (p.m + 1) + '.'; };
  const monthName = CZ_MONTHS[pm] + ' ' + py;
  return {
    code, currency: currency || 'CZK',
    prevMonth: Math.round(sum * 100) / 100,
    prevMonthYm, prevMonthName: monthName,
    period_from: from, period_to: to, partial, empty, days, month_days: monthDays,
    // popisek období: „září 2026" nebo „23.–30. 9. 2026 (část měsíce září 2026)"
    periodLabel: partial ? (ymdParts(from).m === ymdParts(to).m ? ymdParts(from).d + '.' : dm(from)) + '–' + dm(to) + ' ' + py + ' (část měsíce ' + monthName + ')' : monthName,
    complete,
  };
}

module.exports = { computePrevMonthRevenue };
