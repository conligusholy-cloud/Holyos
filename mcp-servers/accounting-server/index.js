// =============================================================================
// HolyOS MCP Server — Accounting (Účetní doklady, banka, párování)
// In-process režim pro orchestrátor — agent `ucetni`.
// =============================================================================

'use strict';

const { buildDigest } = require('../../services/digest');

function getAccountingTools() {
  return [
    {
      name: 'list_unmatched_bank_transactions',
      description: 'Vrátí seznam bankovních transakcí ve stavu unmatched / needs_review. Použij pro odpověď "co máme nezpracovaného z banky" nebo "kolik plateb čeká na párování".',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Kolik dní zpět hledat (default 30)', default: 30 },
          status: { type: 'string', enum: ['unmatched', 'needs_review', 'both'], description: 'Filtr (default both)', default: 'both' },
          bank_account_id: { type: 'number', description: 'Omez na konkrétní bankovní účet' },
          limit: { type: 'number', default: 50 },
        },
      },
    },
    {
      name: 'get_bank_digest',
      description: 'Vrátí strukturovaný textový report bankovních transakcí čekajících na zpracování (sumy, počty, výpis). Použij pro shrnutí stavu banky pro uživatele.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', default: 7 },
        },
      },
    },
    {
      name: 'list_open_invoices',
      description: 'Faktury, které nejsou zaplacené (stav nezahrnuje paid/cancelled/written_off/archived/draft). Použij pro "kolik nám zbývá zaplatit" (AP) nebo "kolik nám dluží zákazníci" (AR).',
      input_schema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['ap', 'ar', 'both'], description: 'AP=přijaté/dlužíme, AR=vydané/dluží nám', default: 'both' },
          overdue_only: { type: 'boolean', description: 'Jen po splatnosti', default: false },
          limit: { type: 'number', default: 50 },
        },
      },
    },
    {
      name: 'get_invoice',
      description: 'Detail jedné faktury podle čísla nebo ID. Vrací VS, částku, splatnost, stav, položky.',
      input_schema: {
        type: 'object',
        properties: {
          invoice_number: { type: 'string', description: 'Interní číslo (FP-2026-00006) nebo externí číslo dodavatele' },
          id: { type: 'number' },
        },
      },
    },
    {
      name: 'list_payment_batches',
      description: 'Seznam vygenerovaných platebních příkazů (KPC souborů). Status: draft/generated/submitted_to_bank/processed/cancelled.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          limit: { type: 'number', default: 20 },
        },
      },
    },
    {
      name: 'list_matching_rules',
      description: 'Seznam pravidel pro auto-zpracování bankovních transakcí (auto-ignor, auto-match, posoudit).',
      input_schema: {
        type: 'object',
        properties: {
          active_only: { type: 'boolean', default: true },
        },
      },
    },
    {
      name: 'accounting_summary',
      description: 'Souhrnné KPI: nezaplacené AP, AR, po splatnosti, čeká na schválení, připraveno k platbě. Použij pro "jak to vypadá s účetnictvím".',
      input_schema: { type: 'object', properties: {} },
    },
  ];
}

async function executeAccountingTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_unmatched_bank_transactions': {
      const days = params.days || 30;
      const since = new Date();
      since.setDate(since.getDate() - days);

      const statusFilter =
        params.status === 'unmatched' ? ['unmatched']
          : params.status === 'needs_review' ? ['needs_review']
            : ['unmatched', 'needs_review'];

      const where = {
        match_status: { in: statusFilter },
        transaction_date: { gte: since },
      };
      if (params.bank_account_id) where.bank_account_id = params.bank_account_id;

      const transactions = await prisma.bankTransaction.findMany({
        where,
        include: {
          bank_account: { select: { name: true, account_number: true, bank_code: true } },
        },
        orderBy: [{ match_status: 'asc' }, { transaction_date: 'desc' }],
        take: params.limit || 50,
      });

      return {
        count: transactions.length,
        period_days: days,
        transactions: transactions.map(t => ({
          id: t.id,
          date: t.transaction_date,
          direction: t.direction,
          amount: Number(t.amount),
          counterparty_name: t.counterparty_name,
          counterparty_account: t.counterparty_account,
          variable_symbol: t.variable_symbol,
          message: t.message,
          match_status: t.match_status,
          bank: t.bank_account?.name,
        })),
      };
    }

    case 'get_bank_digest': {
      const digest = await buildDigest(prisma, { days: params.days || 7 });
      return {
        subject: digest.subject,
        body: digest.body,
        summary: digest.summary,
      };
    }

    case 'list_open_invoices': {
      const NEVER_PAYABLE = ['paid', 'cancelled', 'written_off', 'archived', 'draft'];
      const where = { status: { notIn: NEVER_PAYABLE } };
      if (params.direction && params.direction !== 'both') where.direction = params.direction;
      if (params.overdue_only) {
        where.date_due = { lt: new Date() };
      }
      const invoices = await prisma.invoice.findMany({
        where,
        include: { company: { select: { name: true, ico: true } } },
        orderBy: { date_due: 'asc' },
        take: params.limit || 50,
      });
      return {
        count: invoices.length,
        total_amount: invoices.reduce((s, i) => s + (Number(i.total) - Number(i.paid_amount)), 0),
        invoices: invoices.map(i => ({
          id: i.id,
          invoice_number: i.invoice_number,
          external_number: i.external_number,
          direction: i.direction,
          status: i.status,
          company: i.company?.name,
          total: Number(i.total),
          paid_amount: Number(i.paid_amount),
          remaining: Number(i.total) - Number(i.paid_amount),
          variable_symbol: i.variable_symbol,
          date_due: i.date_due,
          overdue: i.date_due < new Date() && Number(i.paid_amount) < Number(i.total),
        })),
      };
    }

    case 'get_invoice': {
      let invoice = null;
      if (params.id) {
        invoice = await prisma.invoice.findUnique({
          where: { id: params.id },
          include: {
            company: true,
            items: true,
            allocations: { include: { payment: true } },
          },
        });
      } else if (params.invoice_number) {
        invoice = await prisma.invoice.findFirst({
          where: {
            OR: [
              { invoice_number: params.invoice_number },
              { external_number: params.invoice_number },
            ],
          },
          include: {
            company: true,
            items: true,
            allocations: { include: { payment: true } },
          },
        });
      }
      if (!invoice) return { found: false, error: 'Faktura nenalezena' };
      return {
        found: true,
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          external_number: invoice.external_number,
          direction: invoice.direction,
          type: invoice.type,
          status: invoice.status,
          company: invoice.company?.name,
          ico: invoice.company?.ico,
          total: Number(invoice.total),
          paid_amount: Number(invoice.paid_amount),
          variable_symbol: invoice.variable_symbol,
          date_issued: invoice.date_issued,
          date_due: invoice.date_due,
          partner_bank_account: invoice.partner_bank_account,
          items_count: invoice.items?.length || 0,
          payments_count: invoice.allocations?.length || 0,
        },
      };
    }

    case 'list_payment_batches': {
      const where = {};
      if (params.status) where.status = params.status;
      const batches = await prisma.paymentBatch.findMany({
        where,
        include: {
          bank_account: { select: { name: true } },
          _count: { select: { payments: true } },
        },
        orderBy: { created_at: 'desc' },
        take: params.limit || 20,
      });
      return {
        count: batches.length,
        batches: batches.map(b => ({
          id: b.id,
          batch_number: b.batch_number,
          status: b.status,
          bank: b.bank_account?.name,
          total_amount: Number(b.total_amount),
          payments_count: b._count.payments,
          due_date: b.due_date,
          created_at: b.created_at,
          submitted_at: b.submitted_at,
        })),
      };
    }

    case 'list_matching_rules': {
      const where = params.active_only !== false ? { active: true } : {};
      const rules = await prisma.matchingRule.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      });
      return {
        count: rules.length,
        rules: rules.map(r => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
          active: r.active,
          action: r.action,
          criteria: {
            direction: r.direction,
            counterparty_account: r.counterparty_account,
            counterparty_name_contains: r.counterparty_name_contains,
            variable_symbol: r.variable_symbol,
            amount_min: r.amount_min ? Number(r.amount_min) : null,
            amount_max: r.amount_max ? Number(r.amount_max) : null,
          },
        })),
      };
    }

    case 'accounting_summary': {
      // Reuse logiky z accounting.routes.js /summary endpointu — agregace KPI
      const [apOpen, arOpen, ocrReview, awaitingApproval, readyToPay, overdueAp, overdueAr] = await Promise.all([
        prisma.invoice.aggregate({
          where: { direction: 'ap', status: { notIn: ['paid', 'cancelled', 'written_off', 'archived', 'draft'] } },
          _count: true,
          _sum: { total: true },
        }),
        prisma.invoice.aggregate({
          where: { direction: 'ar', status: { notIn: ['paid', 'cancelled', 'written_off', 'archived', 'draft'] } },
          _count: true,
          _sum: { total: true },
        }),
        prisma.invoice.count({ where: { needs_human_review: true } }),
        prisma.invoice.count({ where: { status: 'awaiting_approval' } }),
        prisma.invoice.count({ where: { status: 'ready_to_pay' } }),
        prisma.invoice.count({ where: { direction: 'ap', status: { notIn: ['paid', 'cancelled', 'written_off', 'archived', 'draft'] }, date_due: { lt: new Date() } } }),
        prisma.invoice.count({ where: { direction: 'ar', status: { notIn: ['paid', 'cancelled', 'written_off', 'archived', 'draft'] }, date_due: { lt: new Date() } } }),
      ]);

      return {
        ap_open: { count: apOpen._count, total: Number(apOpen._sum.total || 0) },
        ar_open: { count: arOpen._count, total: Number(arOpen._sum.total || 0) },
        overdue_ap: overdueAp,
        overdue_ar: overdueAr,
        ocr_needs_review: ocrReview,
        awaiting_approval: awaitingApproval,
        ready_to_pay: readyToPay,
      };
    }

    default:
      throw new Error(`Unknown accounting tool: ${toolName}`);
  }
}

module.exports = { getAccountingTools, executeAccountingTool };
