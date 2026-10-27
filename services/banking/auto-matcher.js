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

// ─── Párování: VS + číslo účtu + částka (vč. částečných úhrad) ─────────────────
// Příjem → vydané faktury (AR), výdaj → přijaté faktury (AP).
// Kandidát = otevřená faktura (ne paid/cancelled/written_off/archived), stejná měna, zbývá doplatit > 0.
// Rozhodnutí:
//   1) VS sedí + částka = zbývá doplatit (právě 1)            → auto_match (plná úhrada)
//   2) účet protistrany sedí + částka = zbývá doplatit (1)    → auto_match
//   3) VS sedí jen u 1 faktury, platba < zbývá doplatit,
//      účet sedí nebo ho neznáme                               → auto_match (ČÁSTEČNÁ úhrada → partially_paid)
//   4) VS sedí, ale částka nesedí / víc kandidátů              → needs_review
//   5) jinak                                                   → no_match
const CLOSED_STATUSES = ['paid', 'cancelled', 'written_off', 'archived'];

/** Normalizace čísla účtu na tvar "prefix-cislo/banka" bez úvodních nul (IBAN CZ → tuzemský formát). */
function normalizeAccount(acc) {
  if (!acc) return '';
  let s = String(acc).replace(/\s+/g, '').toUpperCase();
  const iban = s.match(/^CZ\d{2}(\d{4})(\d{6})(\d{10})$/);
  if (iban) s = (iban[2].replace(/^0+/, '') ? iban[2] + '-' : '') + iban[3] + '/' + iban[1];
  const m = s.match(/^(?:(\d+)-)?(\d+)\/(\d{4})$/);
  if (!m) return s.replace(/^0+/, '');
  const pre = (m[1] || '').replace(/^0+/, '');
  const num = m[2].replace(/^0+/, '');
  return (pre ? pre + '-' : '') + num + '/' + m[3];
}
/** Účet bez kódu banky (pro porovnání, když jedna strana kód nemá). */
const accountBase = (n) => String(n || '').split('/')[0];
function accountsEqual(a, b) {
  const x = normalizeAccount(a), y = normalizeAccount(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (!x.includes('/') || !y.includes('/')) return accountBase(x) === accountBase(y);
  return false;
}

const INVOICE_SELECT = {
  id: true, invoice_number: true, external_number: true, direction: true, status: true,
  total: true, paid_amount: true, currency: true, variable_symbol: true, date_due: true,
  partner_bank_account: true, partner_iban: true,
  company: { select: { id: true, name: true, ico: true, bank_account: true, verified_bank_accounts: true } },
};

/** Načte otevřené faktury (pro dávkové párování se volá jednou). */
async function loadOpenInvoices(prismaCtx, direction) {
  const where = { status: { notIn: CLOSED_STATUSES } };
  if (direction) where.direction = direction;
  return prismaCtx.invoice.findMany({ where, select: INVOICE_SELECT });
}

/** Všechny známé účty protistrany k faktuře (AP: účet z faktury + účty firmy; AR: účty zákazníka). */
function invoiceAccounts(inv) {
  const out = [];
  if (inv.direction === 'ap') { if (inv.partner_bank_account) out.push(inv.partner_bank_account); if (inv.partner_iban) out.push(inv.partner_iban); }
  const c = inv.company || {};
  if (c.bank_account) out.push(c.bank_account);
  if (Array.isArray(c.verified_bank_accounts)) c.verified_bank_accounts.forEach((v) => { if (v && v.account) out.push(v.account); if (v && v.iban) out.push(v.iban); });
  return out;
}

function scoreCandidates(tx, invoices) {
  const txAmount = Number(tx.amount);
  const txVs = normalizeVs(tx.variable_symbol);
  const txCur = tx.currency || 'CZK';
  const invDir = tx.direction === 'in' ? 'ar' : 'ap';
  const list = [];
  for (const inv of invoices) {
    if (inv.direction !== invDir) continue;
    if (CLOSED_STATUSES.includes(inv.status)) continue;
    if ((inv.currency || 'CZK') !== txCur) continue;
    const remaining = Math.round((Number(inv.total) - Number(inv.paid_amount || 0)) * 100) / 100;
    if (remaining <= 0.009) continue;
    const vsOk = !!txVs && normalizeVs(inv.variable_symbol) === txVs;
    const accs = invoiceAccounts(inv);
    const accKnown = accs.length > 0;
    const accOk = !!tx.counterparty_account && accs.some((a) => accountsEqual(a, tx.counterparty_account));
    if (!vsOk && !accOk) continue;
    const exact = Math.abs(remaining - txAmount) <= 0.01;
    const partial = txAmount < remaining - 0.01;
    list.push({ ...inv, remaining, match: { vs: vsOk, account: accOk, account_known: accKnown, exact, partial } });
  }
  // nejlepší nahoře: VS+účet+částka > VS+částka > účet+částka > VS > účet
  const sc = (c) => (c.match.vs ? 4 : 0) + (c.match.account ? 2 : 0) + (c.match.exact ? 3 : 0);
  list.sort((a, b) => sc(b) - sc(a) || new Date(a.date_due || 0) - new Date(b.date_due || 0));
  return list;
}

/**
 * Najde kandidáty a rozhodne. opts.invoices = předem načtené faktury (dávkové párování).
 * @returns {Promise<{decision, candidates, reason, partial?}>}
 */
async function findMatchCandidates(tx, prismaCtx, opts = {}) {
  const invoices = opts.invoices || await loadOpenInvoices(prismaCtx, tx.direction === 'in' ? 'ar' : 'ap');
  const list = scoreCandidates(tx, invoices);
  const txVs = normalizeVs(tx.variable_symbol);
  if (!list.length) {
    return { decision: 'no_match', candidates: [], reason: txVs || tx.counterparty_account
      ? 'Žádná otevřená faktura se shodným VS ani účtem protistrany.'
      : 'Platba nemá VS ani účet protistrany — nelze automaticky spárovat.' };
  }
  const vsExact = list.filter((c) => c.match.vs && c.match.exact);
  if (vsExact.length === 1) return { decision: 'auto_match', candidates: vsExact, reason: `VS ${txVs} + částka sedí na ${vsExact[0].invoice_number}.` };
  if (vsExact.length > 1) {
    const withAcc = vsExact.filter((c) => c.match.account);
    if (withAcc.length === 1) return { decision: 'auto_match', candidates: withAcc, reason: `VS + účet + částka sedí na ${withAcc[0].invoice_number}.` };
    return { decision: 'needs_review', candidates: vsExact, reason: `${vsExact.length} faktur se stejným VS a částkou — vyber ručně.` };
  }
  const accExact = list.filter((c) => c.match.account && c.match.exact);
  if (accExact.length === 1) return { decision: 'auto_match', candidates: accExact, reason: `Účet protistrany + částka sedí na ${accExact[0].invoice_number}.` };
  const vsAll = list.filter((c) => c.match.vs);
  if (vsAll.length === 1 && vsAll[0].match.partial && (vsAll[0].match.account || !vsAll[0].match.account_known || !tx.counterparty_account)) {
    return { decision: 'auto_match', partial: true, candidates: vsAll, reason: `VS ${txVs}: částečná úhrada faktury ${vsAll[0].invoice_number} (zbývá ${vsAll[0].remaining}).` };
  }
  if (vsAll.length === 1 && vsAll[0].match.partial) return { decision: 'needs_review', candidates: list, reason: `VS ${txVs} sedí (částečná úhrada ${vsAll[0].invoice_number}), ale účet protistrany neodpovídá — zkontroluj ručně.` };
  if (vsAll.length === 1) return { decision: 'needs_review', candidates: list, reason: `VS ${txVs} sedí na ${vsAll[0].invoice_number}, ale platba je vyšší než zbývá doplatit (${vsAll[0].remaining}).` };
  if (vsAll.length) return { decision: 'needs_review', candidates: list, reason: `VS ${txVs} odpovídá ${vsAll.length} fakturám — vyber ručně.` };
  if (accExact.length > 1) return { decision: 'needs_review', candidates: accExact, reason: `${accExact.length} faktur stejné protistrany se stejnou částkou — vyber ručně.` };
  return { decision: 'no_match', candidates: list, reason: 'Sedí jen účet protistrany, ne VS ani částka — případně spáruj ručně.' };
}

/**
 * Zpracuje jednu transakci: pravidla + párování s fakturami.
 * Párování s fakturou má přednost před pravidly typu „Ignorovat"/„Posoudit", pokud je jednoznačné.
 * ctx = { rules, invoices } (předem načtené), opts.mode: 'new' | 'recheck'
 */
async function processTransaction(tx, prismaCtx, userContext, ctx, opts = {}) {
  const { ruleMatches, applyRule } = require('./matching-rules');
  const result = await findMatchCandidates(tx, prismaCtx, { invoices: ctx.invoices });
  if (result.decision === 'auto_match') {
    const inv = result.candidates[0];
    const r = await applyMatch(tx, [{ invoice_id: inv.id, amount: Number(tx.amount) }], prismaCtx, userContext, result.partial ? 'vs-partial' : (inv.match.vs ? 'vs+amount' : 'account+amount'));
    // aktualizovat cache faktur (další platby téže faktury)
    const cached = ctx.invoices && ctx.invoices.find((i) => i.id === inv.id);
    if (cached && r.updated_invoices && r.updated_invoices[0]) { cached.paid_amount = r.updated_invoices[0].paid_amount; cached.status = r.updated_invoices[0].status; }
    return { status: 'matched', invoice: inv.invoice_number, partial: !!result.partial };
  }
  if (opts.mode === 'recheck') {
    // už zpracované (ignorované pravidlem / k posouzení) — měníme jen při jednoznačné shodě (výše)
    if (tx.match_status === 'needs_review' && result.decision === 'no_match' && tx.match_method && tx.match_method !== 'rule') {
      await prismaCtx.bankTransaction.update({ where: { id: tx.id }, data: { match_status: 'unmatched' } });
      return { status: 'unmatched' };
    }
    return { status: tx.match_status };
  }
  const rule = (ctx.rules || []).find((r) => ruleMatches(tx, r));
  if (rule) {
    const rr = await applyRule(tx, rule, prismaCtx, userContext);
    return { status: rr.status, rule: rule.name };
  }
  if (result.decision === 'needs_review') {
    await prismaCtx.bankTransaction.update({ where: { id: tx.id }, data: { match_status: 'needs_review', match_method: 'vs' , note: result.reason.slice(0, 500) } });
    return { status: 'needs_review' };
  }
  return { status: 'unmatched' };
}

function newSummary(total) {
  return { total, matched: 0, partial: 0, needs_review: 0, no_match: 0, rule_ignored: 0, rule_matched: 0, errors: [], matched_ids: [], review_ids: [], ignored_ids: [] };
}
function addToSummary(summary, tx, r) {
  if (r.status === 'matched') { summary.matched++; summary.matched_ids.push(tx.id); if (r.partial) summary.partial++; if (r.rule) summary.rule_matched++; }
  else if (r.status === 'needs_review') { summary.needs_review++; summary.review_ids.push(tx.id); }
  else if (r.status === 'ignored') { summary.rule_ignored++; summary.ignored_ids.push(tx.id); }
  else summary.no_match++;
}
async function loadCtx(prismaCtx) {
  const [rules, invoices] = await Promise.all([
    prismaCtx.matchingRule.findMany({ where: { active: true }, orderBy: [{ priority: 'desc' }, { id: 'asc' }] }),
    loadOpenInvoices(prismaCtx, null),
  ]);
  return { rules, invoices };
}

/** Auto-match nepárovaných transakcí jednoho výpisu (volá se po importu). */
async function autoMatchStatement(statementId, prismaCtx, userContext, opts = {}) {
  const transactions = await prismaCtx.bankTransaction.findMany({
    where: { statement_id: statementId, match_status: 'unmatched' },
    orderBy: [{ transaction_date: 'asc' }, { id: 'asc' }],
  });
  const summary = newSummary(transactions.length);
  if (!transactions.length) return summary;
  const ctx = await loadCtx(prismaCtx);
  for (const tx of transactions) {
    try { addToSummary(summary, tx, await processTransaction(tx, prismaCtx, userContext, ctx, { mode: 'new' })); }
    catch (e) { summary.errors.push({ tx_id: tx.id, error: e.message }); }
  }
  return summary;
}

/**
 * Projde VŠECHNY nevyřešené platby: nepárované (pravidla + faktury), k posouzení a ignorované pravidlem
 * (u těch jen jednoznačná shoda s fakturou — např. okamžitá úhrada s VS faktury). Ručně ignorované se nemění.
 */
async function autoMatchAll(prismaCtx, userContext, opts = {}) {
  const where = { OR: [
    { match_status: 'unmatched' },
    { match_status: 'needs_review' },
    { match_status: 'ignored', match_method: 'rule' },
  ] };
  if (opts.bank_account_id) where.bank_account_id = opts.bank_account_id;
  const transactions = await prismaCtx.bankTransaction.findMany({ where, orderBy: [{ transaction_date: 'asc' }, { id: 'asc' }] });
  const summary = newSummary(transactions.length);
  if (!transactions.length) return summary;
  const ctx = await loadCtx(prismaCtx);
  for (const tx of transactions) {
    try {
      const mode = tx.match_status === 'unmatched' ? 'new' : 'recheck';
      addToSummary(summary, tx, await processTransaction(tx, prismaCtx, userContext, ctx, { mode }));
    } catch (e) { summary.errors.push({ tx_id: tx.id, error: e.message }); }
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
    if (CLOSED_STATUSES.includes(inv.status)) {
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

  // Platba odchází z platebního příkazu? → napoj bankovní pohyb na už existující platbu příkazu
  // (doklad i platba pak nesou číslo příkazu PB-…)
  if (txDirection === 'out' && allocations.length === 1) {
    const a0 = allocations[0];
    const queued = await prismaCtx.payment.findFirst({
      where: {
        batch_id: { not: null }, bank_transaction_id: null, status: { in: ['queued', 'submitted', 'draft'] },
        allocations: { some: { invoice_id: a0.invoice_id } },
      },
      include: { allocations: true, batch: { select: { id: true, batch_number: true } } },
      orderBy: { id: 'asc' },
    });
    if (queued && Math.abs(Number(queued.amount) - txAmount) <= 0.01 && queued.allocations.length === 1) {
      const payment = await prismaCtx.payment.update({
        where: { id: queued.id },
        data: { bank_transaction_id: tx.id, status: 'executed', executed_date: tx.transaction_date, partner_account: tx.counterparty_account || queued.partner_account },
      });
      const inv = invoices[0];
      const newPaid = Number(inv.paid_amount) + txAmount;
      const newStatus = newPaid + 0.01 >= Number(inv.total) ? 'paid' : (newPaid > 0.009 ? 'partially_paid' : inv.status);
      const upd = await prismaCtx.invoice.update({ where: { id: inv.id }, data: { paid_amount: newPaid, status: newStatus } });
      const updatedTx = await prismaCtx.bankTransaction.update({
        where: { id: tx.id },
        data: { match_status: 'matched', match_method: 'batch', resolved_by_id: userContext?.id || null, resolved_at: new Date(), note: 'Platební příkaz ' + (queued.batch?.batch_number || '') },
      });
      // všechny platby příkazu provedené → příkaz zpracován
      try {
        const open = await prismaCtx.payment.count({ where: { batch_id: queued.batch_id, status: { notIn: ['executed', 'cancelled'] } } });
        if (open === 0) await prismaCtx.paymentBatch.update({ where: { id: queued.batch_id }, data: { status: 'processed', processed_at: new Date() } });
      } catch (e) { /* ignore */ }
      return { payment, updated_invoices: [upd], transaction: updatedTx, batch: queued.batch };
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
  const METHOD_LABEL = { manual: 'Ruční párování', 'vs+amount': 'Auto: VS + částka', 'account+amount': 'Auto: účet + částka', 'vs-partial': 'Auto: VS, částečná úhrada', rule: 'Pravidlo' };
  for (const a of allocations) {
    // původní stav faktury (pro vrácení při odpojení) — u už částečně placených převezmeme z dřívější alokace
    const inv = invoices.find(i => i.id === a.invoice_id);
    let prev = inv ? inv.status : null;
    if (prev === 'partially_paid' || prev === 'paid') {
      const older = await prismaCtx.paymentAllocation.findFirst({ where: { invoice_id: a.invoice_id, note: { contains: '[prev:' } }, orderBy: { id: 'asc' }, select: { note: true } });
      const m = older && older.note && older.note.match(/\[prev:([a-z_0-9]+)\]/);
      prev = m ? m[1] : null;
    }
    await prismaCtx.paymentAllocation.create({
      data: {
        payment_id: payment.id,
        invoice_id: a.invoice_id,
        amount: Number(a.amount),
        note: ((METHOD_LABEL[matchMethod] || matchMethod || '') + (prev ? ' [prev:' + prev + ']' : '')).slice(0, 255),
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

    // Zaplaceno celé → `paid`, část → `partially_paid` (částečně vypořádáno)
    if (newPaid + 0.01 >= total) {
      newStatus = 'paid';
    } else if (newPaid > 0.009) {
      newStatus = 'partially_paid';
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

  const fromBatch = !!tx.payment.batch_id;
  // Vrať invoice.paid_amount
  for (const alloc of tx.payment.allocations) {
    const newPaid = Number(alloc.invoice.paid_amount) - Number(alloc.amount);
    let newStatus = alloc.invoice.status;
    if (['paid', 'partially_paid'].includes(alloc.invoice.status) && newPaid + 0.01 < Number(alloc.invoice.total)) {
      if (newPaid > 0.009) newStatus = 'partially_paid';
      else {
        // původní stav uložený při párování; jinak rozumný výchozí
        let prev = null;
        const own = alloc.note && alloc.note.match(/\[prev:([a-z_0-9]+)\]/);
        if (own) prev = own[1];
        if (!prev) {
          const older = await prismaCtx.paymentAllocation.findFirst({ where: { invoice_id: alloc.invoice_id, note: { contains: '[prev:' } }, orderBy: { id: 'asc' }, select: { note: true } });
          const m = older && older.note && older.note.match(/\[prev:([a-z_0-9]+)\]/);
          prev = m ? m[1] : null;
        }
        newStatus = prev && !['paid', 'partially_paid'].includes(prev) ? prev : (alloc.invoice.direction === 'ap' ? 'ready_to_pay' : 'sent');
      }
    }
    await prismaCtx.invoice.update({
      where: { id: alloc.invoice_id },
      data: { paid_amount: newPaid < 0 ? 0 : newPaid, status: newStatus },
    });
  }

  if (fromBatch) {
    // platba patří k platebnímu příkazu → jen odpojit bankovní pohyb, příkaz zůstává
    await prismaCtx.payment.update({ where: { id: tx.payment.id }, data: { bank_transaction_id: null, status: 'queued', executed_date: null } });
    for (const alloc of tx.payment.allocations) {
      const inv = await prismaCtx.invoice.findUnique({ where: { id: alloc.invoice_id }, select: { paid_amount: true } });
      if (inv && Number(inv.paid_amount) <= 0.009) await prismaCtx.invoice.update({ where: { id: alloc.invoice_id }, data: { status: 'payment_queued' } });
    }
    try { await prismaCtx.paymentBatch.updateMany({ where: { id: tx.payment.batch_id, status: 'processed' }, data: { status: 'submitted_to_bank', processed_at: null } }); } catch (e) { /* ignore */ }
  } else {
    // Smaž Allocations a Payment
    await prismaCtx.paymentAllocation.deleteMany({ where: { payment_id: tx.payment.id } });
    await prismaCtx.payment.delete({ where: { id: tx.payment.id } });
  }

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
  autoMatchAll,
  processTransaction,
  normalizeAccount,
  accountsEqual,
  CLOSED_STATUSES,
  applyMatch,
  unmatchTransaction,
  ignoreTransaction,
  normalizeVs,
  PAYABLE_INVOICE_STATUSES_AP,
  PAYABLE_INVOICE_STATUSES_AR,
  NEVER_PAYABLE,
};
