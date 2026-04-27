// HolyOS — Bankovní účty (BankAccount CRUD) + výpisy + transakce
// Route prefix: /api/banking
// Pro UI: modules/banky/ + tab "K platbě" / "Banka" v modules/ucetni-doklady/

'use strict';

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit, diffObjects } = require('../services/audit');
const { parseAccount } = require('../services/banking/abo-kpc');
const { parseStatement } = require('../services/banking/parsers');
const matcher = require('../services/banking/auto-matcher');
const { buildDigest } = require('../services/digest');
const digestWorker = require('../services/digest-worker');

router.use(requireAuth);

// ────────────────────────────────────────────────────────────────────────────
// HELPERY
// ────────────────────────────────────────────────────────────────────────────

const BANK_LIST = ['FIO', 'CSOB', 'MONETA', 'UNICREDIT', 'KB', 'RB', 'OTHER'];
const BANK_LABEL = {
  FIO: 'Fio banka',
  CSOB: 'ČSOB',
  MONETA: 'Moneta Money Bank',
  UNICREDIT: 'UniCredit Bank',
  KB: 'Komerční banka',
  RB: 'Raiffeisenbank',
  OTHER: 'Jiná banka',
};
const BANK_CODE_MAP = {
  '2010': 'FIO',
  '0300': 'CSOB',
  '0600': 'MONETA',
  '2700': 'UNICREDIT',
  '0100': 'KB',
  '5500': 'RB',
};

const accountSchema = z.object({
  name: z.string().min(1).max(100),
  bank: z.enum(BANK_LIST),
  account_number: z.string().min(2).max(30),
  bank_code: z.string().regex(/^\d{4}$/, 'Kód banky musí být 4 číslice'),
  iban: z.string().max(34).optional().nullable(),
  bic: z.string().max(11).optional().nullable(),
  currency: z.string().length(3).default('CZK'),
  api_enabled: z.boolean().default(false),
  api_credentials_ref: z.string().max(255).optional().nullable(),
  active: z.boolean().default(true),
  opening_balance: z.number().default(0),
  note: z.string().optional().nullable(),
});
const accountUpdateSchema = accountSchema.partial();

function inferFromAccountString(input) {
  try {
    const parsed = parseAccount(input);
    return {
      account_number: parsed.prefix ? `${parsed.prefix}-${parsed.base}` : parsed.base,
      bank_code: parsed.bankCode,
      bank: BANK_CODE_MAP[parsed.bankCode] || 'OTHER',
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// BANK ACCOUNTS — LIST + DETAIL + CRUD
// ────────────────────────────────────────────────────────────────────────────

router.get('/accounts', async (req, res, next) => {
  try {
    const onlyActive = req.query.active === 'true';
    const where = onlyActive ? { active: true } : {};
    const accounts = await prisma.bankAccount.findMany({
      where,
      orderBy: [{ active: 'desc' }, { bank: 'asc' }, { name: 'asc' }],
    });
    res.json(accounts.map(a => ({ ...a, bank_label: BANK_LABEL[a.bank] || a.bank })));
  } catch (err) { next(err); }
});

router.get('/banks', (req, res) => {
  res.json(BANK_LIST.map(code => ({ code, label: BANK_LABEL[code] })));
});

router.get('/parse-account', (req, res) => {
  const input = String(req.query.input || '');
  const inferred = inferFromAccountString(input);
  if (!inferred) return res.status(400).json({ error: 'Neplatný formát čísla účtu' });
  res.json(inferred);
});

router.get('/accounts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const account = await prisma.bankAccount.findUnique({
      where: { id },
      include: {
        _count: { select: { payment_batches: true, transactions: true, statements: true } },
      },
    });
    if (!account) return res.status(404).json({ error: 'Účet nenalezen' });
    res.json({ ...account, bank_label: BANK_LABEL[account.bank] || account.bank });
  } catch (err) { next(err); }
});

router.post('/accounts', async (req, res, next) => {
  try {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const data = parsed.data;

    const existing = await prisma.bankAccount.findUnique({
      where: { account_number_bank_code: { account_number: data.account_number, bank_code: data.bank_code } },
    }).catch(() => null);
    if (existing) {
      return res.status(409).json({ error: 'Účet s tímto číslem a kódem banky už existuje', existing_id: existing.id });
    }

    const account = await prisma.bankAccount.create({
      data: {
        name: data.name,
        bank: data.bank,
        account_number: data.account_number,
        bank_code: data.bank_code,
        iban: data.iban || null,
        bic: data.bic || null,
        currency: data.currency,
        api_enabled: data.api_enabled,
        api_credentials_ref: data.api_credentials_ref || null,
        active: data.active,
        opening_balance: data.opening_balance,
        current_balance: data.opening_balance,
        note: data.note || null,
      },
    });

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'bank_account',
      entity_id: account.id,
      description: `Vytvořen bankovní účet ${account.name} (${account.account_number}/${account.bank_code})`,
      snapshot: account,
    });

    res.status(201).json(account);
  } catch (err) { next(err); }
});

router.put('/accounts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = accountUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const before = await prisma.bankAccount.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Účet nenalezen' });

    const account = await prisma.bankAccount.update({
      where: { id },
      data: parsed.data,
    });

    await logAudit({
      user: req.user,
      action: 'update',
      entity: 'bank_account',
      entity_id: id,
      description: `Upraven bankovní účet ${account.name}`,
      changes: diffObjects(before, account),
      snapshot: account,
    });

    res.json(account);
  } catch (err) { next(err); }
});

router.delete('/accounts/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const account = await prisma.bankAccount.findUnique({
      where: { id },
      include: { _count: { select: { payment_batches: true, transactions: true } } },
    });
    if (!account) return res.status(404).json({ error: 'Účet nenalezen' });

    if (account._count.payment_batches > 0 || account._count.transactions > 0) {
      await prisma.bankAccount.update({ where: { id }, data: { active: false } });
      return res.json({ ok: true, soft_deleted: true, reason: 'Účet má historii transakcí, byl pouze deaktivován' });
    }

    await prisma.bankAccount.delete({ where: { id } });
    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'bank_account',
      entity_id: id,
      description: `Smazán bankovní účet ${account.name}`,
      snapshot: account,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// BANKOVNÍ VÝPISY — IMPORT, LIST, DETAIL, DELETE
// POZOR: pevné podcesty (/upload) MUSÍ být NAD /:id (route-order gotcha)
// ────────────────────────────────────────────────────────────────────────────

const uploadStatementSchema = z.object({
  bank_account_id: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  format: z.enum(['gpc', 'fio_csv', 'mt940', 'auto']).default('auto'),
});

// POST /api/banking/statements/upload
router.post('/statements/upload', async (req, res, next) => {
  try {
    const parsed = uploadStatementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const { bank_account_id, filename, content_base64, format } = parsed.data;

    const account = await prisma.bankAccount.findUnique({ where: { id: bank_account_id } });
    if (!account) return res.status(404).json({ error: 'Bankovní účet nenalezen' });

    let buffer;
    try {
      buffer = Buffer.from(content_base64, 'base64');
    } catch {
      return res.status(400).json({ error: 'content_base64 není validní base64' });
    }
    if (buffer.length === 0) return res.status(400).json({ error: 'Soubor je prázdný' });
    if (buffer.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Soubor je větší než 10 MB' });

    let parseResult;
    try {
      parseResult = parseStatement(buffer, {
        filename,
        format: format === 'auto' ? undefined : format,
      });
    } catch (e) {
      return res.status(422).json({ error: 'Parser selhal: ' + e.message });
    }

    const { statement, transactions, warnings, format: detectedFormat } = parseResult;

    if (statement.account_number) {
      const expected = String(account.account_number).replace(/^0+/, '');
      const got = String(statement.account_number).replace(/^0+/, '');
      if (expected !== got) {
        warnings.push(
          `Číslo účtu v hlavičce výpisu (${statement.account_number}) ` +
          `neodpovídá zvolenému účtu (${account.account_number}) — pokračujeme, ale zkontroluj.`
        );
      }
    }

    const existing = await prisma.bankStatement.findUnique({
      where: {
        bank_account_id_statement_number: {
          bank_account_id,
          statement_number: String(statement.statement_number),
        },
      },
    }).catch(() => null);
    if (existing) {
      return res.status(409).json({
        error: `Výpis č. ${statement.statement_number} pro tento účet už existuje (id ${existing.id})`,
        existing_id: existing.id,
      });
    }

    const sourceMap = { gpc: 'gpc_upload', fio_csv: 'csv_upload', mt940: 'mt940_upload' };
    const created = await prisma.$transaction(async tx => {
      const stmt = await tx.bankStatement.create({
        data: {
          bank_account_id,
          statement_number: String(statement.statement_number),
          period_from: statement.period_from || new Date(),
          period_to: statement.period_to || new Date(),
          opening_balance: statement.opening_balance || 0,
          closing_balance: statement.closing_balance || 0,
          source: sourceMap[detectedFormat] || 'gpc_upload',
          file_path: null,
          imported_by_id: req.user?.id || null,
        },
      });

      const txData = transactions.map(t => ({
        bank_account_id,
        statement_id: stmt.id,
        transaction_date: t.transaction_date || stmt.period_from,
        value_date: t.value_date || null,
        direction: t.direction === 'in' || t.direction === 'out' ? t.direction : 'in',
        amount: t.amount || 0,
        currency: t.currency || 'CZK',
        counterparty_account: t.counterparty_account_full || t.counterparty_account || null,
        counterparty_name: t.counterparty_name || null,
        variable_symbol: t.variable_symbol || null,
        constant_symbol: t.constant_symbol || null,
        specific_symbol: t.specific_symbol || null,
        message: t.message || null,
        reference: t.reference || `${stmt.id}-${Math.random().toString(36).slice(2, 10)}`,
        match_status: 'unmatched',
      }));

      const inserted = await tx.bankTransaction.createMany({
        data: txData,
        skipDuplicates: true,
      });

      await tx.bankAccount.update({
        where: { id: bank_account_id },
        data: {
          last_statement_date: stmt.period_to,
          current_balance: stmt.closing_balance,
        },
      });

      return { statement: stmt, inserted_count: inserted.count };
    });

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'bank_statement',
      entity_id: created.statement.id,
      description: `Importován výpis č. ${created.statement.statement_number} pro účet ${account.name} (${detectedFormat}, ${created.inserted_count} transakcí)`,
      snapshot: { statement: created.statement, format: detectedFormat },
    });

    res.status(201).json({
      ok: true,
      statement: created.statement,
      transaction_count: created.inserted_count,
      total_parsed: transactions.length,
      duplicates_skipped: transactions.length - created.inserted_count,
      format: detectedFormat,
      warnings,
    });
  } catch (err) { next(err); }
});

// GET /api/banking/statements — list
router.get('/statements', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.bank_account_id) {
      where.bank_account_id = parseInt(req.query.bank_account_id, 10);
    }
    if (req.query.from) where.period_to = { gte: new Date(req.query.from) };
    if (req.query.to) {
      where.period_from = { ...(where.period_from || {}), lte: new Date(req.query.to) };
    }

    const statements = await prisma.bankStatement.findMany({
      where,
      include: {
        bank_account: { select: { id: true, name: true, bank: true, account_number: true, bank_code: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: { period_to: 'desc' },
      take: 200,
    });
    res.json(statements);
  } catch (err) { next(err); }
});

// GET /api/banking/statements/:id — detail s transakcemi (NAD :id už nic není)
router.get('/statements/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const statement = await prisma.bankStatement.findUnique({
      where: { id },
      include: {
        bank_account: true,
        transactions: { orderBy: { transaction_date: 'asc' } },
      },
    });
    if (!statement) return res.status(404).json({ error: 'Výpis nenalezen' });
    res.json(statement);
  } catch (err) { next(err); }
});

router.delete('/statements/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const force = req.query.force === 'true' || req.query.force === '1';
    const isSuperAdmin = !!req.user?.isSuperAdmin;

    const statement = await prisma.bankStatement.findUnique({
      where: { id },
      include: {
        bank_account: { select: { name: true } },
        _count: { select: { transactions: true } },
        transactions: {
          where: { match_status: { in: ['matched', 'ignored'] } },
          select: { id: true, match_status: true },
        },
      },
    });
    if (!statement) return res.status(404).json({ error: 'Výpis nenalezen' });

    const matchedTxs = statement.transactions.filter(t => t.match_status === 'matched');
    const ignoredTxs = statement.transactions.filter(t => t.match_status === 'ignored');
    const blockedCount = matchedTxs.length + ignoredTxs.length;

    if (blockedCount > 0) {
      // Force-delete je dostupný jen super-adminovi.
      if (!force || !isSuperAdmin) {
        return res.status(409).json({
          error: `Výpis nelze smazat — ${blockedCount} transakcí už je spárovaných nebo označených k ignorování. Nejdřív je uvolni.`,
          matched_count: matchedTxs.length,
          ignored_count: ignoredTxs.length,
          can_force: isSuperAdmin, // UI to využije pro nabídku „Smazat i přesto"
        });
      }

      // Force path — odpárovat všechny matched (vrátí paid_amount, smaže Payment+Allocations)
      // a u ignored jen reset match_status na unmatched.
      for (const tx of matchedTxs) {
        try {
          await matcher.unmatchTransaction(tx.id, prisma, req.user);
        } catch (err) {
          console.error(`[banking] Force-unmatch transakce ${tx.id} selhal:`, err.message);
          return res.status(500).json({
            error: `Nepodařilo se odpárovat transakci ${tx.id}: ${err.message}. Některé transakce už mohly být odpárovány.`,
          });
        }
      }
      if (ignoredTxs.length > 0) {
        await prisma.bankTransaction.updateMany({
          where: { id: { in: ignoredTxs.map(t => t.id) } },
          data: {
            match_status: 'unmatched',
            match_method: null,
            resolved_by_id: null,
            resolved_at: null,
            note: null,
          },
        });
      }
    }

    await prisma.$transaction([
      prisma.bankTransaction.deleteMany({ where: { statement_id: id } }),
      prisma.bankStatement.delete({ where: { id } }),
    ]);

    const forceNote = blockedCount > 0
      ? ` [FORCE: odpárováno ${matchedTxs.length} matched + ${ignoredTxs.length} ignored]`
      : '';
    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'bank_statement',
      entity_id: id,
      description: `Smazán výpis č. ${statement.statement_number} (${statement.bank_account.name}, ${statement._count.transactions} transakcí)${forceNote}`,
      snapshot: statement,
    });

    res.json({
      ok: true,
      forced: blockedCount > 0,
      unmatched_count: matchedTxs.length,
      ignored_reset_count: ignoredTxs.length,
    });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// BANKOVNÍ TRANSAKCE — LIST + DETAIL
// ────────────────────────────────────────────────────────────────────────────

router.get('/transactions', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.bank_account_id) where.bank_account_id = parseInt(req.query.bank_account_id, 10);
    if (req.query.statement_id) where.statement_id = parseInt(req.query.statement_id, 10);
    if (req.query.match_status) where.match_status = String(req.query.match_status);
    if (req.query.direction) where.direction = String(req.query.direction);
    if (req.query.from || req.query.to) {
      where.transaction_date = {};
      if (req.query.from) where.transaction_date.gte = new Date(req.query.from);
      if (req.query.to) where.transaction_date.lte = new Date(req.query.to);
    }
    if (req.query.search) {
      const q = String(req.query.search);
      where.OR = [
        { counterparty_name: { contains: q, mode: 'insensitive' } },
        { counterparty_account: { contains: q } },
        { variable_symbol: { contains: q } },
        { message: { contains: q, mode: 'insensitive' } },
      ];
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    const transactions = await prisma.bankTransaction.findMany({
      where,
      include: {
        bank_account: { select: { id: true, name: true, bank: true } },
        match_rule: { select: { id: true, name: true } },
        payment: {
          include: {
            allocations: { include: { invoice: { select: { id: true, invoice_number: true } } } },
          },
        },
      },
      orderBy: { transaction_date: 'desc' },
      take: limit,
    });
    res.json(transactions);
  } catch (err) { next(err); }
});

router.get('/transactions/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const tx = await prisma.bankTransaction.findUnique({
      where: { id },
      include: {
        bank_account: true,
        statement: true,
        match_rule: true,
        payment: { include: { allocations: { include: { invoice: true } } } },
      },
    });
    if (!tx) return res.status(404).json({ error: 'Transakce nenalezena' });
    res.json(tx);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// AUTO-MATCH / MATCH / UNMATCH / IGNORE — Fáze 5b
// ────────────────────────────────────────────────────────────────────────────

// POST /api/banking/statements/:id/auto-match — spustí auto-match pro celý výpis
router.post('/statements/:id/auto-match', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const stmt = await prisma.bankStatement.findUnique({ where: { id } });
    if (!stmt) return res.status(404).json({ error: 'Výpis nenalezen' });

    const opts = {
      amount_tolerance: Number(req.body?.amount_tolerance) || 0,
      allow_partial: !!req.body?.allow_partial,
    };

    // Pozor: autoMatchStatement používá více DB volání s writes; pro jednoduchost
    // používáme prisma client (bez interaktivní transakce). Každá tx se zapíše atomicky
    // přes applyMatch, který interně dělá několik writes — pokud spadne, transakce
    // zůstane unmatched a může se opakovat.
    const summary = await matcher.autoMatchStatement(id, prisma, req.user, opts);

    await logAudit({
      user: req.user,
      action: 'auto_match',
      entity: 'bank_statement',
      entity_id: id,
      description: `Auto-match výpisu ${stmt.statement_number}: ${summary.matched} spárováno, ${summary.needs_review} k posouzení, ${summary.no_match} bez kandidáta`,
      snapshot: summary,
    });

    res.json(summary);
  } catch (err) { next(err); }
});

// GET /api/banking/transactions/:id/match-candidates — pro manuální výběr v UI
router.get('/transactions/:id/match-candidates', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const tx = await prisma.bankTransaction.findUnique({ where: { id } });
    if (!tx) return res.status(404).json({ error: 'Transakce nenalezena' });

    const result = await matcher.findMatchCandidates(tx, prisma, {
      amount_tolerance: Number(req.query.tolerance) || 0,
      allow_partial: req.query.allow_partial === 'true',
    });

    res.json({
      transaction: {
        id: tx.id,
        amount: tx.amount,
        direction: tx.direction,
        variable_symbol: tx.variable_symbol,
        counterparty_name: tx.counterparty_name,
        counterparty_account: tx.counterparty_account,
      },
      decision: result.decision,
      candidates: result.candidates,
      reason: result.reason,
    });
  } catch (err) { next(err); }
});

// POST /api/banking/transactions/:id/match — manuální párování
// body: { allocations: [{ invoice_id, amount }] }  nebo  { invoice_id }
router.post('/transactions/:id/match', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const tx = await prisma.bankTransaction.findUnique({ where: { id } });
    if (!tx) return res.status(404).json({ error: 'Transakce nenalezena' });
    if (tx.match_status === 'matched') {
      return res.status(409).json({ error: 'Transakce už je spárovaná, nejdřív ji odpoj.' });
    }

    // Akceptujeme dvě varianty body:
    //   { invoice_id: 42 }                          → 1:1 alokace na celou tx částku
    //   { allocations: [{ invoice_id, amount }] }   → split
    let allocations;
    if (Array.isArray(req.body?.allocations)) {
      allocations = req.body.allocations;
    } else if (req.body?.invoice_id) {
      allocations = [{ invoice_id: parseInt(req.body.invoice_id, 10), amount: Number(tx.amount) }];
    } else {
      return res.status(400).json({ error: 'Chybí invoice_id nebo allocations' });
    }

    const result = await prisma.$transaction(async dbTx => {
      return matcher.applyMatch(tx, allocations, dbTx, req.user, 'manual');
    });

    await logAudit({
      user: req.user,
      action: 'match',
      entity: 'bank_transaction',
      entity_id: id,
      description: `Spárováno s ${allocations.length} fakturou(ami), Payment #${result.payment.id}`,
      snapshot: { allocations, payment_id: result.payment.id },
    });

    res.json(result);
  } catch (err) {
    // Klientské chyby (validace) → 400, ostatní 500
    if (err.message?.includes('applyMatch:') || err.message?.includes('Faktura')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/banking/transactions/:id/unmatch — zrušení matche
router.post('/transactions/:id/unmatch', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const result = await prisma.$transaction(async dbTx => {
      return matcher.unmatchTransaction(id, dbTx, req.user);
    });

    await logAudit({
      user: req.user,
      action: 'unmatch',
      entity: 'bank_transaction',
      entity_id: id,
      description: `Spárování zrušeno`,
      snapshot: { transaction_id: id },
    });

    res.json(result);
  } catch (err) {
    if (err.message?.includes('Transakce')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/banking/transactions/:id/ignore — označit "ignorováno"
router.post('/transactions/:id/ignore', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    const result = await matcher.ignoreTransaction(id, prisma, req.user, note);

    await logAudit({
      user: req.user,
      action: 'ignore',
      entity: 'bank_transaction',
      entity_id: id,
      description: `Označeno jako ignorováno${note ? ': ' + note : ''}`,
      snapshot: { transaction_id: id, note },
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// MATCHING RULES — CRUD (Fáze 5c)
// ────────────────────────────────────────────────────────────────────────────

const ruleSchema = z.object({
  name: z.string().min(1).max(255),
  priority: z.number().int().default(100),
  active: z.boolean().default(true),
  // Kritéria
  direction: z.enum(['in', 'out']).optional().nullable(),
  counterparty_account: z.string().max(50).optional().nullable(),
  counterparty_name_contains: z.string().max(255).optional().nullable(),
  variable_symbol: z.string().max(20).optional().nullable(),
  amount_min: z.number().optional().nullable(),
  amount_max: z.number().optional().nullable(),
  // Akce
  action: z.enum(['ignore', 'auto_match_invoice', 'auto_match_cost_center', 'notify']),
  cost_center_id: z.number().int().optional().nullable(),
  assignee_id: z.number().int().optional().nullable(),
});
const ruleUpdateSchema = ruleSchema.partial();

// GET /api/banking/matching-rules — list (volitelně active=true)
router.get('/matching-rules', async (req, res, next) => {
  try {
    const onlyActive = req.query.active === 'true';
    const rules = await prisma.matchingRule.findMany({
      where: onlyActive ? { active: true } : {},
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    res.json(rules);
  } catch (err) { next(err); }
});

// GET /api/banking/matching-rules/:id — detail
router.get('/matching-rules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const rule = await prisma.matchingRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ error: 'Pravidlo nenalezeno' });
    res.json(rule);
  } catch (err) { next(err); }
});

// POST /api/banking/matching-rules — vytvoření
router.post('/matching-rules', async (req, res, next) => {
  try {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const rule = await prisma.matchingRule.create({ data: parsed.data });
    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'matching_rule',
      entity_id: rule.id,
      description: `Vytvořeno pravidlo "${rule.name}" (akce: ${rule.action})`,
      snapshot: rule,
    });
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

// PUT /api/banking/matching-rules/:id — úprava
router.put('/matching-rules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const parsed = ruleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const before = await prisma.matchingRule.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Pravidlo nenalezeno' });

    const rule = await prisma.matchingRule.update({ where: { id }, data: parsed.data });
    await logAudit({
      user: req.user,
      action: 'update',
      entity: 'matching_rule',
      entity_id: id,
      description: `Upraveno pravidlo "${rule.name}"`,
      changes: diffObjects(before, rule),
      snapshot: rule,
    });
    res.json(rule);
  } catch (err) { next(err); }
});

// DELETE /api/banking/matching-rules/:id — smazání
router.delete('/matching-rules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const rule = await prisma.matchingRule.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });
    if (!rule) return res.status(404).json({ error: 'Pravidlo nenalezeno' });

    if (rule._count.transactions > 0) {
      // Místo hard delete jen deaktivovat
      await prisma.matchingRule.update({ where: { id }, data: { active: false } });
      return res.json({ ok: true, soft_deleted: true, reason: `Pravidlo bylo aplikováno na ${rule._count.transactions} transakcí, deaktivováno místo smazání` });
    }

    await prisma.matchingRule.delete({ where: { id } });
    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'matching_rule',
      entity_id: id,
      description: `Smazáno pravidlo "${rule.name}"`,
      snapshot: rule,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// DIGEST — preview, manuální spuštění, status workeru (Fáze 5d)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/banking/digest/preview — vrátí JSON i text body pro debug
router.get('/digest/preview', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
    const digest = await buildDigest(prisma, { days });
    res.json(digest);
  } catch (err) { next(err); }
});

// POST /api/banking/digest/send-now — manuální spuštění digest workeru
router.post('/digest/send-now', async (req, res, next) => {
  try {
    const result = await digestWorker.triggerNow();
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/banking/digest/status — stav workeru
router.get('/digest/status', (req, res) => {
  res.json(digestWorker.status());
});

module.exports = router;
