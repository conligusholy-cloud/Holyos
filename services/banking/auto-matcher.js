// HolyOS — Auto-matcher pro bankovní transakce ↔ faktury
// =============================================================================
// Pro každou unmatched BankTransaction zkusí najít odpovídající Invoice podle:
//   - direction kompatibility (in tx → AR invoice, out tx → AP invoice)
//   - VS shody (po normalizaci = odstranění leading zeros)
//   - amount kompatibility (paid_amount + tx.amount <= invoice.total + tolerance)
//   - status: faktura není ve stavu paid/cancelled/written_off/archived/draft
//
// Decision tree:
//   0 candidates                        → no_match (tx zůstává unmatched)
//   1 candidate, amount přesně sedí     → auto_match (1 click)
//   1 candidate, amount blízko, allow   → auto_match s warning
//   1 candidate, amount nesedí          → needs_review (manuální výběr)
//   2+ candidates                       → needs_review
//
// Funkce neperformují DB writes — vrací rozhodnutí a caller (route handler)
// pak udělá Payment + PaymentAllocation v transakci.
// =============================================================================

'use strict';

// Stavy faktur, které jsou kandidáti k zaplacení
const PAYABLE_INVOICE_STATUSES_AP = ['ready_to_pay', 'payment_queued', 'approved'];
const PAYABLE_INVOICE_STATUSES_AR = ['issued', 'sent', 'reminder_1_sent', 'reminder_2_sent', 'reminder_3_sent', 'overdue'];

const NEVER_PAYABLE = ['paid', 'cancelled', 'written_off', 'archived', 'draft'];

/** Normalizace VS — odstranění leading zeros, vrátí pouze cifry. */
function normalizeVs(vs) {
  if (!vs) return '';
  return String(vs).replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * Najde candidate faktury pro bankovní transakci.
 *
 * @param {Object} tx                 BankTransaction (id, direction, amount, variable_symbol, transaction_date)
 * @param {Object} prismaCtx          Prisma client nebo transaction tx
 * @param {Object} [opts]
 * @param {number} [opts.amount_tolerance=0]   tolerance v Kč pro fuzzy match
 * @param {boolean} [opts.allow_partial=false] povolit, aby se transakce alokovala jako částečná platba
 * @returns {Promise<Object>} { decision, candidates, reason }
 *   decision: 'auto_match' | 'needs_review' | 'no_match'
 *   candidates: Array<Invoice>
 *   reason: string
 */
async function findMatchCandidates(tx, prismaCtx, opts = {}) {
  const tolerance = opts.amount_tolerance || 0;
  const allowPartial = !!opts.allow_partial;

  const txDirection = tx.direction === 'in' ? 'in' : 'out';
  const invoiceDirection = txDirection === 'in' ? 'ar' : 'ap';
  const txAmount = Number(tx.amount);
  const txVs = normalizeVs(tx.variable_symbol);

  // Bez VS nemůžeme spolehlivě párovat (kromě budoucích MatchingRule pravidel)
  if (!txVs) {
    return {
      decision: 'no_match',
      candidates: [],
      reason: 'Transakce nemá variabilní symbol — nelze auto-párovat (zkus MatchingRule).',
    };
  }

  // Najdi všechny nezaplacené faktury s odpovídajícím VS a směrem
  const candidates = await prismaCtx.invoice.findMany({
    where: {
      direction: invoiceDirection,
      variable_symbol: { not: null },
      status: { notIn: NEVER_PAYABLE },
    },
    select: {
      id: true,
      invoice_number: true,
      external_number: true,
      direction: true,
      status: true,
      total: true,
      paid_amount: true,
      variable_symbol: true,
      date_due: true,
      company: { select: { id: true, name: true, ico: true } },
    },
  });

  // Filtr na VS match (po normalizaci)
  const vsMatched = candidates.filter(inv => normalizeVs(inv.variable_symbol) === txVs);

  if (vsMatched.length === 0) {
    return {
      decision: 'no_match',
      candidates: [],
      reason: `Žádná otevřená faktura s VS=${txVs} a směrem ${invoiceDirection}.`,
    };
  }

  // Najdi candidate, kde se částka vejde
  const fittingCandidates = vsMatched.filter(inv => {
    const remaining = Number(inv.total) - Number(inv.paid_amount);
    if (allowPartial) {
      // Stačí, aby remaining > 0
      return remaining > -tolerance;
    }
    // Striktní: částka tx <= remaining + tolerance
    return txAmount <= remaining + tolerance;
  });

  if (fittingCandidates.length === 0) {
    return {
      decision: 'needs_review',
      candidates: vsMatched,
      reason: `VS=${txVs} odpovídá ${vsMatched.length} faktur(ám), ale částka ${txAmount} Kč se do žádné nevejde.`,
    };
  }

  // Najdi candidate s přesnou shodou částky (= remaining)
  const exactMatch = fittingCandidates.filter(inv => {
    const remaining = Number(inv.total) - Number(inv.paid_amount);
    return Math.abs(remaining - txAmount) <= tolerance;
  });

  if (exactMatch.length === 1) {
    return {
      decision: 'auto_match',
      candidates: exactMatch,
      reason: `VS=${txVs}, částka přesně sedí na fakturu ${exactMatch[0].invoice_number}.`,
    };
  }

  if (exactMatch.length > 1) {
    return {
      decision: 'needs_review',
      candidates: exactMatch,
      reason: `${exactMatch.length} faktur s VS=${txVs} a stejnou částkou — potřebuje ruční výběr.`,
    };
  }

  // Nikoli přesná shoda, ale fituje (částečná platba)
  if (fittingCandidates.length === 1 && allowPartial) {
    return {
      decision: 'auto_match',
      candidates: fittingCandidates,
      reason: `VS=${txVs}, částečná platba na fakturu ${fittingCandidates[0].invoice_number}.`,
    };
  }

  return {
    decision: 'needs_review',
    candidates: fittingCandidates,
    reason: `${fittingCandidates.length} faktur s VS=${txVs} se vejde — potřebuje ruční výběr.`,
  };
}

/**
 * Provede auto-match na všechny unmatched transakce zadaného výpisu.
 *
 * @param {number} statementId
 * @param {Object} prismaCtx Prisma client (pozor: každá transakce se spojí
 *                          v subransakci pro atomičnost zápisu Payment+Allocation)
 * @param {Object} userContext { id: ?, displayName: ? }
 * @param {Object} [opts]    {  amount_tolerance, allow_partial }
 * @returns {Promise<Object>} summary { total, matched, needs_review, no_match, errors }
 */
async function autoMatchStatement(statementId, prismaCtx, userContext, opts = {}) {
  // Lazy import — vyhne se cyklické závislosti (rules importuje auto-matcher)
  const { evaluateRules, applyRule } = require('./matching-rules');

  const transactions = await prismaCtx.bankTransaction.findMany({
    where: {
      statement_id: statementId,
      match_status: 'unmatched',
    },
  });

  const summary = {
    total: transactions.length,
    matched: 0,
    needs_review: 0,
    no_match: 0,
    rule_ignored: 0,
    rule_matched: 0,
    errors: [],
    matched_ids: [],
    review_ids: [],
    ignored_ids: [],
  };

  for (const tx of transactions) {
    try {
      // 1) Nejdřív zkusíme pravidla (priorita > klasický VS match)
      const rule = await evaluateRules(tx, prismaCtx);
      if (rule) {
        const ruleResult = await applyRule(tx, rule, prismaCtx, userContext);
        if (ruleResult.status === 'ignored') {
          summary.rule_ignored++;
          summary.ignored_ids.push(tx.id);
        } else if (ruleResult.status === 'matched') {
          summary.rule_matched++;
          summary.matched++;
          summary.matched_ids.push(tx.id);
        } else if (ruleResult.status === 'needs_review') {
          summary.needs_review++;
          summary.review_ids.push(tx.id);
        }
        continue;
      }

      // 2) Klasický VS+amount match
      const result = await findMatchCandidates(tx, prismaCtx, opts);

      if (result.decision === 'auto_match') {
        const candidate = result.candidates[0];
        await applyMatch(tx, [{ invoice_id: candidate.id, amount: Number(tx.amount) }], prismaCtx, userContext, 'vs+amount');
        summary.matched++;
        summary.matched_ids.push(tx.id);
      } else if (result.decision === 'needs_review') {
        await prismaCtx.bankTransaction.update({
          where: { id: tx.id },
          data: { match_status: 'needs_review' },
        });
        summary.needs_review++;
        summary.review_ids.push(tx.id);
      } else {
        summary.no_match++;
      }
    } catch (e) {
      summary.errors.push({ tx_id: tx.id, error: e.message });
    }
  }

  return summary;
}

/**
 * Aplikuje match: vytvoří Payment + PaymentAllocation pro 1 nebo více faktur,
 * aktualizuje Invoice.paid_amount + status, označí transakci jako matched.
 *
 * @param {Object} tx                    BankTransaction (musí mít: id, direction, amount, currency, counterparty_*, variable_symbol, ...)
 * @param {Array}  allocations           [{ invoice_id, amount }] — součet musí = tx.amount
 * @param {Object} prismaCtx             Prisma client (volat z $transaction!)
 * @param {Object} userContext           { id, displayName }
 * @param {string} matchMethod           'vs+amount' | 'manual' | 'rule'
 * @returns {Promise<Object>} { payment, updated_invoices, transaction }
 */
async function applyMatch(tx, allocations, prismaCtx, userContext, matchMethod = 'manual') {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error('applyMatch: žádné alokace');
  }
  const totalAlloc = allocations.reduce((s, a) => s + Number(a.amount), 0);
  const txAmount = Number(tx.amount);
  if (Math.abs(totalAlloc - txAmount) > 0.01) {
    throw new Error(`applyMatch: součet alokací (${totalAlloc}) neodpovídá částce transakce (${txAmount})`);
  }

  // Validace faktur — musí existovat a nesmí být ve stavu paid
  const invoiceIds = allocations.map(a => a.invoice_id);
  const invoices = await prismaCtx.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, total: true, paid_amount: true, status: true, direction: true, invoice_number: true },
  });
  if (invoices.length !== invoiceIds.length) {
    throw new Error(`applyMatch: některé faktury nenalezeny (${invoiceIds.length - invoices.length} chybí)`);
  }
  for (const inv of invoices) {
    if (NEVER_PAYABLE.includes(inv.status)) {
      throw new Error(`applyMatch: faktura ${inv.invoice_number} je ve stavu "${inv.status}", nelze přiřadit platbu`);
    }
  }

  // Direction validace: in tx + ap invoice = nelze
  const txDirection = tx.direction === 'in' ? 'in' : 'out';
  for (const inv of invoices) {
    const expectedTxDir = inv.direction === 'ar' ? 'in' : 'out';
    if (expectedTxDir !== txDirection) {
      throw new Error(`applyMatch: směr transakce (${txDirection}) neodpovídá směru faktury ${inv.invoice_number} (${inv.direction})`);
    }
  }

  // Vytvoř Payment
  const partnerName = tx.counterparty_name
    || (invoices[0] ? `Faktura ${invoices[0].invoice_number}` : 'Bankovní transakce');

  const payment = await prismaCtx.payment.create({
    data: {
      direction: txDirection === 'in' ? 'in' : 'out',
      method: 'bank_transfer',
      bank_transaction_id: tx.id,
      amount: txAmount,
      currency: tx.currency || 'CZK',
      amount_czk: txAmount, // FIXME: přepočet kurzem pro non-CZK
      partner_name: String(partnerName).slice(0, 255),
      partner_account: tx.counterparty_account || null,
      variable_symbol: tx.variable_symbol || null,
      constant_symbol: tx.constant_symbol || null,
      specific_symbol: tx.specific_symbol || null,
      message: tx.message ? String(tx.message).slice(0, 140) : null,
      executed_date: tx.transaction_date,
      status: 'executed',
    },
  });

  // Vytvoř PaymentAllocations
  for (const a of allocations) {
    await prismaCtx.paymentAllocation.create({
      data: {
        payment_id: payment.id,
        invoice_id: a.invoice_id,
        amount: Number(a.amount),
        note: matchMethod === 'manual' ? 'Ruční párování' : null,
      },
    });
  }

  // Update faktur — paid_amount + status
  const updatedInvoices = [];
  for (const a of allocations) {
    const inv = invoices.find(i => i.id === a.invoice_id);
    const newPaid = Number(inv.paid_amount) + Number(a.amount);
    const total = Number(inv.total);
    let newStatus = inv.status;

    // Pokud zaplaceno >= total → status `paid`
    if (newPaid + 0.01 >= total) {
      newStatus = 'paid';
    }

    const updated = await prismaCtx.invoice.update({
      where: { id: inv.id },
      data: {
        paid_amount: newPaid,
        status: newStatus,
      },
    });
    updatedInvoices.push(updated);
  }

  // Update transakce
  const updatedTx = await prismaCtx.bankTransaction.update({
    where: { id: tx.id },
    data: {
      match_status: 'matched',
      match_method: matchMethod,
      resolved_by_id: userContext?.id || null,
      resolved_at: new Date(),
    },
  });

  return { payment, updated_invoices: updatedInvoices, transaction: updatedTx };
}

/**
 * Vrátí transakci do stavu unmatched: smaže Payment + Allocations, sníží
 * Invoice.paid_amount, případně vrátí status z `paid` zpět.
 */
async function unmatchTransaction(transactionId, prismaCtx, userContext) {
  const tx = await prismaCtx.bankTransaction.findUnique({
    where: { id: transactionId },
    include: { payment: { include: { allocations: { include: { invoice: true } } } } },
  });
  if (!tx) throw new Error('Transakce nenalezena');
  if (tx.match_status !== 'matched') {
    throw new Error(`Transakce není ve stavu matched (${tx.match_status})`);
  }
  if (!tx.payment) {
    // Pokud match_status='matched' ale Payment chybí, jen reset stavu
    return prismaCtx.bankTransaction.update({
      where: { id: transactionId },
      data: { match_status: 'unmatched', match_method: null, resolved_by_id: null, resolved_at: null },
    });
  }

  // Vrať invoice.paid_amount
  for (const alloc of tx.payment.allocations) {
    const newPaid = Number(alloc.invoice.paid_amount) - Number(alloc.amount);
    let newStatus = alloc.invoice.status;
    // Pokud byl `paid` ale po vrácení zase ne, navrať na rozumný stav
    if (alloc.invoice.status === 'paid' && newPaid < Number(alloc.invoice.total)) {
      newStatus = alloc.invoice.direction === 'ap' ? 'ready_to_pay' : 'sent';
    }
    await prismaCtx.invoice.update({
      where: { id: alloc.invoice_id },
      data: { paid_amount: newPaid < 0 ? 0 : newPaid, status: newStatus },
    });
  }

  // Smaž Allocations a Payment
  await prismaCtx.paymentAllocation.deleteMany({ where: { payment_id: tx.payment.id } });
  await prismaCtx.payment.delete({ where: { id: tx.payment.id } });

  // Reset transakce
  return prismaCtx.bankTransaction.update({
    where: { id: transactionId },
    data: {
      match_status: 'unmatched',
      match_method: null,
      resolved_by_id: null,
      resolved_at: null,
    },
  });
}

/**
 * Označí transakci jako "ignored" — uživatel ji nechce párovat
 * (např. interní převod, bankovní úroky, poplatky).
 */
async function ignoreTransaction(transactionId, prismaCtx, userContext, note) {
  return prismaCtx.bankTransaction.update({
    where: { id: transactionId },
    data: {
      match_status: 'ignored',
      match_method: 'manual',
      resolved_by_id: userContext?.id || null,
      resolved_at: new Date(),
      note: note || null,
    },
  });
}

module.exports = {
  findMatchCandidates,
  autoMatchStatement,
  applyMatch,
  unmatchTransaction,
  ignoreTransaction,
  normalizeVs,
  PAYABLE_INVOICE_STATUSES_AP,
  PAYABLE_INVOICE_STATUSES_AR,
  NEVER_PAYABLE,
};
