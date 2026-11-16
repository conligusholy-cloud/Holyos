// HolyOS — Parser PDF výpisu UniCredit Bank (BusinessNet Professional, e-mailová příloha „UniCredit Bank DD.MM.RRRR MT940.pdf")
// =============================================================================
// Nezaheslované PDF, jedna strana na den. Hlavička: Účet (maskovaný „18XXXXX000/CZK"), Číslo výpisu, Datum výpisu,
// Počáteční zůstatek, Položky kredit/debet, Konečný zůstatek. Tabulka transakcí podle souřadnice X:
//   x≈38 Valuta (datum) | x≈101 Detaily transakce (účet protistrany, KS/VS/SS, +IPE reference, zpráva)
//   x≈289 Detaily o protistraně (jméno; pod ním kód banky a číslo účtu) | x≈425 Částka | x≈530 Měna
// Výstup stejný jako ostatní parsery: { statement, transactions, warnings, format: 'unicredit_pdf', reconciled }
// =============================================================================
'use strict';

const path = require('path');

function loadPdfJs() {
  const p = path.join(path.dirname(require.resolve('pdf-parse/package.json')), 'lib', 'pdf.js', 'v2.0.550', 'build', 'pdf.js');
  const PDFJS = require(p);
  PDFJS.disableWorker = true;
  return PDFJS;
}
const RE_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const toDate = (s) => { const m = RE_DATE.exec(String(s || '').trim()); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
// „134.898,27" / „-160.000,00" → číslo
const toNum = (s) => { const t = String(s || '').replace(/\s|CZK|EUR/g, '').replace(/\./g, '').replace(',', '.'); if (!/^-?\d+(\.\d+)?$/.test(t)) return null; return Number(t); };
const cleanSym = (s) => { const t = String(s || '').replace(/\D/g, ''); if (!t || /^0+$/.test(t)) return null; return t.replace(/^0+/, ''); };
const cleanAcc = (a) => { const m = /^(\d{1,6})-(\d{1,10})\/(\d{4})$/.exec(String(a || '').trim()); if (!m) return String(a || '').trim() || null; const pre = m[1].replace(/^0+/, ''); return (pre ? pre + '-' : '') + m[2].replace(/^0+/, '') + '/' + m[3]; };

async function rowsOf(buffer) {
  const doc = await loadPdfJs().getDocument({ data: new Uint8Array(buffer) }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const byY = new Map();
    tc.items.forEach((it) => {
      const str = String(it.str || '').trim(); if (!str) return;
      const y = Math.round(it.transform[5]), x = Math.round(it.transform[4]);
      const k = [...byY.keys()].find((yy) => Math.abs(yy - y) <= 2) ?? y;
      if (!byY.has(k)) byY.set(k, []);
      byY.get(k).push({ x, s: str });
    });
    [...byY.keys()].sort((a, b) => b - a).forEach((y) => out.push({ page: p, y, cells: byY.get(y).sort((a, b) => a.x - b.x) }));
  }
  return out;
}
const col = (row, from, to) => row.cells.filter((c) => c.x >= from && c.x < to).map((c) => c.s).join(' ').trim();

function isUnicreditText(rows) {
  const t = rows.map((r) => r.cells.map((c) => c.s).join(' ')).join('\n');
  return /UniCredit Bank/i.test(t) && /Obsah výpisu/i.test(t) && /Detaily transakce/i.test(t);
}

async function parseUnicreditPdf(buffer) {
  const rows = await rowsOf(buffer);
  if (!isUnicreditText(rows)) { const e = new Error('Není to výpis UniCredit'); e.code = 'NOT_UNICREDIT'; throw e; }
  const warnings = [];
  const head = (label) => { const r = rows.find((x) => x.cells.some((c) => c.s.replace(/\s+/g, ' ') === label)); if (!r) return null; return r.cells.filter((c) => c.s.replace(/\s+/g, ' ') !== label).map((c) => c.s).join(' ').trim(); };

  const ucet = head('Účet:') || '';
  const mask = (/^([0-9X]{6,16})\s*\/\s*([A-Z]{3})/i.exec(ucet) || []);
  const datum = toDate(head('Datum výpisu:'));
  const cislo = String(head('Číslo výpisu:') || '').replace(/\D/g, '');
  const statement = {
    account_mask: mask[1] ? mask[1].toUpperCase() : null,     // „18XXXXX000" — páruje se podle masky
    account_number: mask[1] && !/X/i.test(mask[1]) ? mask[1].replace(/^0+/, '') : null,
    bank_code: '2700',
    currency: mask[2] ? mask[2].toUpperCase() : 'CZK',
    statement_number: (datum ? datum.getUTCFullYear() + '/' : '') + (cislo || (datum ? datum.toISOString().slice(0, 10) : 'neznamy')),
    period_from: datum, period_to: datum,
    opening_balance: toNum(head('Počáteční zůstatek:')),
    closing_balance: toNum(head('Konečný zůstatek:')),
    sum_credit: toNum(head('Položky kredit:')),
    sum_debit: toNum(head('Položky debet:')),
  };

  // Tabulka transakcí: od řádku záhlaví „Valuta / Detaily transakce" po patičku banky
  const hi = rows.findIndex((r) => r.cells.some((c) => /^Valuta$/i.test(c.s)) && r.cells.some((c) => /Detaily transakce/i.test(c.s)));
  const body = hi >= 0 ? rows.slice(hi + 1).filter((r) => !r.cells.some((c) => /UniCredit Bank Czech|Výpis z účtu,|Tato informace je nezávazná|Valuta|Detaily transakce/i.test(c.s))) : [];
  const tx = [];
  let cur = null;
  for (const r of body) {
    const d = col(r, 0, 95);
    if (RE_DATE.test(d)) {
      const amt = toNum(col(r, 400, 520));
      if (amt == null) { warnings.push('Řádek ' + d + ' bez částky — přeskočen'); cur = null; continue; }
      cur = { value_date: toDate(d), transaction_date: toDate(d), amount: Math.abs(amt), direction: amt < 0 ? 'out' : 'in', currency: col(r, 520, 700) || statement.currency,
        counterparty_account_full: null, counterparty_name: col(r, 280, 400) || null, constant_symbol: null, variable_symbol: null, specific_symbol: null, reference: null, _msg: [] };
      const acc = col(r, 95, 280);
      if (/^\d{1,6}-\d{1,10}\/\d{4}$/.test(acc)) cur.counterparty_account_full = cleanAcc(acc);
      else if (acc) cur._msg.push(acc);
      tx.push(cur);
      continue;
    }
    if (!cur) continue;
    const det = col(r, 95, 280), prot = col(r, 280, 400);
    let m;
    if ((m = /^KS\s+(\d+)$/.exec(det))) cur.constant_symbol = cleanSym(m[1]);
    else if ((m = /^VS\s+(\d+)$/.exec(det))) cur.variable_symbol = cleanSym(m[1]);
    else if ((m = /^SS\s+(\d+)$/.exec(det))) cur.specific_symbol = cleanSym(m[1]);
    else if ((m = /^\+IPE\s+(\S+)/.exec(det))) cur.reference = 'IPE' + m[1];
    else if (det) cur._msg.push(det);
    // Sloupec protistrany: kód banky (4 číslice) a číslo účtu — účet už máme z detailu; jiný text = jméno
    if (prot && !/^\d{4}$/.test(prot) && !/^\d{1,6}-\d{1,10}$/.test(prot)) cur.counterparty_name = [cur.counterparty_name, prot].filter(Boolean).join(' ');
  }
  // Zpráva: zalomené řádky spojit (bez mezery, když se slovo zalomilo uprostřed — „V" + „alašské" → „Valašské")
  tx.forEach((t) => {
    let msg = '';
    t._msg.forEach((p) => { msg = !msg ? p : (/[a-záčďéěíňóřšťúůýž]$/i.test(msg) && /^[a-záčďéěíňóřšťúůýž]/.test(p) ? msg + p : (/\s[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]$/.test(msg) ? msg + p : msg + ' ' + p)); });
    t.message = msg || null; delete t._msg;
  });

  // Kontrola úplnosti: součty kreditů a debetů i zůstatky musí přesně sedět
  const r2 = (n) => Math.round(n * 100) / 100;
  const kred = r2(tx.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount, 0));
  const deb = r2(tx.filter((t) => t.direction === 'out').reduce((s, t) => s + t.amount, 0));
  let reconciled = statement.opening_balance != null && statement.closing_balance != null;
  if (reconciled && Math.abs(r2(statement.opening_balance + kred - deb) - statement.closing_balance) > 0.005) reconciled = false;
  if (statement.sum_credit != null && Math.abs(kred - statement.sum_credit) > 0.005) reconciled = false;
  if (statement.sum_debit != null && Math.abs(deb - Math.abs(statement.sum_debit)) > 0.005) reconciled = false;
  if (!reconciled) warnings.push(`NESEDÍ: kredity ${kred} (výpis ${statement.sum_credit}), debety ${deb} (výpis ${statement.sum_debit}), zůstatky ${statement.opening_balance} → ${statement.closing_balance}.`);
  return { statement, transactions: tx, warnings, format: 'unicredit_pdf', reconciled, expected_count: null, balance_diff: r2((statement.closing_balance || 0) - ((statement.opening_balance || 0) + kred - deb)) };
}

module.exports = { parseUnicreditPdf, isUnicreditText };
