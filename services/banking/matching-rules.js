// HolyOS — MatchingRule engine
// =============================================================================
// Pravidla pro pre-zpracování bank transakcí před auto-matchem podle VS.
// Aplikují se v pořadí podle `priority` (vyšší dřív). První rule, jehož
// kritéria odpovídají transakci, se aplikuje.
//
// Akce:
//   - ignore                  → tx.match_status = 'ignored'
//   - auto_match_invoice      → rozšířený match (VS NEBO counterparty_account)
//   - auto_match_cost_center  → tx.match_status = 'matched' s flag cost_center,
//                                Payment bez Allocations (cost-center logika
//                                bude doimplementována ve Fázi 9)
//   - notify                  → tx.match_status = 'needs_review' + assignee
//
// Kritéria (všechna volitelná, kombinují se AND):
//   - direction               → 'in' / 'out'
//   - counterparty_account    → přesná shoda
//   - counterparty_name_contains → substring case-insensitive
//   - variable_symbol         → přesná shoda po normalizaci
//   - amount_min / amount_max → rozsah
// =============================================================================

'use strict';

const { normalizeVs, applyMatch } = require('./auto-matcher');

/**
 * Vyhodnotí, zda transakce odpovídá kritériím pravidla.
 *
 * @param {Object} tx     BankTransaction
 * @param {Object} rule   MatchingRule
 * @returns {boolean}
 */
function ruleMatches(tx, rule) {
  if (!rule.active) return false;

  if (rule.direction && rule.direction !== tx.direction) return false;

  if (rule.counterparty_account) {
    const ruleAcc = String(rule.counterparty_account).trim();
    const txAcc = String(tx.counterparty_account || '').trim();
    // Pokud pravidlo obsahuje "/" → striktní rovnost ("1234567890/0300").
    // Jinak porovnáme jen base část (bez kódu banky), protože transakce v DB
    // mají kvůli pos 74-77 fixu format "1234567890/0300".
    if (ruleAcc.includes('/')) {
      if (ruleAcc !== txAcc) return false;
    } else {
      const txBase = txAcc.split('/')[0];
      if (ruleAcc !== txBase) return false;
    }
  }

  if (rule.counterparty_name_contains) {
    const needle = String(rule.counterparty_name_contains).toLowerCase();
    const haystack = String(tx.counterparty_name || tx.message || '').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (rule.variable_symbol) {
    if (normalizeVs(rule.variable_symbol) !== normalizeVs(tx.variable_symbol)) return false;
  }

  const txAmount = Number(tx.amount);
  if (rule.amount_min !== null && rule.amount_min !== undefined) {
    if (txAmount < Number(rule.amount_min)) return false;
  }
  if (rule.amount_max !== null && rule.amount_max !== undefined) {
    if (txAmount > Number(rule.amount_max)) return false;
  }

  return true;
}

/**
 * Najde první aktivní pravidlo, které odpovídá transakci.
 * Pravidla se procházejí v pořadí: priority DESC, id ASC.
 *
 * @param {Object} tx          BankTransaction
 * @param {Object} prismaCtx   Prisma client
 * @returns {Promise<Object|null>}  Matching rule nebo null
 */
async function evaluateRules(tx, prismaCtx) {
  const rules = await prismaCtx.matchingRule.findMany({
    where: { active: true },
    orderBy: [{ priority: 'desc' }, { id: 'asc' }],
  });

  for (const rule of rules) {
    if (ruleMatches(tx, rule)) return rule;
  }
  return null;
}

/**
 * Aplikuje pravidlo na transakci.
 *
 * @param {Object} tx         BankTransaction
 * @param {Object} rule       MatchingRule
 * @param {Object} prismaCtx  Prisma client
 * @param {Object} userContext { id, displayName }
 * @returns {Promise<Object>} { action, status, payload }
 */
async function applyRule(tx, rule, prismaCtx, userContext) {
  switch (rule.action) {
    case 'ignore': {
      const updated = await prismaCtx.bankTransaction.update({
        where: { id: tx.id },
        data: {
          match_status: 'ignored',
          match_method: 'rule',
          match_rule_id: rule.id,
          resolved_by_id: userContext?.id || null,
          resolved_at: new Date(),
          note: `Auto-ignor pravidlem "${rule.name}"`,
        },
      });
      return { action: 'ignore', status: 'ignored', transaction: updated };
    }

    case 'notify': {
      const updated = await prismaCtx.bankTransaction.update({
        where: { id: tx.id },
        data: {
          match_status: 'needs_review',
          match_method: 'rule',
          match_rule_id: rule.id,
          note: rule.assignee_id
            ? `Pravidlo "${rule.name}" označilo k posouzení pro person_id=${rule.assignee_id}`
            : `Pravidlo "${rule.name}" označilo k posouzení`,
        },
      });
      return { action: 'notify', status: 'needs_review', transaction: updated };
    }

    case 'auto_match_invoice': {
      // Rozšířený match: stejně jako findMatchCandidates, ale dovolíme i match
      // přes counterparty_account (pokud rule definuje).
      // Implementace minimální — najdeme fakturu se stejným VS NEBO
      // counterparty_account (= partner_bank_account u faktury) a sedící částkou.
      const txAmount = Number(tx.amount);
      const txDirection = tx.direction === 'in' ? 'ar' : 'ap';
      const txVs = normalizeVs(tx.variable_symbol);

      const where = {
        direction: txDirection,
        status: { notIn: ['paid', 'cancelled', 'written_off', 'archived', 'draft'] },
        OR: [],
      };
      if (txVs) where.OR.push({ variable_symbol: { in: [tx.variable_symbol, txVs] } });
      if (tx.counterparty_account) where.OR.push({ partner_bank_account: tx.counterparty_account });
      if (where.OR.length === 0) delete where.OR;

      const candidates = await prismaCtx.invoice.findMany({
        where,
        select: {
          id: true, invoice_number: true, total: true, paid_amount: true,
          status: true, direction: true,
        },
      });
      const fitting = candidates.filter(inv => {
        const remaining = Number(inv.total) - Number(inv.paid_amount);
        return Math.abs(remaining - txAmount) <= 0.01;
      });

      if (fitting.length === 1) {
        const result = await applyMatch(
          tx,
          [{ invoice_id: fitting[0].id, amount: txAmount }],
          prismaCtx,
          userContext,
          'rule'
        );
        await prismaCtx.bankTransaction.update({
          where: { id: tx.id },
          data: { match_rule_id: rule.id },
        });
        return { action: 'auto_match_invoice', status: 'matched', transaction: result.transaction, payment: result.payment };
      }

      // Žádný nebo víc kandidátů — degradace na needs_review
      const updated = await prismaCtx.bankTransaction.update({
        where: { id: tx.id },
        data: {
          match_status: 'needs_review',
          match_method: 'rule',
          match_rule_id: rule.id,
          note: `Pravidlo "${rule.name}" → ${fitting.length} kandidátů, ruční výběr`,
        },
      });
      return { action: 'auto_match_invoice', status: 'needs_review', transaction: updated };
    }

    case 'auto_match_cost_center': {
      // V0.5: Pouze označení — Payment bez Allocations zatím nevytváříme.
      // Plná cost-center logika je naplánovaná ve Fázi 9.
      const updated = await prismaCtx.bankTransaction.update({
        where: { id: tx.id },
        data: {
          match_status: 'matched',
          match_method: 'rule',
          match_rule_id: rule.id,
          resolved_by_id: userContext?.id || null,
          resolved_at: new Date(),
          note: `Cost-center pravidlo "${rule.name}" (cost_center_id=${rule.cost_center_id || '?'}) — Payment ne­vytvořen, doimplementace ve Fázi 9`,
        },
      });
      return { action: 'auto_match_cost_center', status: 'matched', transaction: updated };
    }

    default:
      throw new Error(`Neznámá akce pravidla: ${rule.action}`);
  }
}

module.exports = {
  evaluateRules,
  applyRule,
  ruleMatches,
};
