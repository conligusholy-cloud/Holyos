// HolyOS — Import bankovního výpisu z bufferu (sdílené pro e-mailový worker)
// Rozpozná formát (PDF MONETA / GPC / Fio CSV / MT940), najde bankovní účet podle čísla
// v hlavičce, založí BankStatement + BankTransaction a spustí automatické párování s fakturami.
'use strict';

const fs = require('fs');
const path = require('path');
const { prisma } = require('../../config/database');
const { parseStatement } = require('./parsers');
const { parseMonetaPdf, isPdf } = require('./parsers/moneta-pdf-parser');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', '..', 'data', 'storage');

// Hesla k PDF: BANK_STATEMENT_PASSWORD může obsahovat víc hesel oddělených čárkou/středníkem (heslo se časem mění),
// plus volitelně hesla předaná při ručním spuštění. Zkouší se postupně, dokud některé nesedí.
function passwordCandidates(extra) {
  const fromEnv = String(process.env.BANK_STATEMENT_PASSWORD || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return [...new Set([...(extra || []).map((s) => String(s).trim()).filter(Boolean), ...fromEnv, ''])];
}
async function parseAny(buffer, filename, extraPasswords) {
  if (isPdf(buffer)) {
    let lastErr = null;
    for (const pw of passwordCandidates(extraPasswords)) {
      try { return await parseMonetaPdf(buffer, { password: pw }); }
      catch (e) { lastErr = e; if (!/heslo nesed|password/i.test(String(e && e.message))) throw e; }
    }
    throw lastErr || new Error('PDF výpisu se nepodařilo otevřít');
  }
  return parseStatement(buffer, { filename });
}

async function findAccount(statement, fallbackId) {
  if (fallbackId) return prisma.bankAccount.findUnique({ where: { id: fallbackId } });
  const num = statement.account_number ? String(statement.account_number).replace(/^0+/, '') : null;
  const all = await prisma.bankAccount.findMany({ where: { active: true } });
  return all.find((a) => num && String(a.account_number).replace(/^0+/, '') === num && (!statement.bank_code || a.bank_code === statement.bank_code))
    || all.find((a) => statement.iban && a.iban && a.iban.replace(/\s+/g, '') === statement.iban)
    || null;
}

/**
 * @returns {Promise<{status:'imported'|'duplicate'|'no_account', statement_id?, inserted?, total?, matched?, warnings?, statement_number?}>}
 */
async function importStatementBuffer({ buffer, filename, bankAccountId = null, source = 'email', userId = null, autoMatch = true, passwords = null }) {
  const parsed = await parseAny(buffer, filename, passwords);
  const { statement, transactions, warnings, format } = parsed;
  const account = await findAccount(statement, bankAccountId);
  if (!account) return { status: 'no_account', statement_number: statement.statement_number, account_number: statement.account_number, bank_code: statement.bank_code };

  const existing = await prisma.bankStatement.findUnique({ where: { bank_account_id_statement_number: { bank_account_id: account.id, statement_number: String(statement.statement_number) } } }).catch(() => null);
  if (existing) return { status: 'duplicate', statement_id: existing.id, statement_number: statement.statement_number };

  // Originál výpisu uložit (pro audit / pozdější kontrolu)
  let filePath = null;
  try {
    const dir = path.join(STORAGE_DIR, 'bank-statements');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, Date.now() + '_' + String(filename || 'vypis').replace(/[^\w.-]+/g, '_'));
    fs.writeFileSync(filePath, buffer);
  } catch (e) { filePath = null; }

  const created = await prisma.$transaction(async (tx) => {
    const stmt = await tx.bankStatement.create({
      data: {
        bank_account_id: account.id,
        statement_number: String(statement.statement_number),
        period_from: statement.period_from || new Date(),
        period_to: statement.period_to || new Date(),
        opening_balance: statement.opening_balance || 0,
        closing_balance: statement.closing_balance || 0,
        source: (format === 'moneta_pdf' ? 'pdf_' : format + '_') + source,
        file_path: filePath,
        imported_by_id: userId,
      },
    });
    const data = transactions.map((t) => ({
      bank_account_id: account.id, statement_id: stmt.id,
      transaction_date: t.transaction_date || stmt.period_from, value_date: t.value_date || null,
      direction: t.direction === 'out' ? 'out' : 'in', amount: t.amount || 0, currency: t.currency || 'CZK',
      counterparty_account: t.counterparty_account_full || t.counterparty_account || null, counterparty_name: t.counterparty_name || null,
      variable_symbol: t.variable_symbol || null, constant_symbol: t.constant_symbol || null, specific_symbol: t.specific_symbol || null,
      message: t.message || null, reference: t.reference || `${stmt.id}-${Math.random().toString(36).slice(2, 10)}`, match_status: 'unmatched',
    }));
    const ins = await tx.bankTransaction.createMany({ data, skipDuplicates: true });
    if (!account.last_statement_date || new Date(stmt.period_to) >= new Date(account.last_statement_date)) {
      await tx.bankAccount.update({ where: { id: account.id }, data: { last_statement_date: stmt.period_to, current_balance: stmt.closing_balance } });
    }
    return { stmt, inserted: ins.count };
  });

  let matched = null;
  if (autoMatch) {
    try {
      const { autoMatchStatement } = require('./auto-matcher');
      const s = await autoMatchStatement(created.stmt.id, prisma, { id: userId, displayName: 'Automatický import výpisu' });
      matched = s;
    } catch (e) { console.warn('[statement-import] auto-match selhal:', e.message); }
  }
  try {
    const { logAudit } = require('../audit');
    await logAudit({ action: 'create', entity: 'bank_statement', entity_id: created.stmt.id, description: `Automaticky importován výpis č. ${created.stmt.statement_number} (${format}, ${created.inserted} transakcí)`, user: null });
  } catch (e) { /* audit nesmí shodit import */ }
  return { status: 'imported', statement_id: created.stmt.id, statement_number: created.stmt.statement_number, inserted: created.inserted, total: transactions.length, matched, warnings, account_id: account.id };
}

module.exports = { importStatementBuffer, parseAny };
