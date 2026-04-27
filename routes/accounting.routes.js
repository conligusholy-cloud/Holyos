// HolyOS — Účetní doklady (faktury přijaté/vydané, workflow, 3-way match)
// Route prefix: /api/accounting

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit, diffObjects, makeSnapshot } = require('../services/audit');
const { generateAboKpc, validateBatchInput } = require('../services/banking/abo-kpc');
const { unmatchTransaction } = require('../services/banking/auto-matcher');
const { getPaymentBatchApprovalLimit, getOurCompany, getDefaultInvoiceDueDays } = require('../services/settings');
const { generateInvoicePdf } = require('../services/pdf/invoice-pdf');
const { sendMail } = require('../services/email');
const { z } = require('zod');

router.use(requireAuth);

// Pro UI — info o aktuálním uživateli (potřeba pro skryté akce)
router.get('/whoami', (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    isSuperAdmin: !!req.user.isSuperAdmin,
    role: req.user.role,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POMOCNÉ FUNKCE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Vygeneruje interní číslo faktury podle typu a roku.
 * Formáty:
 *   received            → FP-2026-00001   (faktura přijatá)
 *   issued              → FV-2026-00001   (faktura vydaná)
 *   credit_note_received→ DP-2026-00001   (dobropis přijatý)
 *   credit_note_issued  → DV-2026-00001   (dobropis vydaný)
 *   proforma_received   → ZP-2026-00001   (zálohová přijatá)
 *   proforma_issued     → ZV-2026-00001   (zálohová vydaná)
 */
async function generateInvoiceNumber(type) {
  const year = new Date().getFullYear();
  const prefixMap = {
    received: 'FP',
    issued: 'FV',
    credit_note_received: 'DP',
    credit_note_issued: 'DV',
    proforma_received: 'ZP',
    proforma_issued: 'ZV',
  };
  const prefix = prefixMap[type] || 'FP';
  const yearPart = `${prefix}-${year}-`;

  const last = await prisma.invoice.findFirst({
    where: { invoice_number: { startsWith: yearPart } },
    orderBy: { invoice_number: 'desc' },
    select: { invoice_number: true },
  });

  let nextSeq = 1;
  if (last) {
    const match = last.invoice_number.match(/(\d+)$/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  return `${yearPart}${String(nextSeq).padStart(5, '0')}`;
}

/** Derivovat direction (ap/ar) z typu dokladu */
function directionFromType(type) {
  if (type && type.endsWith('_received')) return 'ap';
  if (type === 'received') return 'ap';
  if (type && type.endsWith('_issued')) return 'ar';
  if (type === 'issued') return 'ar';
  return 'ap';
}

/** Přepočet sum faktury z položek (subtotal, vat_amount, total) */
async function recalculateInvoiceTotals(invoice_id) {
  const items = await prisma.invoiceItem.findMany({
    where: { invoice_id },
    select: { subtotal: true, vat_amount: true, total: true },
  });
  const subtotal = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const vat_amount = items.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
  const total = items.reduce((s, i) => s + Number(i.total || 0), 0);
  const rounded = Math.round(total * 100) / 100;
  const rounding = Math.round((rounded - total) * 100) / 100;

  await prisma.invoice.update({
    where: { id: invoice_id },
    data: {
      subtotal: subtotal.toFixed(2),
      vat_amount: vat_amount.toFixed(2),
      total: rounded.toFixed(2),
      rounding: rounding.toFixed(2),
    },
  });
}

/** Přepočítat řádek faktury (subtotal, vat_amount, total z quantity, unit_price, vat_rate) */
function calcItemAmounts(quantity, unit_price, vat_rate) {
  const q = Number(quantity);
  const up = Number(unit_price);
  const vr = Number(vat_rate);
  const subtotal = +(q * up).toFixed(2);
  const vat_amount = +(subtotal * vr / 100).toFixed(2);
  const total = +(subtotal + vat_amount).toFixed(2);
  return { subtotal, vat_amount, total };
}

// ────────────────────────────────────────────────────────────────────────────
// INVOICES — LIST + DETAIL
// ────────────────────────────────────────────────────────────────────────────

// GET /api/accounting/invoices — seznam s filtry
router.get('/invoices', async (req, res, next) => {
  try {
    const {
      type, direction, status, company_id, search,
      date_from, date_to, overdue, needs_review, limit = '200',
    } = req.query;

    const where = {};
    if (type) where.type = type;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (company_id) where.company_id = parseInt(company_id, 10);
    if (needs_review === 'true') where.needs_human_review = true;

    if (date_from || date_to) {
      where.date_issued = {};
      if (date_from) where.date_issued.gte = new Date(date_from);
      if (date_to) where.date_issued.lte = new Date(date_to);
    }

    if (overdue === 'true') {
      where.date_due = { lt: new Date() };
      where.status = { notIn: ['paid', 'cancelled', 'written_off', 'archived'] };
    }

    if (search) {
      where.OR = [
        { invoice_number: { contains: search, mode: 'insensitive' } },
        { external_number: { contains: search, mode: 'insensitive' } },
        { variable_symbol: { contains: search, mode: 'insensitive' } },
        { company: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, ico: true, verified_bank_accounts: true } },
        order: { select: { id: true, order_number: true } },
        warehouse_document: { select: { id: true, number: true, type: true, status: true } },
        created_by: { select: { id: true, first_name: true, last_name: true } },
        created_by_user: { select: { id: true, username: true, display_name: true } },
        _count: { select: { items: true, allocations: true, approval_steps: true } },
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(parseInt(limit, 10) || 200, 1000),
    });

    // Anti-podvod kontrola: pro každou fakturu s vyplněným partner_bank_account
    // porovnej s Company.verified_bank_accounts (whitelist). UI zobrazí badge.
    const { normalizeAccount } = require('../services/banking/account-verification');
    const result = invoices.map(inv => {
      let verification = null;
      if (inv.partner_bank_account || inv.partner_iban) {
        if (!inv.company) {
          verification = { status: 'unknown', message: 'Faktura nemá napojenou firmu.' };
        } else {
          const whitelist = Array.isArray(inv.company.verified_bank_accounts)
            ? inv.company.verified_bank_accounts
            : [];
          const accNorm = normalizeAccount(inv.partner_bank_account);
          const ibanNorm = (inv.partner_iban || '').replace(/\s+/g, '').toUpperCase();
          const matched = whitelist.find(e => {
            const eAcc = normalizeAccount(e.account);
            const eIban = (e.iban || '').replace(/\s+/g, '').toUpperCase();
            return (accNorm && eAcc === accNorm) || (ibanNorm && eIban === ibanNorm);
          });
          if (matched) {
            verification = { status: 'verified', source: matched.source || 'manual', message: 'Známý účet ✓' };
          } else if (whitelist.length > 0) {
            verification = {
              status: 'mismatch',
              message: `Firma má ${whitelist.length} jiných účtů — tenhle není mezi nimi!`,
            };
          } else {
            verification = { status: 'unknown', message: 'Firma zatím nemá ověřené účty.' };
          }
        }
      } else {
        verification = { status: 'no_account', message: 'Účet protistrany není vyplněn.' };
      }

      // Strip whitelist z odpovědi (lehčí payload, raw data nepotřebujeme v listingu)
      const { verified_bank_accounts, ...companyTrimmed } = inv.company || {};
      return {
        ...inv,
        company: inv.company ? companyTrimmed : null,
        has_source_file: !!(inv.source_file_path || inv.pdf_file_path),
        bank_account_verification: verification,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/accounting/invoices/:id — detail se vším
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        company: true,
        order: { include: { items: true } },
        warehouse_document: { include: { movements: { include: { material: true } } } },
        items: {
          include: {
            cost_center: { select: { id: true, code: true, name: true, type: true } },
            material: { select: { id: true, code: true, name: true } },
            product: { select: { id: true, code: true, name: true } },
            vehicle: { select: { id: true, license_plate: true, model: true } },
            person: { select: { id: true, first_name: true, last_name: true } },
            order_item: { select: { id: true, name: true, quantity: true, unit_price: true } },
          },
          orderBy: { line_order: 'asc' },
        },
        created_by_user: { select: { id: true, username: true, display_name: true } },
        allocations: {
          include: { payment: { select: { id: true, executed_date: true, amount: true, method: true, status: true } } },
        },
        approval_steps: {
          include: { approver: { select: { id: true, first_name: true, last_name: true } } },
          orderBy: { step_order: 'asc' },
        },
        reminders: { orderBy: { level: 'asc' } },
        email_ingest: { select: { id: true, from_email: true, subject: true, received_at: true } },
        ocr_extractions: { orderBy: { pass_number: 'asc' } },
        created_by: { select: { id: true, first_name: true, last_name: true } },
        approved_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });

    // Anti-podvod ověření účtu protistrany
    let bank_account_verification = null;
    try {
      const { verifyAccount } = require('../services/banking/account-verification');
      bank_account_verification = await verifyAccount({
        companyId: invoice.company_id,
        partnerBankAccount: invoice.partner_bank_account,
        partnerIban: invoice.partner_iban,
      });
    } catch (e) {
      console.error('[verify-account] selhalo:', e.message);
    }

    res.json({ ...invoice, bank_account_verification });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// INVOICES — CREATE + UPDATE + DELETE
// ────────────────────────────────────────────────────────────────────────────

const invoiceCreateSchema = z.object({
  type: z.enum([
    'received', 'issued',
    'credit_note_received', 'credit_note_issued',
    'proforma_received', 'proforma_issued',
  ]),
  company_id: z.number().int(),
  external_number: z.string().max(100).optional().nullable(),
  order_id: z.number().int().optional().nullable(),
  warehouse_document_id: z.number().int().optional().nullable(),
  currency: z.string().length(3).default('CZK'),
  exchange_rate: z.number().default(1),
  date_issued: z.string(),     // ISO string
  date_taxable: z.string().optional().nullable(),
  date_due: z.string(),
  payment_method: z.string().default('bank_transfer'),
  variable_symbol: z.string().max(20).optional().nullable(),
  constant_symbol: z.string().max(10).optional().nullable(),
  specific_symbol: z.string().max(20).optional().nullable(),
  partner_bank_account: z.string().max(50).optional().nullable(),
  partner_iban: z.string().max(34).optional().nullable(),
  partner_bic: z.string().max(11).optional().nullable(),
  vat_regime: z.string().default('standard'),
  note: z.string().optional().nullable(),
  internal_note: z.string().optional().nullable(),
  source: z.string().default('manual'),
  tags: z.array(z.string()).default([]),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit: z.string().default('ks'),
    unit_price: z.number(),
    vat_rate: z.number().default(21),
    cost_center_id: z.number().int().optional().nullable(),
    material_id: z.number().int().optional().nullable(),
    product_id: z.number().int().optional().nullable(),
    vehicle_id: z.number().int().optional().nullable(),
    person_id: z.number().int().optional().nullable(),
    order_item_id: z.number().int().optional().nullable(),
    note: z.string().optional().nullable(),
  })).default([]),
});

// POST /api/accounting/invoices — vytvoření nové faktury (ručně)
router.post('/invoices', async (req, res, next) => {
  try {
    const parsed = invoiceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const data = parsed.data;

    // Vygeneruj interní číslo + urči direction
    const invoice_number = await generateInvoiceNumber(data.type);
    const direction = directionFromType(data.type);

    // Counterpart kontrola — pokud je order_id, musí být typ objednávky kompatibilní
    if (data.order_id) {
      const order = await prisma.order.findUnique({ where: { id: data.order_id } });
      if (!order) return res.status(400).json({ error: 'Objednávka neexistuje' });
      if (direction === 'ap' && order.type !== 'purchase') {
        return res.status(400).json({ error: 'Přijatá faktura vyžaduje nákupní objednávku (type=purchase)' });
      }
      if (direction === 'ar' && order.type !== 'sales') {
        return res.status(400).json({ error: 'Vydaná faktura vyžaduje prodejní objednávku (type=sales)' });
      }
    }

    // Spočti sumy z řádků
    const itemsWithAmounts = data.items.map((it, idx) => {
      const { subtotal, vat_amount, total } = calcItemAmounts(it.quantity, it.unit_price, it.vat_rate);
      return { ...it, line_order: idx + 1, subtotal, vat_amount, total };
    });
    const subtotal = itemsWithAmounts.reduce((s, i) => s + i.subtotal, 0);
    const vat_amount = itemsWithAmounts.reduce((s, i) => s + i.vat_amount, 0);
    const total = itemsWithAmounts.reduce((s, i) => s + i.total, 0);

    // Initial status podle typu
    let status = 'draft';
    if (direction === 'ap' && data.order_id) status = 'po_matched';
    if (direction === 'ar') status = 'draft';

    const invoice = await prisma.invoice.create({
      data: {
        invoice_number,
        external_number: data.external_number || null,
        type: data.type,
        direction,
        company_id: data.company_id,
        order_id: data.order_id || null,
        warehouse_document_id: data.warehouse_document_id || null,
        currency: data.currency,
        exchange_rate: data.exchange_rate,
        subtotal: subtotal.toFixed(2),
        vat_amount: vat_amount.toFixed(2),
        total: total.toFixed(2),
        vat_regime: data.vat_regime,
        date_issued: new Date(data.date_issued),
        date_taxable: data.date_taxable ? new Date(data.date_taxable) : null,
        date_due: new Date(data.date_due),
        payment_method: data.payment_method,
        variable_symbol: data.variable_symbol || null,
        constant_symbol: data.constant_symbol || null,
        specific_symbol: data.specific_symbol || null,
        partner_bank_account: data.partner_bank_account || null,
        partner_iban: data.partner_iban || null,
        partner_bic: data.partner_bic || null,
        status,
        source: data.source,
        note: data.note || null,
        internal_note: data.internal_note || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        created_by_id: req.user?.person?.id || null,
        created_by_user_id: req.user?.id || null,
        items: {
          create: itemsWithAmounts.map(it => ({
            line_order: it.line_order,
            description: it.description,
            quantity: it.quantity,
            unit: it.unit,
            unit_price: it.unit_price,
            vat_rate: it.vat_rate,
            subtotal: it.subtotal.toFixed(2),
            vat_amount: it.vat_amount.toFixed(2),
            total: it.total.toFixed(2),
            cost_center_id: it.cost_center_id || null,
            material_id: it.material_id || null,
            product_id: it.product_id || null,
            vehicle_id: it.vehicle_id || null,
            person_id: it.person_id || null,
            order_item_id: it.order_item_id || null,
            note: it.note || null,
          })),
        },
      },
      include: { items: true, company: { select: { id: true, name: true } } },
    });

    logAudit({
      action: 'create', entity: 'invoice', entity_id: invoice.id,
      description: `Vytvořena faktura ${invoice.invoice_number} (${invoice.type}) od ${invoice.company?.name}`,
      snapshot: makeSnapshot(invoice), user: req.user,
    }).catch(() => {});

    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

// PUT /api/accounting/invoices/:id — úprava hlavičky
router.put('/invoices/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const before = await prisma.invoice.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Faktura nenalezena' });

    // Nelze upravovat zaplacenou/zrušenou/archivovanou
    if (['paid', 'cancelled', 'written_off', 'archived'].includes(before.status)) {
      return res.status(400).json({ error: `Fakturu ve stavu ${before.status} nelze upravovat` });
    }

    const allowed = [
      'external_number', 'order_id', 'warehouse_document_id', 'currency', 'exchange_rate',
      'date_issued', 'date_taxable', 'date_due', 'payment_method',
      'variable_symbol', 'constant_symbol', 'specific_symbol',
      'partner_bank_account', 'partner_iban', 'partner_bic',
      'vat_regime', 'note', 'internal_note',
    ];
    const updateData = {};
    for (const k of allowed) {
      if (k in req.body) {
        if (['date_issued', 'date_taxable', 'date_due'].includes(k) && req.body[k]) {
          updateData[k] = new Date(req.body[k]);
        } else {
          updateData[k] = req.body[k];
        }
      }
    }

    const invoice = await prisma.invoice.update({ where: { id }, data: updateData });
    logAudit({
      action: 'update', entity: 'invoice', entity_id: id,
      description: `Upravena faktura ${invoice.invoice_number}`,
      changes: diffObjects(before, invoice), user: req.user,
    }).catch(() => {});
    res.json(invoice);
  } catch (err) { next(err); }
});

// DELETE /api/accounting/invoices/:id — soft cancel (status=cancelled)
// DELETE /api/accounting/invoices/:id?hard=true — TRVALÉ smazání (jen super admin)
router.delete('/invoices/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const hard = req.query.hard === 'true';
    const before = await prisma.invoice.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Faktura nenalezena' });

    if (hard) {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: 'Trvalé smazání faktury vyžaduje super admin oprávnění.' });
      }

      // Pokud je faktura napojená na e-mail (Fáze 3 ingest), zjisti, jestli je
      // jediná napojená faktura. Pokud ano, e-mail po smazání osiří — resetni mu
      // status na 'archived', ať se neukazuje jako linked_to_invoice s prázdnou
      // relací (orphan). Pokud na e-mailu visí další faktura (multi-attachment),
      // nech status být.
      let archiveEmailIngestId = null;
      if (before.email_ingest_id) {
        const otherCount = await prisma.invoice.count({
          where: { email_ingest_id: before.email_ingest_id, NOT: { id } },
        });
        if (otherCount === 0) archiveEmailIngestId = before.email_ingest_id;
      }

      // Cascade ručně — Prisma má onDelete:Cascade na items, ale ne na allocations/approvals
      const ops = [
        prisma.paymentAllocation.deleteMany({ where: { invoice_id: id } }),
        prisma.invoiceApprovalStep.deleteMany({ where: { invoice_id: id } }),
        prisma.reminder.deleteMany({ where: { invoice_id: id } }),
        prisma.cashMovement.updateMany({ where: { invoice_id: id }, data: { invoice_id: null } }),
        prisma.ocrExtraction.updateMany({ where: { invoice_id: id }, data: { invoice_id: null } }),
        prisma.accountantHandoverItem.deleteMany({ where: { invoice_id: id } }),
        prisma.invoiceItem.deleteMany({ where: { invoice_id: id } }),
        prisma.invoice.delete({ where: { id } }),
      ];
      if (archiveEmailIngestId) {
        ops.push(prisma.emailIngest.update({
          where: { id: archiveEmailIngestId },
          data: {
            status: 'archived',
            note: `Auto-archived po hard-delete faktury ${before.invoice_number} (${new Date().toISOString().slice(0, 10)})`,
          },
        }));
      }
      await prisma.$transaction(ops);

      logAudit({
        action: 'delete', entity: 'invoice', entity_id: id,
        description: `🗑️ TRVALĚ smazána faktura ${before.invoice_number} super adminem ${req.user.username}${archiveEmailIngestId ? ` (e-mail ingest #${archiveEmailIngestId} archivován)` : ''}`,
        snapshot: makeSnapshot(before), user: req.user,
      }).catch(() => {});
      return res.json({ ok: true, hard_deleted: true, email_ingest_archived: archiveEmailIngestId });
    }

    if (before.paid_amount && Number(before.paid_amount) > 0) {
      return res.status(400).json({ error: 'Nelze zrušit fakturu s proběhlou platbou (zkus hard delete jako super admin)' });
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    logAudit({
      action: 'delete', entity: 'invoice', entity_id: id,
      description: `Zrušena faktura ${invoice.invoice_number}`,
      snapshot: makeSnapshot(before), user: req.user,
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// INVOICE ITEMS — CRUD
// ────────────────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().default('ks'),
  unit_price: z.number(),
  vat_rate: z.number().default(21),
  cost_center_id: z.number().int().optional().nullable(),
  material_id: z.number().int().optional().nullable(),
  product_id: z.number().int().optional().nullable(),
  vehicle_id: z.number().int().optional().nullable(),
  person_id: z.number().int().optional().nullable(),
  order_item_id: z.number().int().optional().nullable(),
  note: z.string().optional().nullable(),
});

router.post('/invoices/:id/items', async (req, res, next) => {
  try {
    const invoice_id = parseInt(req.params.id, 10);
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace', details: parsed.error.issues });
    const d = parsed.data;

    const lastItem = await prisma.invoiceItem.findFirst({
      where: { invoice_id }, orderBy: { line_order: 'desc' },
    });
    const line_order = (lastItem?.line_order || 0) + 1;
    const amounts = calcItemAmounts(d.quantity, d.unit_price, d.vat_rate);

    const item = await prisma.invoiceItem.create({
      data: {
        invoice_id, line_order,
        description: d.description,
        quantity: d.quantity,
        unit: d.unit,
        unit_price: d.unit_price,
        vat_rate: d.vat_rate,
        subtotal: amounts.subtotal.toFixed(2),
        vat_amount: amounts.vat_amount.toFixed(2),
        total: amounts.total.toFixed(2),
        cost_center_id: d.cost_center_id || null,
        material_id: d.material_id || null,
        product_id: d.product_id || null,
        vehicle_id: d.vehicle_id || null,
        person_id: d.person_id || null,
        order_item_id: d.order_item_id || null,
        note: d.note || null,
      },
    });
    await recalculateInvoiceTotals(invoice_id);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/invoices/:id/items/:itemId', async (req, res, next) => {
  try {
    const invoice_id = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const parsed = itemSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace', details: parsed.error.issues });
    const d = parsed.data;

    const existing = await prisma.invoiceItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.invoice_id !== invoice_id) {
      return res.status(404).json({ error: 'Položka nenalezena' });
    }

    const merged = {
      quantity: d.quantity ?? existing.quantity,
      unit_price: d.unit_price ?? existing.unit_price,
      vat_rate: d.vat_rate ?? existing.vat_rate,
    };
    const amounts = calcItemAmounts(merged.quantity, merged.unit_price, merged.vat_rate);

    const item = await prisma.invoiceItem.update({
      where: { id: itemId },
      data: {
        ...d,
        subtotal: amounts.subtotal.toFixed(2),
        vat_amount: amounts.vat_amount.toFixed(2),
        total: amounts.total.toFixed(2),
      },
    });
    await recalculateInvoiceTotals(invoice_id);
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/invoices/:id/items/:itemId', async (req, res, next) => {
  try {
    const invoice_id = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await prisma.invoiceItem.delete({ where: { id: itemId } });
    await recalculateInvoiceTotals(invoice_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// 3-WAY MATCH — objednávka + příjemka + faktura
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/accounting/invoices/:id/suggest-matches
 * Navrhne možné Order a WarehouseDocument (příjemku) pro tuto fakturu
 * na základě dodavatele + přibližné shody částky + VS.
 */
router.get('/invoices/:id/suggest-matches', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (invoice.direction !== 'ap') return res.json({ orders: [], receipts: [] });

    // Orders — purchase pro tuto firmu, bez navázané faktury (nebo navázané na jinou)
    const orders = await prisma.order.findMany({
      where: {
        type: 'purchase',
        company_id: invoice.company_id,
        status: { notIn: ['cancelled'] },
      },
      include: {
        items: true,
        _count: { select: { invoices: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    // Příjemky pro tuto firmu, typ receipt_doc, stav completed
    const receipts = await prisma.warehouseDocument.findMany({
      where: {
        type: 'receipt_doc',
        partner_id: invoice.company_id,
        status: { in: ['completed', 'in_progress'] },
      },
      include: {
        movements: { include: { material: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    // Skóre — čím blíž částkou a datem, tím výš
    const invTotal = Number(invoice.total);
    const scored = orders.map(o => {
      const orderTotal = Number(o.total_amount);
      const diffPct = orderTotal > 0 ? Math.abs(orderTotal - invTotal) / orderTotal : 1;
      const amountScore = Math.max(0, 1 - diffPct); // 1 = perfect match
      return { ...o, _score: amountScore };
    }).sort((a, b) => b._score - a._score);

    res.json({ orders: scored, receipts });
  } catch (err) { next(err); }
});

/**
 * POST /api/accounting/invoices/:id/match
 * Body: { order_id?, warehouse_document_id? }
 * Naváže fakturu na objednávku a/nebo příjemku, aktualizuje status.
 */
router.post('/invoices/:id/match', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { order_id, warehouse_document_id } = req.body;
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });

    const update = {};
    if (order_id !== undefined) {
      if (order_id) {
        const order = await prisma.order.findUnique({ where: { id: order_id } });
        if (!order) return res.status(400).json({ error: 'Objednávka neexistuje' });
        if (order.company_id !== invoice.company_id) {
          return res.status(400).json({ error: 'Objednávka patří jiné firmě než faktura' });
        }
        update.order_id = order_id;
      } else {
        update.order_id = null;
      }
    }
    if (warehouse_document_id !== undefined) {
      if (warehouse_document_id) {
        const doc = await prisma.warehouseDocument.findUnique({ where: { id: warehouse_document_id } });
        if (!doc) return res.status(400).json({ error: 'Doklad neexistuje' });
        update.warehouse_document_id = warehouse_document_id;
      } else {
        update.warehouse_document_id = null;
      }
    }

    // Auto-transition statusu v AP workflow
    if (invoice.direction === 'ap') {
      const hasOrder = update.order_id !== undefined ? !!update.order_id : !!invoice.order_id;
      const hasReceipt = update.warehouse_document_id !== undefined
        ? !!update.warehouse_document_id : !!invoice.warehouse_document_id;

      if (hasOrder && hasReceipt && ['draft', 'awaiting_po_match', 'po_matched', 'awaiting_goods_receipt'].includes(invoice.status)) {
        update.status = 'goods_received';
      } else if (hasOrder && !hasReceipt && ['draft', 'awaiting_po_match'].includes(invoice.status)) {
        update.status = 'awaiting_goods_receipt';
      } else if (!hasOrder && hasReceipt && invoice.status === 'draft') {
        update.status = 'awaiting_po_match';
      }
    }

    const updated = await prisma.invoice.update({
      where: { id }, data: update,
      include: {
        order: { select: { id: true, order_number: true } },
        warehouse_document: { select: { id: true, number: true } },
      },
    });

    logAudit({
      action: 'update', entity: 'invoice', entity_id: id,
      description: `3-way match: order=${update.order_id || '-'}, receipt=${update.warehouse_document_id || '-'}, status=${updated.status}`,
      user: req.user,
    }).catch(() => {});
    res.json(updated);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// SCHVALOVÁNÍ (AP)
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/accounting/invoices/:id/submit-for-approval
 * Body: { approver_ids: [personId1, personId2, ...] }
 */
router.post('/invoices/:id/submit-for-approval', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { approver_ids } = req.body;
    if (!Array.isArray(approver_ids) || approver_ids.length === 0) {
      return res.status(400).json({ error: 'Přiřaďte aspoň jednoho schvalovatele' });
    }
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (invoice.direction !== 'ap') {
      return res.status(400).json({ error: 'Schvalování je jen pro přijaté faktury' });
    }

    await prisma.$transaction([
      prisma.invoiceApprovalStep.deleteMany({
        where: { invoice_id: id, status: 'pending' },
      }),
      ...approver_ids.map((pid, idx) => prisma.invoiceApprovalStep.create({
        data: { invoice_id: id, step_order: idx + 1, approver_id: pid, status: 'pending', required: true },
      })),
      prisma.invoice.update({ where: { id }, data: { status: 'awaiting_approval' } }),
    ]);

    logAudit({
      action: 'update', entity: 'invoice', entity_id: id,
      description: `Faktura odeslána ke schválení — ${approver_ids.length} schvalovatel(ů)`,
      user: req.user,
    }).catch(() => {});

    const updated = await prisma.invoice.findUnique({
      where: { id },
      include: { approval_steps: { include: { approver: true }, orderBy: { step_order: 'asc' } } },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

/**
 * POST /api/accounting/invoices/:id/approve — schválit (volá aktuální user podle person_id)
 * POST /api/accounting/invoices/:id/reject  — zamítnout
 */
async function decideApproval(req, res, decision) {
  try {
    const id = parseInt(req.params.id, 10);
    const note = req.body?.note || null;
    const personId = req.user?.person?.id || null;
    const isSuperAdmin = !!req.user?.isSuperAdmin;

    // Logika přístupu:
    //  1) User má přiřazený Person → schvaluje sám za sebe (standard)
    //  2) User je super admin bez Person → admin override (může schválit jakýkoli pending krok)
    //  3) Jinak → chyba
    let step = null;
    let adminOverride = false;

    if (personId) {
      step = await prisma.invoiceApprovalStep.findFirst({
        where: { invoice_id: id, approver_id: personId, status: 'pending' },
        orderBy: { step_order: 'asc' },
      });
      if (!step && isSuperAdmin) {
        // Spadni na admin override, když superadmin nemá svůj vlastní krok
        step = await prisma.invoiceApprovalStep.findFirst({
          where: { invoice_id: id, status: 'pending' },
          orderBy: { step_order: 'asc' },
        });
        adminOverride = !!step;
      }
      if (!step) {
        return res.status(400).json({ error: 'Nemáš pending schválení k této faktuře' });
      }
    } else if (isSuperAdmin) {
      step = await prisma.invoiceApprovalStep.findFirst({
        where: { invoice_id: id, status: 'pending' },
        orderBy: { step_order: 'asc' },
      });
      if (!step) return res.status(400).json({ error: 'Žádný pending krok schválení' });
      adminOverride = true;
    } else {
      return res.status(400).json({
        error: 'Nemůžeš schvalovat — tvůj účet nemá propojený Person záznam. Admin: propoj si svůj User s osobou v modulu Lidé a HR.',
      });
    }

    const finalNote = adminOverride
      ? `[Admin override${req.user.displayName ? ' — ' + req.user.displayName : ''}]${note ? ' ' + note : ''}`
      : note;

    const decidingPersonId = step.approver_id; // vždy zůstává, kdo měl schválit

    await prisma.invoiceApprovalStep.update({
      where: { id: step.id },
      data: { status: decision, decided_at: new Date(), note: finalNote },
    });

    // Pokud všechny required steps = approved → faktura schválena
    const steps = await prisma.invoiceApprovalStep.findMany({ where: { invoice_id: id } });
    const allApproved = steps.filter(s => s.required).every(s => s.status === 'approved');
    const anyRejected = steps.some(s => s.status === 'rejected');

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    let newStatus = invoice.status;
    let approvedAt = null;
    let approvedById = null;
    if (anyRejected) {
      newStatus = 'draft'; // vrátit na draft, ať se buď opraví nebo zruší
    } else if (allApproved) {
      newStatus = 'approved';
      approvedAt = new Date();
      approvedById = decidingPersonId;

      // Pokud už je matched + goods_received, rovnou na ready_to_pay
      if (invoice.order_id && invoice.warehouse_document_id) {
        newStatus = 'ready_to_pay';
      }
    }

    await prisma.invoice.update({
      where: { id },
      data: { status: newStatus, approved_at: approvedAt, approved_by_id: approvedById },
    });

    logAudit({
      action: 'update', entity: 'invoice', entity_id: id,
      description: `Schvalování: ${decision} (krok #${step.step_order})${adminOverride ? ' [admin override]' : ''} → status ${newStatus}`,
      user: req.user,
    }).catch(() => {});

    res.json({ ok: true, status: newStatus, admin_override: adminOverride });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
router.post('/invoices/:id/approve', (req, res) => decideApproval(req, res, 'approved'));
router.post('/invoices/:id/reject',  (req, res) => decideApproval(req, res, 'rejected'));

/**
 * POST /api/accounting/invoices/:id/mark-ready-to-pay
 * Ručně posunout fakturu do ready_to_pay — vyžaduje splněné předpoklady.
 */
router.post('/invoices/:id/mark-ready-to-pay', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { approval_steps: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (invoice.direction !== 'ap') {
      return res.status(400).json({ error: 'Jen pro přijaté faktury' });
    }

    // Faktury za služby (energie, telco, pojistky, nájem) nemají objednávku
    // ani příjemku — 3-way match guard se na ně neaplikuje. Označí se přes
    // tag `service` (přidávaný v UI nebo přes Prisma Studio).
    const isService = Array.isArray(invoice.tags) && (
      invoice.tags.includes('service') || invoice.tags.includes('sluzba')
    );

    const hardChecks = [];
    if (!isService) {
      if (!invoice.order_id) hardChecks.push('chybí napojení na objednávku');
      if (!invoice.warehouse_document_id) hardChecks.push('chybí napojení na příjemku (zboží nebylo přijato)');
    }
    const allApproved = invoice.approval_steps.length > 0 &&
      invoice.approval_steps.filter(s => s.required).every(s => s.status === 'approved');
    if (!allApproved) hardChecks.push('faktura není schválena všemi schvalovateli');

    if (hardChecks.length > 0) {
      return res.status(400).json({
        error: 'Faktura ještě není připravena k platbě',
        blockers: hardChecks,
        hint: isService ? null : 'Pokud je to faktura za službu (energie, telco, pojistky), přidej fakturu tag "service" — guard se přeskočí.',
      });
    }

    const updated = await prisma.invoice.update({
      where: { id }, data: { status: 'ready_to_pay' },
    });
    logAudit({
      action: 'update', entity: 'invoice', entity_id: id,
      description: `Faktura připravena k platbě: ${updated.invoice_number}`,
      user: req.user,
    }).catch(() => {});
    res.json(updated);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// ARES LOOKUP (pro autofill při zakládání faktury s novým dodavatelem)
// ────────────────────────────────────────────────────────────────────────────

router.get('/ares/:ico', async (req, res, next) => {
  try {
    const ico = String(req.params.ico).replace(/\D/g, '');
    if (!ico || ico.length < 6) return res.status(400).json({ error: 'Neplatné IČO' });
    const url = `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(404).json({ error: 'IČO nenalezeno v ARES' });
    const d = await r.json();
    const sidlo = d.sidlo || {};
    res.json({
      ico: d.ico,
      name: d.obchodniJmeno,
      dic: d.dic || (d.icDph || null),
      address: [sidlo.nazevUlice, sidlo.cisloDomovni, sidlo.cisloOrientacni].filter(Boolean).join(' '),
      city: sidlo.nazevObce || sidlo.nazevCastiObce,
      zip: sidlo.psc ? String(sidlo.psc) : null,
      country: sidlo.kodStatu || 'CZ',
      legal_form: d.pravniForma,
      active: !d.datumZaniku,
    });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// SOURCE PDF — originální příloha faktury (z e-mailu)
// ────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

router.get('/invoices/:id/source-pdf', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { source_file_path: true, invoice_number: true, pdf_file_path: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    const filePath = invoice.source_file_path || invoice.pdf_file_path;
    if (!filePath) return res.status(404).json({ error: 'Faktura nemá originální přílohu' });
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Soubor neexistuje na disku' });
    }
    // Path traversal protection — soubor musí být uvnitř STORAGE_DIR
    const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(STORAGE_DIR))) {
      return res.status(403).json({ error: 'Soubor mimo povolený adresář' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}${ext}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// E-MAIL INGEST — seznam, ruční spuštění, reprocess
// ────────────────────────────────────────────────────────────────────────────

const emailWorker = require('../services/email-ingest-worker');
const { fetchNew, runPipelineAndFinalize } = require('../services/email-ingest');
const { runPipeline } = require('../services/ocr/pipeline');

// GET /api/accounting/email — stav workeru + poslední běh
router.get('/email/status', async (req, res, next) => {
  try {
    res.json(emailWorker.status());
  } catch (err) { next(err); }
});

// POST /api/accounting/email/fetch-now — ruční pull
router.post('/email/fetch-now', async (req, res, next) => {
  try {
    const result = await emailWorker.triggerNow();
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/accounting/email/ingests — seznam příchozích mailů
// Query parameters:
//   ?status=...   konkrétní status (přesný match)
//   ?group=active | duplicate | archive | all  (skupina statusů)
//
// Skupiny:
//   active    — vyžadují akci (received, parsing, extracting, awaiting_review, unreadable)
//   duplicate — duplikáty existujících faktur
//   archive   — zpracované e-maily, kde Invoice vznikly (linked_to_invoice, processed)
//   all       — všechno (default pokud nic nezadáno)
const ACTIVE_STATUSES = ['received', 'parsing', 'extracting', 'awaiting_review', 'unreadable'];
const ARCHIVE_STATUSES = ['linked_to_invoice', 'processed', 'archived'];
const DUPLICATE_STATUSES = ['duplicate'];

router.get('/email/ingests', async (req, res, next) => {
  try {
    const { status, group, limit = '100' } = req.query;
    const where = {};
    if (status) {
      where.status = status;
    } else if (group === 'active') {
      where.status = { in: ACTIVE_STATUSES };
    } else if (group === 'archive') {
      where.status = { in: ARCHIVE_STATUSES };
    } else if (group === 'duplicate') {
      where.status = { in: DUPLICATE_STATUSES };
    }
    const ingests = await prisma.emailIngest.findMany({
      where,
      include: {
        attachments: { select: { id: true, filename: true, size_bytes: true, is_invoice_candidate: true, sha256: true } },
        invoices: { select: { id: true, invoice_number: true, total: true, currency: true, status: true, needs_human_review: true } },
      },
      orderBy: { received_at: 'desc' },
      take: Math.min(parseInt(limit, 10) || 100, 500),
    });
    res.json(ingests);
  } catch (err) { next(err); }
});

// GET /api/accounting/email/logs — audit log z e-mail ingestu a OCR pipeline
router.get('/email/logs', async (req, res, next) => {
  try {
    const { limit = '200' } = req.query;
    const logs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: 'email_ingest' },
          { entity: 'ocr_pipeline' },
          { entity: 'invoice', action: 'create', description: { contains: 'email' } },
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(parseInt(limit, 10) || 200, 500),
    });
    res.json(logs);
  } catch (err) { next(err); }
});

// GET /api/accounting/email/ingests/:id — detail s extrakcemi
router.get('/email/ingests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ingest = await prisma.emailIngest.findUnique({
      where: { id },
      include: {
        attachments: true,
        invoices: true,
        extractions: { orderBy: { pass_number: 'asc' } },
      },
    });
    if (!ingest) return res.status(404).json({ error: 'Email ingest nenalezen' });
    res.json(ingest);
  } catch (err) { next(err); }
});

// POST /api/accounting/email/ingests/reprocess-all — hromadný reprocess
// Query: ?group=active|duplicate|archive  (default: active)
router.post('/email/ingests/reprocess-all', async (req, res, next) => {
  try {
    const { group = 'active' } = req.query;
    let where = {};
    if (group === 'active') where.status = { in: ACTIVE_STATUSES };
    else if (group === 'duplicate') where.status = { in: DUPLICATE_STATUSES };
    else if (group === 'archive') where.status = { in: ARCHIVE_STATUSES };
    else return res.status(400).json({ error: 'Neplatná skupina' });

    const ingests = await prisma.emailIngest.findMany({
      where,
      include: { attachments: { where: { is_invoice_candidate: true } } },
    });

    const eligible = ingests.filter(i => i.attachments.length > 0);

    // Vrátíme hned a pipeline běží na pozadí (jinak by request timed out při více ingests)
    res.json({ ok: true, queued: eligible.length, total_in_group: ingests.length });

    // Background processing (fire-and-forget, errors jen do logu)
    (async () => {
      for (const ingest of eligible) {
        try {
          await prisma.ocrExtraction.deleteMany({ where: { email_ingest_id: ingest.id } });
          await prisma.emailIngest.update({
            where: { id: ingest.id },
            data: { status: 'extracting', attempts: { increment: 1 }, sender_notify_reason: null, note: 'Hromadný reprocess' },
          });
          await runPipelineAndFinalize(ingest, ingest.attachments, { notifyContext: null });
        } catch (e) {
          console.error(`[reprocess-all] Chyba u ingestu ${ingest.id}:`, e.message);
        }
      }
      console.log(`[reprocess-all] Dokončeno pro ${eligible.length} e-mailů ze skupiny "${group}".`);
    })().catch(() => {});
  } catch (err) { next(err); }
});

// POST /api/accounting/email/ingests/:id/reprocess — znovu spustit OCR + vytvořit Invoice
// Rozšíření: pokus o stažení faktury z URL v těle e-mailu (Nayax-style faktury jako odkaz).
router.post('/email/ingests/:id/reprocess', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ingest = await prisma.emailIngest.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!ingest) return res.status(404).json({ error: 'Email ingest nenalezen' });

    // Pokus o stažení faktury z URL v body (i když máme přílohy — můžou být logo/banner)
    const fsLink = require('fs');
    const pathLink = require('path');
    const cryptoLink = require('crypto');
    const STORAGE_LINK = process.env.STORAGE_DIR || pathLink.join(__dirname, '..', 'data', 'storage');
    const now = new Date();
    const targetDir = pathLink.join(STORAGE_LINK, 'invoices-incoming', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    if (!fsLink.existsSync(targetDir)) fsLink.mkdirSync(targetDir, { recursive: true });

    const haystack = (ingest.body_html || '') + '\n' + (ingest.body_text || '');
    const urlRegex = /https?:\/\/[^\s"'<>)]+/gi;
    const seen = new Map();
    for (const m of haystack.matchAll(urlRegex)) {
      const u = m[0].replace(/[.,;:!?)\]>]+$/, '');
      // Vyloučit běžné non-invoice URL (analytics, social, unsubscribe)
      if (/google-analytics|googletagmanager|facebook\.com|twitter\.com|linkedin\.com|youtube\.com|unsubscribe|preferences|privacy-policy/i.test(u)) continue;
      let score = 0;
      if (/\.pdf(\?|$|#)/i.test(u)) score += 10;
      if (/invoice|faktur|attachment|download|stahnout|view.{0,5}doc|getfile|nayax|portal/i.test(u)) score += 5;
      // I score=0 přijmeme — content-type rozhodne při fetchi
      if (!seen.has(u)) seen.set(u, { url: u, score });
    }
    const links = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 10);
    const existingUrls = new Set(ingest.attachments.filter(a => a.source_url).map(a => a.source_url));
    let newlyDownloaded = 0;

    for (const { url } of links) {
      if (existingUrls.has(url)) continue;
      try {
        const ctrl = new AbortController();
        const tmo = setTimeout(() => ctrl.abort(), 30000);
        const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'Accept': 'application/pdf,image/*,*/*' } }).finally(() => clearTimeout(tmo));
        if (!r.ok) { console.warn(`[reprocess link] ${url} → HTTP ${r.status}`); continue; }
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('pdf') && !ct.startsWith('image/')) {
          console.warn(`[reprocess link] ${url} → ${ct}, není PDF/obrázek`); continue;
        }
        const ab = await r.arrayBuffer();
        if (ab.byteLength > 20 * 1024 * 1024) { console.warn(`[reprocess link] ${url} → příliš velké`); continue; }
        const buffer = Buffer.from(ab);
        const cd = r.headers.get('content-disposition') || '';
        const cdMatch = cd.match(/filename[^=]*=([^;]+)/i);
        const urlName = url.split('?')[0].split('/').pop() || 'invoice';
        let fname = (cdMatch ? cdMatch[1].replace(/['"]/g, '').trim() : urlName) || 'invoice';
        if (!/\.(pdf|png|jpe?g|webp)$/i.test(fname)) {
          fname += ct.includes('pdf') ? '.pdf' : '.' + ct.split('/')[1].split(';')[0];
        }
        const safeName = `${id}-${Date.now()}-${fname.replace(/[^\w\-\.\s]/g, '_').slice(0, 120)}`;
        const filePath = pathLink.join(targetDir, safeName);
        fsLink.writeFileSync(filePath, buffer);
        const sha256 = cryptoLink.createHash('sha256').update(buffer).digest('hex');
        await prisma.emailAttachment.create({
          data: {
            email_ingest_id: id, filename: fname, content_type: ct || 'application/pdf',
            size_bytes: buffer.length, file_path: filePath,
            source: 'link_download', source_url: url.slice(0, 1000), sha256, is_invoice_candidate: true,
          },
        });
        newlyDownloaded++;
        console.log(`[reprocess link] Stažena faktura z ${url} → ${fname} (${buffer.length} B)`);
      } catch (e) {
        console.warn(`[reprocess link] ${url} selhal: ${e.message}`);
      }
    }

    // Reload kandidátů (včetně právě stažených)
    const allCandidates = await prisma.emailAttachment.findMany({
      where: { email_ingest_id: id, is_invoice_candidate: true },
    });
    if (!allCandidates.length) {
      return res.status(400).json({ error: 'Žádný invoice kandidát ani po pokusu o stažení odkazů z těla e-mailu' });
    }

    // Smaž staré extrakce a uvolni starou vazbu na Invoice
    await prisma.ocrExtraction.deleteMany({ where: { email_ingest_id: id } });
    await prisma.emailIngest.update({
      where: { id },
      data: { status: 'extracting', attempts: { increment: 1 }, sender_notify_reason: null },
    });

    // Použijeme společnou pipeline + finalize logiku (vytvoří Invoice s duplicate prevention)
    const result = await runPipelineAndFinalize(ingest, allCandidates, { notifyContext: null });

    res.json({
      ok: true,
      created_invoices: result.invoices.map(i => ({ id: i.id, invoice_number: i.invoice_number, total: i.total })),
      skipped_duplicates: result.skippedDuplicates,
      pipeline_count: result.results.length,
      newly_downloaded_links: newlyDownloaded,
    });
  } catch (err) { next(err); }
});

// POST /api/accounting/email/ingests/:id/mark-unreadable — ruční override
router.post('/email/ingests/:id/mark-unreadable', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const note = req.body?.note || 'Ručně označeno uživatelem';
    await prisma.emailIngest.update({
      where: { id }, data: { status: 'unreadable', sender_notify_reason: note },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// STATISTIKY (rychlé summary pro dashboard)
// ────────────────────────────────────────────────────────────────────────────

router.get('/summary', async (req, res, next) => {
  try {
    const now = new Date();
    const [
      unpaidAp, unpaidAr, overdueAp, overdueAr, needsReview, pendingApproval, readyToPay,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: { direction: 'ap', status: { notIn: ['paid', 'cancelled', 'written_off', 'archived'] } },
        _sum: { total: true }, _count: true,
      }),
      prisma.invoice.aggregate({
        where: { direction: 'ar', status: { notIn: ['paid', 'cancelled', 'written_off'] } },
        _sum: { total: true }, _count: true,
      }),
      prisma.invoice.count({ where: { direction: 'ap', date_due: { lt: now }, status: { notIn: ['paid', 'cancelled', 'written_off', 'archived'] } } }),
      prisma.invoice.count({ where: { direction: 'ar', date_due: { lt: now }, status: { notIn: ['paid', 'cancelled', 'written_off'] } } }),
      prisma.invoice.count({ where: { needs_human_review: true } }),
      prisma.invoice.count({ where: { status: 'awaiting_approval' } }),
      prisma.invoice.count({ where: { status: 'ready_to_pay' } }),
    ]);
    res.json({
      unpaid_ap: { count: unpaidAp._count, total: unpaidAp._sum.total || 0 },
      unpaid_ar: { count: unpaidAr._count, total: unpaidAr._sum.total || 0 },
      overdue_ap: overdueAp,
      overdue_ar: overdueAr,
      needs_review: needsReview,
      pending_approval: pendingApproval,
      ready_to_pay: readyToPay,
    });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// PAYMENT BATCH (ABO/KPC platební příkaz) — Fáze 4
// ────────────────────────────────────────────────────────────────────────────
//
// Workflow:
//   1) Faktury ve stavu `ready_to_pay` se vyberou v UI (tab "K platbě")
//   2) POST /payment-batches → vytvoří PaymentBatch + Payment per faktura,
//      faktury přejdou do stavu `payment_queued`
//   3) GET /payment-batches/:id/download.kpc → stáhne ABO/KPC soubor
//   4) POST /payment-batches/:id/submit → po importu do banky uživatel
//      ručně označí jako "submitted_to_bank" (Fio API přijde ve Fázi 4.5)
//   5) Po spárování příchozího výpisu (Fáze 5) přejdou faktury do `paid`

/** Vygeneruje pořadové číslo batche (PB-2026-0001) */
async function generatePaymentBatchNumber() {
  const year = new Date().getFullYear();
  const prefix = `PB-${year}-`;
  const last = await prisma.paymentBatch.findFirst({
    where: { batch_number: { startsWith: prefix } },
    orderBy: { batch_number: 'desc' },
    select: { batch_number: true },
  });
  let nextSeq = 1;
  if (last) {
    const m = last.batch_number.match(/(\d+)$/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/** Spočítá pořadové č. KPC souboru za den (001–999) — pro UHL hlavičku */
async function nextDailyFileSeq(creationDate = new Date()) {
  const dayStart = new Date(creationDate); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(creationDate); dayEnd.setHours(23, 59, 59, 999);
  const count = await prisma.paymentBatch.count({
    where: { generated_at: { gte: dayStart, lte: dayEnd } },
  });
  return String(count + 1).padStart(3, '0');
}

const paymentBatchCreateSchema = z.object({
  bank_account_id: z.number().int().positive(),
  invoice_ids: z.array(z.number().int().positive()).min(1, 'Vyberte alespoň jednu fakturu'),
  due_date: z.string().optional(), // ISO; default = dnes
  format: z.enum(['ABO-KPC', 'ABO-GPC', 'SEPA-XML', 'FIO-API', 'CSOB-API']).default('ABO-KPC'),
  note: z.string().optional().nullable(),
});

// GET /api/accounting/payment-batches — list
router.get('/payment-batches', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = status ? { status } : {};
    const batches = await prisma.paymentBatch.findMany({
      where,
      include: {
        bank_account: { select: { id: true, name: true, bank: true, account_number: true, bank_code: true } },
        created_by: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { payments: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    res.json(batches);
  } catch (err) { next(err); }
});

// GET /api/accounting/payment-batches/eligible-invoices — pomocný endpoint pro UI tab "K platbě"
// POZOR: musí být PŘED /payment-batches/:id, jinak ho :id zachytí (route-order gotcha)
router.get('/payment-batches/eligible-invoices', async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        direction: 'ap',
        status: 'ready_to_pay',
      },
      include: {
        company: { select: { id: true, name: true, ico: true } },
      },
      orderBy: { date_due: 'asc' },
    });
    res.json(invoices);
  } catch (err) { next(err); }
});

// GET /api/accounting/payment-batches/:id — detail s platbami a fakturami
router.get('/payment-batches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const batch = await prisma.paymentBatch.findUnique({
      where: { id },
      include: {
        bank_account: true,
        created_by: { select: { id: true, first_name: true, last_name: true } },
        payments: {
          include: {
            allocations: {
              include: {
                invoice: {
                  select: {
                    id: true, invoice_number: true, external_number: true, status: true,
                    company: { select: { id: true, name: true, ico: true } },
                  },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: 'Batch nenalezen' });
    res.json(batch);
  } catch (err) { next(err); }
});

// POST /api/accounting/payment-batches — vytvoř z vybraných faktur
router.post('/payment-batches', async (req, res, next) => {
  try {
    const parsed = paymentBatchCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const { bank_account_id, invoice_ids, due_date, format, note } = parsed.data;

    // 1) Bankovní účet existuje a je aktivní
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bank_account_id } });
    if (!bankAccount) return res.status(400).json({ error: 'Bankovní účet nenalezen' });
    if (!bankAccount.active) return res.status(400).json({ error: 'Bankovní účet je deaktivován' });

    // 2) Faktury existují a jsou ve stavu ready_to_pay
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: invoice_ids } },
      include: { company: { select: { id: true, name: true, ico: true } } },
    });
    if (invoices.length !== invoice_ids.length) {
      return res.status(400).json({ error: 'Některé faktury neexistují' });
    }
    const wrongStatus = invoices.filter(i => i.status !== 'ready_to_pay');
    if (wrongStatus.length > 0) {
      return res.status(400).json({
        error: 'Některé faktury nejsou ve stavu "K platbě"',
        invalid: wrongStatus.map(i => ({ id: i.id, invoice_number: i.invoice_number, status: i.status })),
      });
    }
    const wrongDirection = invoices.filter(i => i.direction !== 'ap');
    if (wrongDirection.length > 0) {
      return res.status(400).json({
        error: 'Pouze přijaté faktury (AP) lze platit přes platební příkaz',
        invalid: wrongDirection.map(i => ({ id: i.id, invoice_number: i.invoice_number })),
      });
    }
    // Každá faktura musí mít cílový účet (partner_iban nebo partner_bank_account)
    const missingAccount = invoices.filter(i => !i.partner_bank_account && !i.partner_iban);
    if (missingAccount.length > 0) {
      return res.status(400).json({
        error: 'Některé faktury nemají vyplněný účet příjemce',
        invalid: missingAccount.map(i => ({ id: i.id, invoice_number: i.invoice_number })),
      });
    }

    // 3) Approval limit guard
    const totalAmount = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const limit = await getPaymentBatchApprovalLimit();
    if (limit > 0 && totalAmount > limit && !req.user?.isSuperAdmin) {
      return res.status(403).json({
        error: `Celková částka (${totalAmount.toLocaleString('cs-CZ')} Kč) překračuje schvalovací limit ${limit.toLocaleString('cs-CZ')} Kč. Vyžaduje potvrzení super admina.`,
        total_amount: totalAmount,
        limit,
      });
    }

    // 4) Vygeneruj batch_number, dueDate, payments
    const batchNumber = await generatePaymentBatchNumber();
    const dueDate = due_date ? new Date(due_date) : new Date();

    // Pre-validace ABO vstupu před otevřením transakce — chybí účet → fail fast
    const aboInputCheck = {
      senderAccount: { account: `${bankAccount.account_number}/${bankAccount.bank_code}` },
      payments: invoices.map(i => ({
        targetAccount: i.partner_bank_account || i.partner_iban,
        amount: Number(i.total),
        variableSymbol: i.variable_symbol,
        constantSymbol: i.constant_symbol,
        specificSymbol: i.specific_symbol,
      })),
    };
    const validationErrors = validateBatchInput(aboInputCheck);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validace ABO vstupu selhala', details: validationErrors });
    }

    // 5) Atomická transakce: PaymentBatch + Payments + PaymentAllocations
    //    + posun statusů faktur na payment_queued
    const created = await prisma.$transaction(async tx => {
      // Najdi Person z User (pro created_by_id) — admin může nemít Person, pak null
      const personId = req.user?.person?.id || null;

      const batch = await tx.paymentBatch.create({
        data: {
          batch_number: batchNumber,
          bank_account_id,
          format,
          status: 'draft',
          total_count: invoices.length,
          total_amount: totalAmount,
          due_date: dueDate,
          note: note || null,
          created_by_id: personId,
        },
      });

      // Pro každou fakturu: 1 Payment + 1 PaymentAllocation pokrývající celou částku
      for (const inv of invoices) {
        const payment = await tx.payment.create({
          data: {
            direction: 'out',
            method: 'bank_transfer',
            batch_id: batch.id,
            amount: inv.total,
            currency: inv.currency || 'CZK',
            amount_czk: inv.total, // FX rate řešíme až ve Fázi 5
            partner_name: inv.company?.name || inv.external_number || `Faktura ${inv.invoice_number}`,
            partner_account: inv.partner_bank_account,
            variable_symbol: inv.variable_symbol,
            constant_symbol: inv.constant_symbol,
            specific_symbol: inv.specific_symbol,
            scheduled_date: dueDate,
            status: 'queued',
            allocations: {
              create: [{
                invoice_id: inv.id,
                amount: inv.total,
                note: `Generováno do batche ${batchNumber}`,
              }],
            },
          },
        });

        // Posun fakturu do payment_queued
        await tx.invoice.update({
          where: { id: inv.id },
          data: { status: 'payment_queued' },
        });
      }

      return batch;
    });

    logAudit({
      action: 'create', entity: 'payment_batch', entity_id: created.id,
      description: `Vytvořen platební příkaz ${batchNumber} (${invoices.length} faktur, ${totalAmount.toFixed(2)} Kč)`,
      snapshot: makeSnapshot(created), user: req.user,
    }).catch(() => {});

    res.status(201).json({ ...created, total_amount: totalAmount });
  } catch (err) { next(err); }
});

// GET /api/accounting/payment-batches/:id/download.kpc — stáhni ABO/KPC soubor
router.get('/payment-batches/:id/download.kpc', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const batch = await prisma.paymentBatch.findUnique({
      where: { id },
      include: {
        bank_account: true,
        payments: {
          include: {
            allocations: { include: { invoice: { select: { invoice_number: true, partner_iban: true, partner_bank_account: true } } } },
          },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: 'Batch nenalezen' });

    const fileSeq = batch.file_path ? '001' : await nextDailyFileSeq(new Date());
    const aboInput = {
      senderAccount: {
        account: `${batch.bank_account.account_number}/${batch.bank_account.bank_code}`,
        bankCodeFile: fileSeq,
      },
      batchNumber: batch.batch_number,
      creationDate: new Date(),
      dueDate: batch.due_date,
      payments: batch.payments.map(p => ({
        targetAccount: p.partner_account,
        amount: Number(p.amount),
        variableSymbol: p.variable_symbol,
        constantSymbol: p.constant_symbol,
        specificSymbol: p.specific_symbol,
      })),
    };

    const result = generateAboKpc(aboInput);

    // Aktualizuj batch — generated_at a status
    if (batch.status === 'draft') {
      await prisma.paymentBatch.update({
        where: { id },
        data: { status: 'generated', generated_at: new Date() },
      });
    }

    const filename = `${batch.batch_number}.kpc`;
    res.setHeader('Content-Type', 'text/plain; charset=cp852');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Payment-Count', String(result.paymentCount));
    res.setHeader('X-Total-Amount-Haler', String(result.totalHaler));
    res.send(result.contentBuffer);
  } catch (err) { next(err); }
});

// POST /api/accounting/payment-batches/:id/submit
// Označit, že batch byl naimportován do banky (manual potvrzení)
router.post('/payment-batches/:id/submit', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const batch = await prisma.paymentBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ error: 'Batch nenalezen' });
    if (!['draft', 'generated'].includes(batch.status)) {
      return res.status(400).json({ error: `Batch ve stavu "${batch.status}" nelze odeslat` });
    }

    const updated = await prisma.paymentBatch.update({
      where: { id },
      data: { status: 'submitted_to_bank', submitted_at: new Date() },
    });

    // Posun všechny související Payments do "submitted"
    await prisma.payment.updateMany({
      where: { batch_id: id },
      data: { status: 'submitted' },
    });

    logAudit({
      action: 'update', entity: 'payment_batch', entity_id: id,
      description: `Batch ${batch.batch_number} označen jako odeslaný do banky`,
      changes: { status: { from: batch.status, to: 'submitted_to_bank' } },
      user: req.user,
    }).catch(() => {});

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/accounting/payment-batches/:id/cancel — zruš batch (vrátí faktury do ready_to_pay)
router.post('/payment-batches/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const batch = await prisma.paymentBatch.findUnique({
      where: { id },
      include: { payments: { include: { allocations: true } } },
    });
    if (!batch) return res.status(404).json({ error: 'Batch nenalezen' });
    if (['processed', 'cancelled'].includes(batch.status)) {
      return res.status(400).json({ error: `Batch ve stavu "${batch.status}" nelze zrušit` });
    }

    const invoiceIds = [];
    for (const p of batch.payments) {
      for (const a of p.allocations) invoiceIds.push(a.invoice_id);
    }

    await prisma.$transaction(async tx => {
      // Vrátit faktury do ready_to_pay (jen pokud jsou stále v payment_queued)
      await tx.invoice.updateMany({
        where: { id: { in: invoiceIds }, status: 'payment_queued' },
        data: { status: 'ready_to_pay' },
      });
      // Smazat allocations a payments
      const paymentIds = batch.payments.map(p => p.id);
      await tx.paymentAllocation.deleteMany({ where: { payment_id: { in: paymentIds } } });
      await tx.payment.deleteMany({ where: { batch_id: id } });
      // Update batch status
      await tx.paymentBatch.update({
        where: { id },
        data: { status: 'cancelled' },
      });
    });

    logAudit({
      action: 'update', entity: 'payment_batch', entity_id: id,
      description: `Batch ${batch.batch_number} zrušen, ${invoiceIds.length} faktur vráceno do "K platbě"`,
      user: req.user,
    }).catch(() => {});

    res.json({ ok: true, returned_invoices: invoiceIds.length });
  } catch (err) { next(err); }
});

// DELETE /api/accounting/payment-batches/:id — smazání batche
// - Cancelled batch → smaže se okamžitě (allocations + payments už nejsou)
// - Jiný stav → vyžaduje ?force=true a super-admina:
//     * pro každou Payment s bank_transaction_id zavolá unmatchTransaction (vrátí paid_amount, smaže Payment+Allocation, reset bank tx)
//     * pro Payment bez bank_transaction_id (queued) vrátí faktury z payment_queued na ready_to_pay a smaže payment+allocation
//     * pak smaže batch
router.delete('/payment-batches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const force = req.query.force === 'true' || req.query.force === '1';
    const isSuperAdmin = !!req.user?.isSuperAdmin;

    const batch = await prisma.paymentBatch.findUnique({
      where: { id },
      include: {
        bank_account: { select: { name: true } },
        payments: {
          include: { allocations: { select: { invoice_id: true, amount: true } } },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: 'Batch nenalezen' });

    // Cancelled batch: payments už jsou smazané, jen smaž row
    if (batch.status === 'cancelled') {
      if (!isSuperAdmin) {
        return res.status(403).json({ error: 'Smazání zrušeného batche vyžaduje super-admin práva.' });
      }
      await prisma.paymentBatch.delete({ where: { id } });
      await logAudit({
        action: 'delete', entity: 'payment_batch', entity_id: id,
        description: `Smazán zrušený batch ${batch.batch_number} (${batch.bank_account.name})`,
        user: req.user, snapshot: batch,
      }).catch(() => {});
      return res.json({ ok: true, forced: false });
    }

    // Aktivní batch (draft, generated, submitted_to_bank, processed, rejected) — vyžaduje force
    const totalPayments = batch.payments.length;
    const matchedPayments = batch.payments.filter(p => p.bank_transaction_id).length;
    const queuedPayments = totalPayments - matchedPayments;

    if (!force || !isSuperAdmin) {
      return res.status(409).json({
        error: `Batch ${batch.batch_number} (stav: ${batch.status}) má aktivní platby. Použij Zrušit nebo super-admin force-delete.`,
        status: batch.status,
        total_payments: totalPayments,
        matched_payments: matchedPayments,
        queued_payments: queuedPayments,
        can_force: isSuperAdmin,
      });
    }

    // Force path — projdi všechny platby
    let unmatchedTxCount = 0;
    let restoredInvoiceCount = 0;

    for (const payment of batch.payments) {
      if (payment.bank_transaction_id) {
        // Platba je už spárovaná s bank tx → unmatch (vrátí paid_amount, smaže Payment+Allocation, reset bank tx)
        try {
          await unmatchTransaction(payment.bank_transaction_id, prisma, req.user);
          unmatchedTxCount++;
        } catch (err) {
          console.error(`[accounting] Force-delete batch ${id}: unmatch tx ${payment.bank_transaction_id} selhal:`, err.message);
          return res.status(500).json({
            error: `Nepodařilo se odpárovat bank transakci ${payment.bank_transaction_id}: ${err.message}. Některé platby už byly odpárovány.`,
          });
        }
      } else {
        // Payment je jen v batch (queued) → vrátit faktury + smazat payment+allocation
        const invoiceIds = payment.allocations.map(a => a.invoice_id);
        const restored = await prisma.invoice.updateMany({
          where: { id: { in: invoiceIds }, status: 'payment_queued' },
          data: { status: 'ready_to_pay' },
        });
        restoredInvoiceCount += restored.count;
        await prisma.paymentAllocation.deleteMany({ where: { payment_id: payment.id } });
        await prisma.payment.delete({ where: { id: payment.id } });
      }
    }

    // Smaž samotný batch
    await prisma.paymentBatch.delete({ where: { id } });

    await logAudit({
      action: 'delete', entity: 'payment_batch', entity_id: id,
      description:
        `Smazán batch ${batch.batch_number} (${batch.bank_account.name}, ` +
        `stav před: ${batch.status}) [FORCE: odpárováno ${unmatchedTxCount} bank tx, ` +
        `vráceno ${restoredInvoiceCount} faktur]`,
      user: req.user, snapshot: batch,
    }).catch(() => {});

    res.json({
      ok: true,
      forced: true,
      previous_status: batch.status,
      unmatched_tx_count: unmatchedTxCount,
      restored_invoice_count: restoredInvoiceCount,
    });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// FÁZE 7 — UPOMÍNKY (AR cron + manual)
// ────────────────────────────────────────────────────────────────────────────

const dunningWorker = require('../services/dunning-worker');
const { buildReminder } = require('../services/reminders/templates');
const { setSetting, getSetting } = require('../services/settings');

// GET /api/accounting/reminders — list odeslaných/scheduled upomínek
router.get('/reminders', async (req, res, next) => {
  try {
    const { status, invoice_id, limit = '100' } = req.query;
    const where = {};
    if (status) where.status = String(status);
    if (invoice_id) where.invoice_id = parseInt(invoice_id, 10);
    const reminders = await prisma.reminder.findMany({
      where,
      include: {
        invoice: {
          select: {
            id: true, invoice_number: true, total: true, currency: true, date_due: true,
            paid_amount: true, status: true,
            company: { select: { id: true, name: true, country: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(parseInt(limit, 10) || 100, 500),
    });
    res.json(reminders);
  } catch (err) { next(err); }
});

// GET /api/accounting/reminders/status — stav workeru + pause flag
router.get('/reminders/status', async (req, res, next) => {
  try {
    const workerStatus = dunningWorker.status();
    const pausedSetting = await prisma.appSetting.findUnique({
      where: { key: 'reminders_paused' },
    });
    const paused = pausedSetting && (pausedSetting.value === 'true' || pausedSetting.value === '1');
    res.json({ ...workerStatus, paused: !!paused });
  } catch (err) { next(err); }
});

// POST /api/accounting/reminders/pause — body { paused: true|false }
router.post('/reminders/pause', requireSuperAdmin, async (req, res, next) => {
  try {
    const paused = !!req.body?.paused;
    await setSetting('reminders_paused', paused ? 'true' : 'false', { type: 'boolean' });
    await logAudit({
      action: 'update', entity: 'app_setting', entity_id: 0,
      description: `Upomínky ${paused ? 'POZASTAVENY' : 'spuštěny'}`,
      user: req.user,
    }).catch(() => {});
    res.json({ ok: true, paused });
  } catch (err) { next(err); }
});

// POST /api/accounting/reminders/run-now — manuální spuštění workeru
router.post('/reminders/run-now', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await dunningWorker.triggerNow();
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/accounting/reminders/preview/:invoiceId/:level — náhled mailu (bez odeslání)
router.get('/reminders/preview/:invoiceId/:level', async (req, res, next) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId, 10);
    const level = parseInt(req.params.level, 10);
    if (![1, 2, 3].includes(level)) return res.status(400).json({ error: 'Level musí být 1, 2 nebo 3' });

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { company: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (invoice.direction !== 'ar') return res.status(400).json({ error: 'Upomínky lze posílat jen pro AR (vydané) faktury' });

    const ourCompany = await getOurCompany().catch(() => null);
    const us = { name: ourCompany?.name || 'Best Series s.r.o.', iban: ourCompany?.iban || null };
    const built = buildReminder({ level, invoice, partner: invoice.company, us });

    res.json({
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      to: invoice.company?.email || null,
      subject: built.subject,
      body: built.body,
      language: built.language,
      days_overdue: built.days_overdue,
    });
  } catch (err) { next(err); }
});

// POST /api/accounting/reminders/send/:invoiceId/:level — manuální odeslání jedné upomínky
router.post('/reminders/send/:invoiceId/:level', async (req, res, next) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId, 10);
    const level = parseInt(req.params.level, 10);
    if (![1, 2, 3].includes(level)) return res.status(400).json({ error: 'Level musí být 1, 2 nebo 3' });

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { company: true, reminders: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (invoice.direction !== 'ar') return res.status(400).json({ error: 'Upomínky lze posílat jen pro AR (vydané) faktury' });

    const existing = invoice.reminders.find(r => r.level === level && r.status === 'sent');
    if (existing) return res.status(409).json({ error: `Upomínka úrovně ${level} už byla odeslána ${existing.sent_at}` });

    const toEmail = req.body?.to || invoice.company?.email;
    if (!toEmail) return res.status(400).json({ error: 'Chybí email — odběratel ho nemá ve své Company.email a v body není override.' });

    const ourCompany = await getOurCompany().catch(() => null);
    const us = { name: ourCompany?.name || 'Best Series s.r.o.', iban: ourCompany?.iban || null };
    const built = buildReminder({ level, invoice, partner: invoice.company, us });

    // Vytvoř Reminder záznam s upsert (umí přepsat scheduled, ale ne sent)
    const reminder = await prisma.reminder.upsert({
      where: { invoice_id_level: { invoice_id: invoice.id, level } },
      create: {
        invoice_id: invoice.id, level,
        scheduled_at: new Date(),
        subject: built.subject, body: built.body,
        sent_to_email: toEmail, status: 'scheduled',
      },
      update: {
        subject: built.subject, body: built.body,
        sent_to_email: toEmail, status: 'scheduled',
      },
    });

    const fromUpn = process.env.INVOICE_IMAP_USER || 'faktury@bestseries.cz';
    const result = await sendMail({ to: toEmail, subject: built.subject, body: built.body, from: fromUpn });
    if (!result?.sent) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'bounced' } });
      return res.status(502).json({ error: result?.skipped || 'Odeslání selhalo' });
    }

    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { status: 'sent', sent_at: new Date() },
    });
    const reminderField = `reminder_${level}_sent_at`;
    const newStatus = level === 1 ? 'reminder_1_sent' : level === 2 ? 'reminder_2_sent' : 'reminder_3_sent';
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { [reminderField]: new Date(), status: newStatus },
    });
    await logAudit({
      action: 'reminder_sent', entity: 'invoice', entity_id: invoice.id,
      description: `Manuální upomínka ${level}/3 (${built.language}) odeslána na ${toEmail}, ${built.days_overdue} dní po splatnosti`,
      user: req.user,
    }).catch(() => {});

    res.json({ ok: true, reminder_id: reminder.id, language: built.language, days_overdue: built.days_overdue });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// FÁZE 6 — FAKTURY VYDANÉ (AR): autofill z Order, PDF export, e-mail
// ────────────────────────────────────────────────────────────────────────────

const fromOrderSchema = z.object({
  order_id: z.number().int().positive(),
  warehouse_document_id: z.number().int().positive().optional().nullable(),
  default_vat_rate: z.number().default(21),
  date_due: z.string().optional(),  // ISO string, jinak today + due_days
});

// POST /api/accounting/invoices/from-order — vytvoří draft AR fakturu z prodejní objednávky
router.post('/invoices/from-order', async (req, res, next) => {
  try {
    const parsed = fromOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }
    const { order_id, warehouse_document_id, default_vat_rate, date_due } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id: order_id },
      include: {
        company: true,
        items: { include: { material: true, product: true } },
      },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (order.type !== 'sales') {
      return res.status(400).json({ error: 'Faktura vydaná lze vytvořit jen z prodejní objednávky (type=sales)' });
    }

    // Validuj warehouse doc (pokud je předán)
    if (warehouse_document_id) {
      const wd = await prisma.warehouseDocument.findUnique({ where: { id: warehouse_document_id } });
      if (!wd) return res.status(400).json({ error: 'Skladový doklad neexistuje' });
    }

    // Vygeneruj číslo + datumy
    const invoiceNumber = await generateInvoiceNumber('issued');
    const dueDays = await getDefaultInvoiceDueDays();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = date_due ? new Date(date_due) : new Date(today.getTime() + dueDays * 86400000);

    // Spočítej položky
    const items = order.items.map((it, idx) => {
      const qty = Number(it.quantity);
      const unitPrice = Number(it.unit_price);
      const subtotal = qty * unitPrice;
      const vatAmount = subtotal * (default_vat_rate / 100);
      const total = subtotal + vatAmount;
      return {
        line_order: idx + 1,
        description: it.name + (it.product ? '' : (it.material ? ` (${it.material.code || ''})` : '')),
        quantity: qty,
        unit: it.unit || 'ks',
        unit_price: unitPrice,
        vat_rate: default_vat_rate,
        subtotal: subtotal.toFixed(2),
        vat_amount: vatAmount.toFixed(2),
        total: total.toFixed(2),
        order_item_id: it.id,
        material_id: it.material_id || null,
        product_id: it.product_id || null,
      };
    });
    const totalSubtotal = items.reduce((s, i) => s + Number(i.subtotal), 0);
    const totalVat = items.reduce((s, i) => s + Number(i.vat_amount), 0);
    const totalAmount = items.reduce((s, i) => s + Number(i.total), 0);

    // Variable symbol = invoice_number bez prefixu (pouze cifry)
    const vs = invoiceNumber.replace(/\D/g, '').slice(-10);

    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: invoiceNumber,
        type: 'issued',
        direction: 'ar',
        company_id: order.company_id,
        order_id: order.id,
        warehouse_document_id: warehouse_document_id || null,
        currency: 'CZK',
        exchange_rate: 1,
        subtotal: totalSubtotal.toFixed(2),
        vat_amount: totalVat.toFixed(2),
        total: totalAmount.toFixed(2),
        vat_regime: 'standard',
        date_issued: today,
        date_taxable: today,
        date_due: due,
        payment_method: 'bank_transfer',
        variable_symbol: vs,
        status: 'draft',
        source: 'from_order',
        created_by_id: req.user?.person?.id || null,
        created_by_user_id: req.user?.id || null,
        items: {
          create: items.map(it => ({
            line_order: it.line_order,
            description: it.description,
            quantity: it.quantity,
            unit: it.unit,
            unit_price: it.unit_price,
            vat_rate: it.vat_rate,
            subtotal: it.subtotal,
            vat_amount: it.vat_amount,
            total: it.total,
            order_item_id: it.order_item_id,
            material_id: it.material_id,
            product_id: it.product_id,
          })),
        },
      },
      include: { items: true, company: true },
    });

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'invoice',
      entity_id: invoice.id,
      description: `Faktura vydaná ${invoice.invoice_number} vytvořena z objednávky ${order.order_number || order.id}`,
      snapshot: invoice,
    }).catch(() => {});

    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

// GET /api/accounting/invoices/:id/pdf — vrátí PDF buffer (download)
router.get('/invoices/:id/pdf', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        company: true,
        items: { orderBy: { line_order: 'asc' } },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });

    const ourCompany = await getOurCompany();
    if (!ourCompany) {
      return res.status(400).json({
        error: 'Není nastavená naše firma — nastav `accounting.our_company_id` v Nastavení',
      });
    }

    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePdf(invoice, ourCompany);
    } catch (e) {
      console.error('[invoice-pdf] Generation failed:', e);
      return res.status(500).json({ error: 'PDF generování selhalo: ' + e.message });
    }

    const filename = `${invoice.invoice_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// POST /api/accounting/invoices/:id/send — pošle PDF e-mailem zákazníkovi
const sendInvoiceSchema = z.object({
  to: z.string().email().optional(), // jinak company.email
  subject: z.string().optional(),
  message: z.string().optional(),
});

router.post('/invoices/:id/send', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const parsed = sendInvoiceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        company: true,
        items: { orderBy: { line_order: 'asc' } },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (invoice.direction !== 'ar') {
      return res.status(400).json({ error: 'Posílat lze jen vydané faktury (AR)' });
    }

    const recipient = parsed.data.to || invoice.company?.email;
    if (!recipient) {
      return res.status(400).json({
        error: 'Odběratel nemá nastavený e-mail — zadej `to` v body, nebo doplň e-mail u firmy',
      });
    }

    const ourCompany = await getOurCompany();
    if (!ourCompany) {
      return res.status(400).json({
        error: 'Není nastavená naše firma — nastav `accounting.our_company_id` v Nastavení',
      });
    }

    // Vygeneruj PDF
    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePdf(invoice, ourCompany);
    } catch (e) {
      console.error('[invoice-pdf] Generation failed:', e);
      return res.status(500).json({ error: 'PDF generování selhalo: ' + e.message });
    }

    const subject = parsed.data.subject ||
      `Faktura ${invoice.invoice_number} od ${ourCompany.name}`;
    const body = parsed.data.message ||
      `Dobrý den,\n\nzasíláme fakturu ${invoice.invoice_number} se splatností ${new Date(invoice.date_due).toLocaleDateString('cs-CZ')}.\n\n` +
      `Celková částka: ${Number(invoice.total).toLocaleString('cs-CZ', { minimumFractionDigits: 2 })} ${invoice.currency}\n` +
      `Variabilní symbol: ${invoice.variable_symbol || invoice.invoice_number}\n\n` +
      `S pozdravem\n${ourCompany.name}`;

    // Odesílatel = e-mail přihlášeného uživatele (Graph send-as).
    // Fallback: fakturační e-mail naší firmy nebo SMTP_FROM z .env.
    const senderEmail = req.user?.person?.email || ourCompany.email || null;

    const result = await sendMail({
      from: senderEmail,
      to: recipient,
      subject,
      body,
      attachments: [{
        filename: `${invoice.invoice_number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    if (!result.sent) {
      return res.status(502).json({
        error: 'E-mail se nepodařilo odeslat',
        reason: result.skipped || result.error || 'unknown',
        hint: !senderEmail
          ? 'Tvůj uživatelský účet nemá vyplněný e-mail v Person profilu — doplň ho v Lidé a HR.'
          : null,
      });
    }

    // Update faktury — status sent
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        status: invoice.status === 'draft' ? 'sent' : invoice.status,
      },
    });

    await logAudit({
      user: req.user,
      action: 'send',
      entity: 'invoice',
      entity_id: id,
      description: `Faktura ${invoice.invoice_number} odeslaná na ${recipient} (z ${senderEmail || '?'} přes ${result.via || '?'})`,
      snapshot: { recipient, subject, sender: senderEmail, via: result.via, message_id: result.messageId },
    }).catch(() => {});

    res.json({
      ok: true,
      sent_to: recipient,
      sent_from: senderEmail,
      via: result.via, // 'graph' nebo 'smtp'
      message_id: result.messageId,
      invoice: updated,
    });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// OVĚŘENÍ BANKOVNÍHO ÚČTU (anti-podvod whitelist)
// ────────────────────────────────────────────────────────────────────────────

const { addToWhitelist, verifyAccount } = require('../services/banking/account-verification');

// POST /api/accounting/invoices/:id/verify-bank-account — přidá účet z faktury
// do whitelistu firmy (Company.verified_bank_accounts). Volat z UI tlačítkem
// "Potvrdit účet" v detailu faktury, kde verification.status je 'unknown' nebo 'mismatch'.
const verifyAccountSchema = z.object({
  note: z.string().optional(),
  override_mismatch: z.boolean().optional(), // pokud je status mismatch, super admin může přepsat
});

router.post('/invoices/:id/verify-bank-account', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });

    const parsed = verifyAccountSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true, verified_bank_accounts: true } } },
    });
    if (!invoice) return res.status(404).json({ error: 'Faktura nenalezena' });
    if (!invoice.company_id) return res.status(400).json({ error: 'Faktura nemá napojenou firmu — nelze přidat do whitelistu.' });
    if (!invoice.partner_bank_account && !invoice.partner_iban) {
      return res.status(400).json({ error: 'Faktura nemá vyplněný účet protistrany.' });
    }

    // Sanity check: pokud má firma jiné účty a tenhle nesedí, vyžaduj override flag
    const whitelist = Array.isArray(invoice.company.verified_bank_accounts)
      ? invoice.company.verified_bank_accounts : [];
    if (whitelist.length > 0 && !parsed.data.override_mismatch) {
      // Zkus rychlou shodu
      const verification = await verifyAccount({
        companyId: invoice.company_id,
        partnerBankAccount: invoice.partner_bank_account,
        partnerIban: invoice.partner_iban,
      });
      if (verification.status === 'mismatch') {
        return res.status(409).json({
          error: 'Firma má v whitelistu jiné účty. Pokud opravdu chceš přidat tento účet, pošli `override_mismatch: true` (vyžaduje vědomé rozhodnutí).',
          verification,
          existing_whitelist_count: whitelist.length,
        });
      }
    }

    const result = await addToWhitelist({
      companyId: invoice.company_id,
      account: invoice.partner_bank_account,
      iban: invoice.partner_iban,
      verifiedByUserId: req.user?.id,
      source: 'manual',
      note: parsed.data.note || `Potvrzeno z faktury ${invoice.invoice_number}`,
    });

    if (!result.added) {
      return res.json({ ok: true, message: 'Účet už ve whitelistu byl.', entry: result.entry });
    }

    await logAudit({
      action: 'update', entity: 'company', entity_id: invoice.company_id,
      description: `🔐 Účet ${invoice.partner_bank_account || invoice.partner_iban} přidán do whitelistu (${invoice.company.name}) z faktury ${invoice.invoice_number}${parsed.data.override_mismatch ? ' [OVERRIDE]' : ''}`,
      snapshot: { entry: result.entry },
      user: req.user,
    }).catch(() => {});

    res.json({ ok: true, message: 'Účet přidán do whitelistu firmy.', entry: result.entry, total: result.total });
  } catch (err) { next(err); }
});

module.exports = router;
