// HolyOS — Handover ZIP builder (Fáze 10)
// Vyrobí měsíční ZIP pro účetní firmu:
//   /AP/         — PDF přijatých faktur
//   /AR/         — PDF vydaných faktur
//   invoices.csv — souhrn všech faktur (AP + AR)
//   cash.csv     — pokladní pohyby měsíce
//   bank.csv     — bankovní transakce měsíce (souhrn za výpisy)
//   manifest.json — metadata (period, counts, totals, generated_at)

'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { prisma } = require('../../config/database');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', '..', 'data', 'storage');
const HANDOVER_SUBDIR = 'accountant-handovers';

const NEVER_INCLUDED_INVOICE_STATUSES = ['cancelled', 'draft'];

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDateCs(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${pad2(x.getDate())}.${pad2(x.getMonth() + 1)}.${x.getFullYear()}`;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvLine(arr) {
  return arr.map(csvEscape).join(';');
}

/**
 * Hlavní funkce — vyrobí ZIP pro daný handover.
 * @param {number} handoverId
 * @returns {Promise<{ zip_path: string, size_bytes: number, document_count: number, totals: object }>}
 */
async function buildPackage(handoverId) {
  const handover = await prisma.accountantHandover.findUnique({ where: { id: handoverId } });
  if (!handover) throw new Error('Handover nenalezen');

  const month = handover.period_month;
  const year = handover.period_year;
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59); // poslední den měsíce

  // 1) Načti faktury (AP + AR) za měsíc
  const invoices = await prisma.invoice.findMany({
    where: {
      date_issued: { gte: from, lte: to },
      status: { notIn: NEVER_INCLUDED_INVOICE_STATUSES },
    },
    include: {
      company: { select: { id: true, name: true, ico: true, dic: true, country: true } },
      items: { select: { description: true, quantity: true, unit_price: true, vat_rate: true, total: true } },
    },
    orderBy: [{ direction: 'asc' }, { date_issued: 'asc' }, { invoice_number: 'asc' }],
  });

  // 2) Pokladní pohyby
  const cashMovements = await prisma.cashMovement.findMany({
    where: { date: { gte: from, lte: to } },
    include: {
      cash_register: { select: { name: true, currency: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  // 3) Bankovní výpisy + transakce
  const bankStatements = await prisma.bankStatement.findMany({
    where: {
      OR: [
        { period_from: { gte: from, lte: to } },
        { period_to: { gte: from, lte: to } },
      ],
    },
    include: {
      bank_account: { select: { name: true, account_number: true, bank_code: true } },
      _count: { select: { transactions: true } },
    },
    orderBy: { period_from: 'asc' },
  });

  const bankTransactions = await prisma.bankTransaction.findMany({
    where: { transaction_date: { gte: from, lte: to } },
    include: {
      bank_account: { select: { name: true, account_number: true } },
    },
    orderBy: [{ transaction_date: 'asc' }, { id: 'asc' }],
    take: 5000, // safety cap
  });

  // 4) Vytvoř ZIP soubor
  const handoverFolder = path.join(STORAGE_DIR, HANDOVER_SUBDIR);
  if (!fs.existsSync(handoverFolder)) fs.mkdirSync(handoverFolder, { recursive: true });
  const zipFilename = `handover-${year}-${pad2(month)}.zip`;
  const zipPath = path.join(handoverFolder, zipFilename);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const zipDone = new Promise((resolve, reject) => {
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  // ─── 4a) PDF faktury → /AP a /AR ────────────────────────────────────
  let pdfCount = 0;
  for (const inv of invoices) {
    const subdir = inv.direction === 'ap' ? 'AP' : 'AR';
    const filename = `${inv.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    if (inv.pdf_file_path && fs.existsSync(inv.pdf_file_path)) {
      archive.file(inv.pdf_file_path, { name: `${subdir}/${filename}` });
      pdfCount++;
    } else if (inv.source_file_path && fs.existsSync(inv.source_file_path)) {
      // fallback: scan/originál (pro AP, kde nemáme generovaný PDF)
      archive.file(inv.source_file_path, { name: `${subdir}/${filename}` });
      pdfCount++;
    }
  }

  // ─── 4b) invoices.csv ───────────────────────────────────────────────
  const invoicesCsv = [
    csvLine([
      'Směr', 'Číslo (interní)', 'Číslo externí', 'Datum vystavení', 'Datum splatnosti',
      'Firma IČO', 'Firma název', 'Stát', 'VS', 'Měna',
      'Subtotal', 'DPH', 'Celkem', 'Zaplaceno', 'Stav', 'Typ DPH režimu',
    ]),
    ...invoices.map(inv => csvLine([
      inv.direction === 'ap' ? 'Přijatá' : 'Vydaná',
      inv.invoice_number,
      inv.external_number || '',
      fmtDateCs(inv.date_issued),
      fmtDateCs(inv.date_due),
      inv.company?.ico || '',
      inv.company?.name || '',
      inv.company?.country || '',
      inv.variable_symbol || '',
      inv.currency,
      Number(inv.subtotal).toFixed(2),
      Number(inv.vat_amount).toFixed(2),
      Number(inv.total).toFixed(2),
      Number(inv.paid_amount).toFixed(2),
      inv.status,
      inv.vat_regime,
    ])),
  ].join('\n');
  archive.append(invoicesCsv, { name: 'invoices.csv' });

  // ─── 4c) cash.csv ───────────────────────────────────────────────────
  const cashCsv = [
    csvLine([
      'Datum', 'Doklad', 'Pokladna', 'Měna', 'Směr', 'Účel', 'Popis', 'Částka',
    ]),
    ...cashMovements.map(m => csvLine([
      fmtDateCs(m.date),
      m.document_number,
      m.cash_register?.name || '',
      m.cash_register?.currency || '',
      m.direction === 'in' ? 'Příjem' : 'Výdaj',
      m.purpose,
      m.description,
      Number(m.amount).toFixed(2),
    ])),
  ].join('\n');
  archive.append(cashCsv, { name: 'cash.csv' });

  // ─── 4d) bank.csv ───────────────────────────────────────────────────
  const bankCsv = [
    csvLine([
      'Datum', 'Účet', 'Číslo účtu', 'Směr', 'VS', 'KS', 'SS',
      'Protistrana název', 'Protistrana účet', 'Zpráva', 'Měna', 'Částka', 'Status párování',
    ]),
    ...bankTransactions.map(t => csvLine([
      fmtDateCs(t.transaction_date),
      t.bank_account?.name || '',
      t.bank_account?.account_number || '',
      t.direction === 'in' ? 'Příjem' : 'Výdaj',
      t.variable_symbol || '',
      t.constant_symbol || '',
      t.specific_symbol || '',
      t.counterparty_name || '',
      t.counterparty_account || '',
      t.message || '',
      t.currency,
      Number(t.amount).toFixed(2),
      t.match_status,
    ])),
  ].join('\n');
  archive.append(bankCsv, { name: 'bank.csv' });

  // ─── 4e) bank-statements.csv (souhrn za výpisy) ─────────────────────
  const bankStatementsCsv = [
    csvLine([
      'Číslo výpisu', 'Účet', 'Číslo účtu', 'Banka', 'Období od', 'Období do',
      'Otevírací zůstatek', 'Závěrečný zůstatek', 'Počet transakcí',
    ]),
    ...bankStatements.map(s => csvLine([
      s.statement_number,
      s.bank_account?.name || '',
      s.bank_account?.account_number || '',
      s.bank_account?.bank_code || '',
      fmtDateCs(s.period_from),
      fmtDateCs(s.period_to),
      Number(s.opening_balance).toFixed(2),
      Number(s.closing_balance).toFixed(2),
      s._count?.transactions || 0,
    ])),
  ].join('\n');
  archive.append(bankStatementsCsv, { name: 'bank-statements.csv' });

  // ─── 4f) manifest.json ──────────────────────────────────────────────
  const totals = {
    received: invoices.filter(i => i.direction === 'ap').reduce((s, i) => s + Number(i.total), 0),
    issued: invoices.filter(i => i.direction === 'ar').reduce((s, i) => s + Number(i.total), 0),
    cash_in: cashMovements.filter(m => m.direction === 'in').reduce((s, m) => s + Number(m.amount), 0),
    cash_out: cashMovements.filter(m => m.direction === 'out').reduce((s, m) => s + Number(m.amount), 0),
  };
  const manifest = {
    period: { year, month },
    generated_at: new Date().toISOString(),
    handover_id: handoverId,
    counts: {
      invoices_ap: invoices.filter(i => i.direction === 'ap').length,
      invoices_ar: invoices.filter(i => i.direction === 'ar').length,
      cash_movements: cashMovements.length,
      bank_transactions: bankTransactions.length,
      bank_statements: bankStatements.length,
      pdfs_included: pdfCount,
    },
    totals,
    files: ['invoices.csv', 'cash.csv', 'bank.csv', 'bank-statements.csv', 'manifest.json'],
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  // ─── 4g) README.txt — pro účetní firmu ──────────────────────────────
  const readme = [
    `HolyOS — Účetní balíček ${year}/${pad2(month)}`,
    `Vygenerováno: ${new Date().toLocaleString('cs-CZ')}`,
    ``,
    `OBSAH:`,
    `  /AP/                  PDF přijatých faktur`,
    `  /AR/                  PDF vydaných faktur`,
    `  invoices.csv          Souhrn všech faktur (AP + AR)`,
    `  cash.csv              Pokladní pohyby měsíce`,
    `  bank.csv              Bankovní transakce měsíce`,
    `  bank-statements.csv   Souhrn za bankovní výpisy`,
    `  manifest.json         Strojově čitelná metadata`,
    ``,
    `STATISTIKY:`,
    `  Přijaté faktury: ${invoices.filter(i => i.direction === 'ap').length}, celkem ${totals.received.toFixed(2)} Kč`,
    `  Vydané faktury: ${invoices.filter(i => i.direction === 'ar').length}, celkem ${totals.issued.toFixed(2)} Kč`,
    `  Pokladní příjmy: ${totals.cash_in.toFixed(2)} Kč`,
    `  Pokladní výdaje: ${totals.cash_out.toFixed(2)} Kč`,
    ``,
    `V případě otázek kontaktujte: Tomáš Holý (tomas.holy@bestseries.cz)`,
  ].join('\r\n');
  archive.append(readme, { name: 'README.txt' });

  archive.finalize();
  const sizeBytes = await zipDone;

  // 5) Update handover row
  await prisma.accountantHandover.update({
    where: { id: handoverId },
    data: {
      status: 'ready',
      zip_file_path: zipPath,
      document_count: pdfCount + cashMovements.length + bankTransactions.length,
      total_received: totals.received,
      total_issued: totals.issued,
      total_cash: totals.cash_out, // náklady — to účetní zajímá
    },
  });

  return { zip_path: zipPath, size_bytes: sizeBytes, manifest };
}

module.exports = { buildPackage };
