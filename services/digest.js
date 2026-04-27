// HolyOS — Bank digest generator
// =============================================================================
// Sestaví přehled nezpracovaných bankovních transakcí (unmatched + needs_review)
// za posledních N dní pro odeslání e-mailem účetní/odpovědné osobě.
//
// Použití:
//   const digest = await buildDigest(prisma, { days: 7 });
//   if (digest.summary.total > 0) {
//     await sendMail({ to: ..., subject: digest.subject, body: digest.body, link: '/modules/ucetni-doklady/' });
//   }
// =============================================================================

'use strict';

function fmtAmount(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getDate()}.${dt.getMonth() + 1}.${dt.getFullYear()}`;
}

function fmtTxLine(tx) {
  const sign = tx.direction === 'in' ? '+' : '−';
  const amt = `${sign}${fmtAmount(tx.amount)}`.padEnd(15, ' ');
  const date = fmtDate(tx.transaction_date).padEnd(11, ' ');
  const account = (tx.counterparty_account || '—').padEnd(22, ' ');
  const vs = (tx.variable_symbol || '—').padEnd(12, ' ');
  const msg = (tx.message || '').slice(0, 30);
  return `  ${date} ${amt} | ${account} | VS ${vs} | ${msg}`;
}

/**
 * Sestaví digest report.
 *
 * @param {Object} prisma     Prisma client
 * @param {Object} [opts]
 * @param {number} [opts.days=7]            kolik dní zpět hledat
 * @param {number} [opts.bank_account_id]   omezit na konkrétní účet (jinak všechny)
 * @returns {Promise<Object>}  { subject, body, summary: { total, unmatched, needs_review, sum_amount }, transactions }
 */
async function buildDigest(prisma, opts = {}) {
  const days = opts.days || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const where = {
    match_status: { in: ['unmatched', 'needs_review'] },
    transaction_date: { gte: since },
  };
  if (opts.bank_account_id) where.bank_account_id = opts.bank_account_id;

  const transactions = await prisma.bankTransaction.findMany({
    where,
    include: {
      bank_account: { select: { name: true, account_number: true, bank_code: true } },
    },
    orderBy: [{ match_status: 'asc' }, { transaction_date: 'asc' }],
    take: 500,
  });

  const unmatched = transactions.filter(t => t.match_status === 'unmatched');
  const needsReview = transactions.filter(t => t.match_status === 'needs_review');
  const sumAmount = transactions.reduce((s, t) => {
    const v = Number(t.amount) * (t.direction === 'in' ? 1 : -1);
    return s + v;
  }, 0);

  const summary = {
    total: transactions.length,
    unmatched: unmatched.length,
    needs_review: needsReview.length,
    sum_amount: sumAmount,
    period_from: since,
    period_to: new Date(),
  };

  const periodLabel = `${fmtDate(since)} – ${fmtDate(new Date())}`;
  const subject = `HolyOS bankovní digest — ${transactions.length} transakcí čeká (${periodLabel})`;

  let body = '';
  body += `Bankovní digest za období ${periodLabel}\n`;
  body += `===================================================\n\n`;

  if (transactions.length === 0) {
    body += '✓ Všechny bankovní transakce v období jsou spárované, ignorované nebo bez akce.\n\n';
    body += 'Není potřeba dělat žádnou akci. Můžeš se vrátit ke kávě.\n';
    return { subject, body, summary, transactions };
  }

  if (needsReview.length > 0) {
    body += `⚠ K POSOUZENÍ (${needsReview.length}):\n`;
    body += `Pravidla je označila k ručnímu výběru — pravděpodobně match podle VS, ale přesná částka nesedí, nebo více kandidátů.\n\n`;
    needsReview.forEach(tx => { body += fmtTxLine(tx) + '\n'; });
    body += '\n';
  }

  if (unmatched.length > 0) {
    body += `— NEPÁROVANÉ (${unmatched.length}):\n`;
    body += `Bez VS+částka match a bez pravidla. Buď přidej pravidlo (modul Pravidla párování), nebo manuálně spáruj přes klik na řádek v tabu Banka.\n\n`;
    unmatched.forEach(tx => { body += fmtTxLine(tx) + '\n'; });
    body += '\n';
  }

  body += `===================================================\n`;
  body += `Celkem k řešení: ${transactions.length} transakcí, čistá změna ${fmtAmount(sumAmount)}.\n`;

  return { subject, body, summary, transactions };
}

module.exports = { buildDigest };
