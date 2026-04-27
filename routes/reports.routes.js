// HolyOS — Reporty nákladů per CostCenter (Fáze 9)
// Route prefix: /api/reports
// Náklady = AP faktury (InvoiceItem.total) + pokladní výdaje (CashMovement.out)
// AR příjmy se nesčítají (nejsou to náklady).
// Pokladní výdaje s purpose=invoice_payment se vyřazují (jinak double-count s fakturou).

'use strict';

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

router.use(requireAuth);

// ────────────────────────────────────────────────────────────────────────────
// HELPERY
// ────────────────────────────────────────────────────────────────────────────

const VALID_TYPES = ['vehicle', 'person', 'machine', 'project', 'department', 'general'];

const TYPE_LABELS = {
  vehicle: 'Auto',
  person: 'Osoba',
  machine: 'Stroj',
  project: 'Projekt',
  department: 'Oddělení',
  general: 'Obecné',
};

function parseDateRange(query) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), 0, 1); // 1. ledna letošního roku
  const from = query.from ? new Date(query.from) : defaultFrom;
  const to = query.to ? new Date(query.to) : new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  return { from, to };
}

const NEVER_PAYABLE_INVOICE = ['cancelled', 'written_off', 'draft'];

// ────────────────────────────────────────────────────────────────────────────
// COST CENTER CRUD
// ────────────────────────────────────────────────────────────────────────────

const ccCreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  type: z.enum(VALID_TYPES),
  parent_id: z.number().int().positive().nullable().optional(),
  vehicle_id: z.number().int().positive().nullable().optional(),
  person_id: z.number().int().positive().nullable().optional(),
  department_id: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const ccUpdateSchema = ccCreateSchema.partial();

function validateTypeLink(data) {
  // Vehicle/person/department typy by měly mít vyplněnou odpovídající FK.
  // Není to vynucené — manager může mít cost center "auto Felicia" bez vazby na konkrétní Vehicle.
  // Ale pokud FK je vyplněná, musí odpovídat typu.
  if (data.vehicle_id && data.type !== 'vehicle') {
    return 'vehicle_id lze nastavit jen pro type=vehicle';
  }
  if (data.person_id && data.type !== 'person') {
    return 'person_id lze nastavit jen pro type=person';
  }
  if (data.department_id && data.type !== 'department') {
    return 'department_id lze nastavit jen pro type=department';
  }
  return null;
}

// GET /api/reports/cost-centers — list
router.get('/cost-centers', async (req, res, next) => {
  try {
    const { type, active } = req.query;
    const where = {};
    if (type) where.type = String(type);
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;
    const ccs = await prisma.costCenter.findMany({
      where,
      include: {
        vehicle: { select: { id: true, license_plate: true, category: true, year: true } },
        person: { select: { id: true, first_name: true, last_name: true } },
        department: { select: { id: true, name: true } },
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, invoice_items: true, cash_movements: true } },
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    res.json(ccs);
  } catch (err) { next(err); }
});

// POST /api/reports/cost-centers — vytvoř
router.post('/cost-centers', requireSuperAdmin, async (req, res, next) => {
  try {
    const parsed = ccCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    const data = parsed.data;
    const linkErr = validateTypeLink(data);
    if (linkErr) return res.status(400).json({ error: linkErr });

    const created = await prisma.costCenter.create({
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        parent_id: data.parent_id || null,
        vehicle_id: data.vehicle_id || null,
        person_id: data.person_id || null,
        department_id: data.department_id || null,
        note: data.note || null,
        active: data.active ?? true,
      },
    });
    await logAudit({
      action: 'create', entity: 'cost_center', entity_id: created.id,
      description: `Cost center ${created.code} — ${created.name} (${created.type})`,
      user: req.user,
    }).catch(() => {});
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Code už existuje' });
    next(err);
  }
});

// PUT /api/reports/cost-centers/:id — uprav
router.put('/cost-centers/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = ccUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    const data = parsed.data;
    if (data.type) {
      const linkErr = validateTypeLink(data);
      if (linkErr) return res.status(400).json({ error: linkErr });
    }
    const updated = await prisma.costCenter.update({ where: { id }, data });
    await logAudit({
      action: 'update', entity: 'cost_center', entity_id: id,
      description: `Cost center ${updated.code} aktualizován`, user: req.user,
    }).catch(() => {});
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/reports/cost-centers/:id — smaž (jen pokud nemá vazby)
router.delete('/cost-centers/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cc = await prisma.costCenter.findUnique({
      where: { id },
      include: { _count: { select: { invoice_items: true, cash_movements: true, children: true } } },
    });
    if (!cc) return res.status(404).json({ error: 'CostCenter nenalezen' });
    const used = cc._count.invoice_items + cc._count.cash_movements + cc._count.children;
    if (used > 0) {
      return res.status(409).json({
        error: `CostCenter má ${cc._count.invoice_items} faktur, ${cc._count.cash_movements} pokladních pohybů a ${cc._count.children} podřízených. Smazat nelze — nejprve uvolni vazby nebo deaktivuj.`,
      });
    }
    await prisma.costCenter.delete({ where: { id } });
    await logAudit({
      action: 'delete', entity: 'cost_center', entity_id: id,
      description: `Smazán cost center ${cc.code}`, user: req.user, snapshot: cc,
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// REPORTY
// ────────────────────────────────────────────────────────────────────────────

// GET /api/reports/cost-centers/summary?from=&to=&type=
//   Pro každý aktivní CostCenter sečíst AP náklady + pokladní výdaje za období.
router.get('/cost-centers/summary', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const typeFilter = req.query.type ? String(req.query.type) : null;

    const ccWhere = { active: true };
    if (typeFilter) ccWhere.type = typeFilter;

    const ccs = await prisma.costCenter.findMany({
      where: ccWhere,
      include: {
        vehicle: { select: { id: true, license_plate: true, category: true, year: true } },
        person: { select: { id: true, first_name: true, last_name: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    if (ccs.length === 0) return res.json({ from, to, type: typeFilter, rows: [], totals: { invoices: 0, cash: 0, total: 0 } });

    const ccIds = ccs.map(c => c.id);

    // AP náklady — InvoiceItem.cost_center_id, omezeno faktury direction=ap a status ne-zruseny
    const itemAggs = await prisma.invoiceItem.groupBy({
      by: ['cost_center_id'],
      where: {
        cost_center_id: { in: ccIds },
        invoice: {
          direction: 'ap',
          status: { notIn: NEVER_PAYABLE_INVOICE },
          date_issued: { gte: from, lte: to },
        },
      },
      _sum: { total: true },
      _count: { _all: true },
    });
    const apMap = new Map(itemAggs.map(a => [a.cost_center_id, { total: Number(a._sum.total || 0), count: a._count._all }]));

    // Pokladní výdaje — CashMovement.cost_center_id, direction=out, purpose != invoice_payment (vyřazujeme double-count)
    const cmAggs = await prisma.cashMovement.groupBy({
      by: ['cost_center_id'],
      where: {
        cost_center_id: { in: ccIds },
        direction: 'out',
        purpose: { not: 'invoice_payment' },
        date: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const cashMap = new Map(cmAggs.map(a => [a.cost_center_id, { total: Number(a._sum.amount || 0), count: a._count._all }]));

    const rows = ccs.map(cc => {
      const ap = apMap.get(cc.id) || { total: 0, count: 0 };
      const cash = cashMap.get(cc.id) || { total: 0, count: 0 };
      return {
        id: cc.id,
        code: cc.code,
        name: cc.name,
        type: cc.type,
        type_label: TYPE_LABELS[cc.type] || cc.type,
        linked: cc.vehicle ? `${cc.vehicle.license_plate} ${cc.vehicle.category || ''} ${cc.vehicle.year || ''}`.trim()
              : cc.person ? `${cc.person.first_name || ''} ${cc.person.last_name || ''}`.trim()
              : cc.department ? cc.department.name
              : null,
        invoices_total: ap.total,
        invoices_count: ap.count,
        cash_total: cash.total,
        cash_count: cash.count,
        total: ap.total + cash.total,
      };
    }).sort((a, b) => b.total - a.total);

    const totals = rows.reduce((acc, r) => ({
      invoices: acc.invoices + r.invoices_total,
      cash: acc.cash + r.cash_total,
      total: acc.total + r.total,
    }), { invoices: 0, cash: 0, total: 0 });

    res.json({ from, to, type: typeFilter, rows, totals });
  } catch (err) { next(err); }
});

// GET /api/reports/cost-centers/by-type?from=&to=
//   Agregace nákladů per type (vehicle/person/...) — pro pie chart.
router.get('/cost-centers/by-type', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);

    // AP: groupBy cost_center type — Prisma groupBy nepodporuje join group, takže přes raw SQL
    // (jednodušší než dvě query a slučování v JS). Ale pojďme přes JS, ať si vystačíme s Prisma.
    const ccs = await prisma.costCenter.findMany({
      where: { active: true },
      select: { id: true, type: true },
    });
    const typeById = new Map(ccs.map(c => [c.id, c.type]));
    const ccIds = ccs.map(c => c.id);

    if (ccIds.length === 0) return res.json({ from, to, rows: [], totals: { invoices: 0, cash: 0, total: 0 } });

    const itemAggs = await prisma.invoiceItem.groupBy({
      by: ['cost_center_id'],
      where: {
        cost_center_id: { in: ccIds },
        invoice: {
          direction: 'ap',
          status: { notIn: NEVER_PAYABLE_INVOICE },
          date_issued: { gte: from, lte: to },
        },
      },
      _sum: { total: true },
    });
    const cmAggs = await prisma.cashMovement.groupBy({
      by: ['cost_center_id'],
      where: {
        cost_center_id: { in: ccIds },
        direction: 'out',
        purpose: { not: 'invoice_payment' },
        date: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });

    // Sloučit podle typu
    const byType = {};
    for (const t of VALID_TYPES) byType[t] = { invoices: 0, cash: 0 };
    for (const a of itemAggs) {
      const t = typeById.get(a.cost_center_id) || 'general';
      byType[t].invoices += Number(a._sum.total || 0);
    }
    for (const a of cmAggs) {
      const t = typeById.get(a.cost_center_id) || 'general';
      byType[t].cash += Number(a._sum.amount || 0);
    }

    const rows = VALID_TYPES.map(t => ({
      type: t,
      type_label: TYPE_LABELS[t],
      invoices: byType[t].invoices,
      cash: byType[t].cash,
      total: byType[t].invoices + byType[t].cash,
    })).filter(r => r.total > 0).sort((a, b) => b.total - a.total);

    const totals = rows.reduce((acc, r) => ({
      invoices: acc.invoices + r.invoices,
      cash: acc.cash + r.cash,
      total: acc.total + r.total,
    }), { invoices: 0, cash: 0, total: 0 });

    res.json({ from, to, rows, totals });
  } catch (err) { next(err); }
});

// GET /api/reports/cost-centers/:id/detail?from=&to=
//   Drill-down: jednotlivé InvoiceItem řádky + CashMovement pohyby
router.get('/cost-centers/:id/detail', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { from, to } = parseDateRange(req.query);

    const cc = await prisma.costCenter.findUnique({ where: { id } });
    if (!cc) return res.status(404).json({ error: 'CostCenter nenalezen' });

    const items = await prisma.invoiceItem.findMany({
      where: {
        cost_center_id: id,
        invoice: {
          direction: 'ap',
          status: { notIn: NEVER_PAYABLE_INVOICE },
          date_issued: { gte: from, lte: to },
        },
      },
      include: {
        invoice: {
          select: {
            id: true, invoice_number: true, external_number: true,
            date_issued: true, total: true, currency: true, status: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { invoice: { date_issued: 'desc' } },
      take: 500,
    });

    const movements = await prisma.cashMovement.findMany({
      where: {
        cost_center_id: id,
        direction: 'out',
        purpose: { not: 'invoice_payment' },
        date: { gte: from, lte: to },
      },
      include: {
        cash_register: { select: { id: true, name: true, currency: true } },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });

    res.json({
      cost_center: cc,
      from, to,
      invoice_items: items,
      cash_movements: movements,
      summary: {
        invoices_total: items.reduce((s, i) => s + Number(i.total), 0),
        cash_total: movements.reduce((s, m) => s + Number(m.amount), 0),
      },
    });
  } catch (err) { next(err); }
});

// GET /api/reports/cost-centers/:id/timeseries?months=12
//   Měsíční časová řada nákladů pro konkrétní cost center.
router.get('/cost-centers/:id/timeseries', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 36);

    const cc = await prisma.costCenter.findUnique({ where: { id }, select: { id: true, code: true, name: true, type: true } });
    if (!cc) return res.status(404).json({ error: 'CostCenter nenalezen' });

    const now = new Date();
    const firstMonth = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

    // Vyrobit plný seznam měsíců
    const monthsArr = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
      monthsArr.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        invoices: 0,
        cash: 0,
        total: 0,
      });
    }

    const lastMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Načíst všechny InvoiceItem v období
    const items = await prisma.invoiceItem.findMany({
      where: {
        cost_center_id: id,
        invoice: {
          direction: 'ap',
          status: { notIn: NEVER_PAYABLE_INVOICE },
          date_issued: { gte: firstMonth, lte: lastMonth },
        },
      },
      select: {
        total: true,
        invoice: { select: { date_issued: true } },
      },
    });
    for (const it of items) {
      const d = new Date(it.invoice.date_issued);
      const idx = (d.getFullYear() - firstMonth.getFullYear()) * 12 + (d.getMonth() - firstMonth.getMonth());
      if (idx >= 0 && idx < months) monthsArr[idx].invoices += Number(it.total);
    }

    const movements = await prisma.cashMovement.findMany({
      where: {
        cost_center_id: id,
        direction: 'out',
        purpose: { not: 'invoice_payment' },
        date: { gte: firstMonth, lte: lastMonth },
      },
      select: { amount: true, date: true },
    });
    for (const mv of movements) {
      const d = new Date(mv.date);
      const idx = (d.getFullYear() - firstMonth.getFullYear()) * 12 + (d.getMonth() - firstMonth.getMonth());
      if (idx >= 0 && idx < months) monthsArr[idx].cash += Number(mv.amount);
    }

    for (const m of monthsArr) m.total = m.invoices + m.cash;

    res.json({ cost_center: cc, months: monthsArr });
  } catch (err) { next(err); }
});

module.exports = router;
