// HolyOS — Parser PDF výpisu MONETA Money Bank („Výpis z běžného účtu", e-mailová příloha STM_<IBAN>_<datum>_<č>.PDF)
// =============================================================================
// PDF bývá zaheslované (heslo z env BANK_STATEMENT_PASSWORD). Text se čte přes pdf.js
// přibalený v pdf-parse, řádky se skládají podle souřadnice Y a sloupce podle X:
//   x≈48  datum zpracování | x≈113 bankovní spojení / popis | x≈255 kód transakce / datum zaúčtování
//   x≈340–420 VS (1. ř.), KS (2. ř.), SS (3. ř.) | x≈420–495 debet | x≥495 kredit
// Výstup stejný jako ostatní parsery: { statement, transactions, warnings, format: 'moneta_pdf' }
// =============================================================================
'use strict';

const path = require('path');

function loadPdfJs() {
  // pdf-parse má přibalený pdf.js (v2.0.550 umí hesla); načítáme přímo, bez workeru
  const p = path.join(path.dirname(require.resolve('pdf-parse/package.json')), 'lib', 'pdf.js', 'v2.0.550', 'build', 'pdf.js');
  const PDFJS = require(p);
  PDFJS.disableWorker = true;
  return PDFJS;
}

const RE_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const toDate = (s) => { const m = RE_DATE.exec(String(s || '').trim()); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
const toNum = (s) => { const t = String(s || '').replace(/\s+/g, '').replace(/ /g, '').replace(',', '.'); const n = Number(t); return Number.isFinite(n) ? n : null; };
const RE_ACC = /^(\d{1,6}-)?\d{2,10}\/\d{4}$/;
const TYPES = /^(OKAMŽITÁ ÚHRADA|PŘÍKAZ K ÚHRADĚ|TRVALÝ PŘÍKAZ|INKASO|PLATBA KARTOU.*|VÝBĚR.*|VKLAD.*|POPLATEK.*|ÚROK.*|DAŇ.*|PŘEVOD.*|SIPO.*|SEPA.*|ZAHRANIČNÍ.*|PŘÍCHOZÍ.*|ODCHOZÍ.*|STORNO.*)$/i;
const cleanSym = (s) => { const t = String(s || '').replace(/\D/g, ''); if (!t || /^0+$/.test(t)) return null; return t.replace(/^0+/, ''); };

async function extractRows(buffer, password) {
  const PDFJS = loadPdfJs();
  let doc;
  try {
    doc = await PDFJS.getDocument({ data: new Uint8Array(buffer), password: password || undefined }).promise;
  } catch (e) {
    if (e && (e.name === 'PasswordException' || /password/i.test(e.message || ''))) throw new Error('PDF výpisu je zaheslované a heslo nesedí (nastav BANK_STATEMENT_PASSWORD).');
    throw e;
  }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    const rows = {};
    for (const it of tc.items) {
      const s = String(it.str || '').trim(); if (!s) continue;
      const y = Math.round(it.transform[5]);
      // drobné odchylky Y (±2) sloučit do jednoho řádku
      const key = Object.keys(rows).map(Number).find((k) => Math.abs(k - y) <= 2);
      (rows[key != null ? key : y] = rows[key != null ? key : y] || []).push({ x: it.transform[4], s });
    }
    const ys = Object.keys(rows).map(Number).sort((a, b) => b - a);
    pages.push(ys.map((y) => rows[y].sort((a, b) => a.x - b.x)));
  }
  return pages;
}

const cell = (row, x0, x1) => row.filter((c) => c.x >= x0 && c.x < x1).map((c) => c.s).join(' ').trim();
const after = (row, label) => { const i = row.findIndex((c) => c.s.replace(/\s+/g, ' ').startsWith(label)); return i >= 0 && row[i + 1] ? row[i + 1].s : null; };

async function parseMonetaPdf(buffer, opts = {}) {
  const pages = await extractRows(buffer, opts.password);
  const warnings = [];
  const all = [].concat(...pages);
  const findVal = (label) => { for (const r of all) { const v = after(r, label); if (v) return v; } return null; };

  const stmtNo = findVal('Číslo výpisu:');
  const stmtDate = toDate(findVal('Výpis ze dne:'));
  const prevDate = toDate(findVal('Předchozí výpis ze dne:'));
  const opening = toNum(findVal('Počáteční zůstatek:'));
  const closing = toNum(findVal('Konečný zůstatek:'));
  const accRaw = findVal('Bankovní spojení:'); // "221913663 / 0600"
  const ibanRaw = findVal('Číslo účtu IBAN:');
  const currency = (findVal('Označení měny:') || 'CZK').slice(0, 3);
  const accM = accRaw ? /([\d-]+)\s*\/\s*(\d{4})/.exec(accRaw) : null;
  if (!stmtNo) throw new Error('Nepodařilo se najít číslo výpisu — není to PDF výpis MONETA?');

  // Transakce: blok začíná řádkem s datem v 1. sloupci (x<100) a končí dalším blokem / součtem
  const tx = [];
  let cur = null;
  const flush = () => { if (cur) tx.push(cur); cur = null; };
  let inTable = false;
  for (const pageRows of pages) {
    for (const row of pageRows) {
      const first = row[0];
      const lineTxt = row.map((c) => c.s).join(' ');
      if (/^Přehled transakcí/.test(lineTxt) || /Datum\s+Bankovní spojení/.test(lineTxt)) { inTable = true; continue; }
      if (!inTable) continue;
      if (/^Celkový počet transakcí/.test(lineTxt) || /^Konečný zůstatek/.test(lineTxt.trim())) { flush(); inTable = false; continue; }
      if (/^(zpracování|Valuta)\b/.test(lineTxt) || /Počáteční zůstatek/.test(lineTxt)) continue;
      if (first && first.x < 100 && RE_DATE.test(first.s)) {
        flush();
        const debit = cell(row, 420, 495); const credit = cell(row, 495, 9999);
        const amtD = toNum(debit); const amtC = toNum(credit);
        const c113 = cell(row, 100, 250);
        cur = {
          transaction_date: toDate(first.s), value_date: null,
          direction: amtC != null && (amtD == null || amtD === 0) ? 'in' : 'out',
          amount: Math.abs(amtC != null && (amtD == null || amtD === 0) ? amtC : (amtD || 0)),
          currency, reference: cell(row, 250, 340) || null,
          variable_symbol: cleanSym(cell(row, 340, 420)),
          counterparty_account: RE_ACC.test(c113.replace(/\s+/g, '')) ? c113.replace(/\s+/g, '') : null,
          _type: RE_ACC.test(c113.replace(/\s+/g, '')) ? null : c113,
          _lines: [], _n: 1,
        };
        continue;
      }
      if (!cur) continue;
      cur._n++;
      const c113 = cell(row, 100, 250); const c255 = cell(row, 250, 340); const sym = cell(row, 340, 420);
      if (cur._n === 2) {
        if (c113) { if (TYPES.test(c113)) cur._type = cur._type || c113; else cur.counterparty_name = c113; }
        if (RE_DATE.test(c255)) cur.value_date = toDate(c255);
        cur.constant_symbol = cleanSym(sym);
      } else if (cur._n === 3) {
        if (c113) cur._lines.push(c113);
        cur.specific_symbol = cleanSym(sym);
      } else if (c113) {
        cur._lines.push(c113);
      }
    }
  }
  flush();

  const transactions = tx.map((t) => {
    const msg = []; let name = t.counterparty_name || null;
    for (const l of t._lines) {
      const m = /^AV:\s*(.*)$/.exec(l);
      if (m) { msg.push(m[1].trim()); continue; }
      msg.push(l.replace(/\s{2,}/g, ' ').trim());
    }
    if (t._type && /^PLATBA KARTOU/i.test(t._type) && name) msg.unshift('Platba kartou');
    else if (t._type) msg.unshift(t._type);
    const out = { ...t, counterparty_name: name, message: msg.filter(Boolean).join(' | ').slice(0, 1000) || null };
    delete out._lines; delete out._n; delete out._type;
    if (!out.reference) out.reference = 'moneta-' + (stmtNo || '') + '-' + Math.random().toString(36).slice(2, 10);
    return out;
  });

  // Kontrola součtů proti hlavičce
  const sumIn = transactions.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount, 0);
  const sumOut = transactions.filter((t) => t.direction === 'out').reduce((s, t) => s + t.amount, 0);
  if (opening != null && closing != null && Math.abs(opening + sumIn - sumOut - closing) > 0.02) {
    warnings.push(`Součet transakcí nesedí na zůstatky (počáteční ${opening} + ${sumIn.toFixed(2)} − ${sumOut.toFixed(2)} ≠ konečný ${closing}) — zkontroluj výpis.`);
  }

  return {
    statement: {
      statement_number: stmtNo, // "2026/203"
      account_number: accM ? accM[1].replace(/^0+/, '') : null,
      bank_code: accM ? accM[2] : null,
      iban: ibanRaw ? ibanRaw.replace(/\s+/g, '') : null,
      period_from: prevDate ? new Date(prevDate.getTime() + 86400000) : stmtDate,
      period_to: stmtDate,
      opening_balance: opening, closing_balance: closing, currency,
    },
    transactions,
    warnings,
    format: 'moneta_pdf',
  };
}

function isPdf(buffer) { return Buffer.isBuffer(buffer) && buffer.slice(0, 5).toString('latin1') === '%PDF-'; }

module.exports = { parseMonetaPdf, isPdf };
