// HolyOS — Pokladna (Fáze 8)
// Route prefix: /api/cash
// CashRegister + CashMovement, paragon upload, reconciliation, číselné řady P/V{year}{seq6}.

'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

router.use(requireAuth);

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');

// ────────────────────────────────────────────────────────────────────────────
// HELPERY
// ────────────────────────────────────────────────────────────────────────────

const VALID_PURPOSES = [
  'invoice_payment',   // úhrada faktury hotově
  'fuel',              // PHM
  'salary_advance',    // záloha zaměstnanci
  'petty_cash_top_up', // dotace pokladny z banky
  'sale',              // prodej v hotovosti
  'refund',            // vratka
  'other',             // ostatní (vč. inventurního vyrovnání)
];

const VALID_DIRECTIONS = ['in', 'out'];

/** Generuje číslo dokladu P{year}{seq6} (in) nebo V{year}{seq6} (out). */
async function generateMovementNumber(direction) {
  const year = new Date().getFullYear();
  const prefix = (direction === 'in' ? 'P' : 'V') + String(year);
  const last = await prisma.cashMovement.findFirst({
    where: { document_number: { startsWith: prefix } },
    orderBy: { document_number: 'desc' },
    select: { document_number: true },
  });
  let next = 1;
  if (last) {
    const seq = parseInt(last.document_number.slice(prefix.length), 10);
    if (Number.isFinite(seq)) next = seq + 1;
  }
  return prefix + String(next).padStart(6, '0');
}

/** Vyrobí "Hlavní pokladna" CZK, pokud žádná aktivní pokladna ještě není. */
async function ensureDefaultRegister() {
  const count = await prisma.cashRegister.count({ where: { active: true } });
  if (count > 0) return null;
  return prisma.cashRegister.create({
    data: {
      name: 'Hlavní pokladna',
      currency: 'CZK',
      location: 'Sídlo firmy',
      opening_balance: 0,
      current_balance: 0,
      active: true,
    },
  });
}

/** Uloží base64 paragon do storage/cash/<movementId>/ a vrátí relativní url. */
function saveReceiptBase64(movementId, base64, originalName, mime) {
  const folder = path.join(STORAGE_DIR, 'cash', String(movementId));
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  const ext = path.extname(originalName || '') || '.bin';
  const uniqueName = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(folder, uniqueName);
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return {
    url: `/api/storage/files/cash/${movementId}/${uniqueName}`,
    abs_path: filePath,
    size: buffer.length,
    mime: mime || null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// SCHEMATA
// ────────────────────────────────────────────────────────────────────────────

const registerCreateSchema = z.object({
  name: z.string().min(1).max(100),
  currency: z.string().length(3).default('CZK'),
  location: z.string().max(255).optional().nullable(),
  responsible_id: z.number().int().positive().optional().nullable(),
  opening_balance: z.number().nonnegative().default(0),
});

const registerUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.string().max(255).optional().nullable(),
  responsible_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

const movementCreateSchema = z.object({
  date: z.string().optional(), // ISO date, default today
  direction: z.enum(['in', 'out']),
  amount: z.number().positive(),
  purpose: z.enum(VALID_PURPOSES),
  description: z.string().min(1).max(500),
  invoice_id: z.number().int().positive().optional().nullable(),
  cost_center_id: z.number().int().positive().optional().nullable(),
});

const reconcileSchema = z.object({
  actual_balance: z.number(),
  note: z.string().max(500).optional().nullable(),
});

// ────────────────────────────────────────────────────────────────────────────
// CASH REGISTERS — CRUD
// ────────────────────────────────────────────────────────────────────────────

// GET /api/cash/registers — seznam (aktivní první)
router.get('/registers', async (req, res, next) => {
  try {
    // Auto-seed první pokladnu
    await ensureDefaultRegister();
    const registers = await prisma.cashRegister.findMany({
      orderBy: [{ active: 'desc' }, { id: 'asc' }],
      include: {
        responsible: { select: { id: true, first_name: true, last_name: true, email: true } },
        _count: { select: { movements: true } },
      },
    });
    res.json(registers);
  } catch (err) { next(err); }
});

// POST /api/cash/registers — nová pokladna (super admin)
router.post('/registers', requireSuperAdmin, async (req, res, next) => {
  try {
    const parsed = registerCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    const data = parsed.data;
    const created = await prisma.cashRegister.create({
      data: {
        name: data.name,
        currency: data.currency,
        location: data.location || null,
        responsible_id: data.responsible_id || null,
        opening_balance: data.opening_balance,
        current_balance: data.opening_balance,
        active: true,
      },
    });
    await logAudit({
      action: 'create', entity: 'cash_register', entity_id: created.id,
      description: `Nová pokladna ${created.name} (${created.currency}, opening ${data.opening_balance})`,
      user: req.user,
    }).catch(() => {});
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /api/cash/registers/:id — detail
router.get('/registers/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const reg = await prisma.cashRegister.findUnique({
      where: { id },
      include: {
        responsible: { select: { id: true, first_name: true, last_name: true, email: true } },
        _count: { select: { movements: true } },
      },
    });
    if (!reg) return res.status(404).json({ error: 'Pokladna nenalezena' });
    res.json(reg);
  } catch (err) { next(err); }
});

// PUT /api/cash/registers/:id — update (super admin)
router.put('/registers/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = registerUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    const updated = await prisma.cashRegister.update({ where: { id }, data: parsed.data });
    await logAudit({
      action: 'update', entity: 'cash_register', entity_id: id,
      description: `Pokladna ${updated.name} aktualizována`,
      user: req.user,
    }).catch(() => {});
    res.json(updated);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// MOVEMENTS — list, create, detail, delete, paragon upload, reconciliation
// ────────────────────────────────────────────────────────────────────────────

// GET /api/cash/registers/:id/movements — seznam pohybů + filtry
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD&direction=in|out&purpose=...&limit=200
router.get('/registers/:id/movements', async (req, res, next) => {
  try {
    const cashRegisterId = parseInt(req.params.id, 10);
    const where = { cash_register_id: cashRegisterId };
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date.gte = new Date(req.query.from);
      if (req.query.to) where.date.lte = new Date(req.query.to);
    }
    if (req.query.direction) where.direction = String(req.query.direction);
    if (req.query.purpose) where.purpose = String(req.query.purpose);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const movements = await prisma.cashMovement.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        invoice: { select: { id: true, invoice_number: true, total: true, currency: true } },
        cost_center: { select: { id: true, name: true, type: true } },
        created_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    res.json(movements);
  } catch (err) { next(err); }
});

// POST /api/cash/registers/:id/movements — nový pohyb
router.post('/registers/:id/movements', async (req, res, next) => {
  try {
    const cashRegisterId = parseInt(req.params.id, 10);
    const parsed = movementCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    const data = parsed.data;

    const reg = await prisma.cashRegister.findUnique({ where: { id: cashRegisterId } });
    if (!reg) return res.status(404).json({ error: 'Pokladna nenalezena' });
    if (!reg.active) return res.status(400).json({ error: 'Pokladna je deaktivovaná' });

    const docNumber = await generateMovementNumber(data.direction);
    const date = data.date ? new Date(data.date) : new Date();
    date.setHours(0, 0, 0, 0);

    // Atomicky: vytvoř pohyb + uprav balance
    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.cashMovement.create({
        data: {
          cash_register_id: cashRegisterId,
          date,
          document_number: docNumber,
          direction: data.direction,
          amount: data.amount,
          purpose: data.purpose,
          description: data.description,
          invoice_id: data.invoice_id || null,
          cost_center_id: data.cost_center_id || null,
          created_by_id: req.user?.person?.id || req.user?.id || null,
        },
      });
      const delta = data.direction === 'in' ? data.amount : -data.amount;
      const newBalance = Number(reg.current_balance) + delta;
      await tx.cashRegister.update({
        where: { id: cashRegisterId },
        data: { current_balance: newBalance },
      });
      return { movement, newBalance };
    });

    await logAudit({
      action: 'create', entity: 'cash_movement', entity_id: result.movement.id,
      description: `${docNumber} ${data.direction === 'in' ? 'PŘÍJEM' : 'VÝDAJ'} ${data.amount} ${reg.currency} (${data.purpose}): ${data.description}`,
      user: req.user,
    }).catch(() => {});

    res.status(201).json({ ...result.movement, current_balance: result.newBalance });
  } catch (err) { next(err); }
});

// GET /api/cash/movements/:id — detail
router.get('/movements/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const m = await prisma.cashMovement.findUnique({
      where: { id },
      include: {
        cash_register: { select: { id: true, name: true, currency: true } },
        invoice: { select: { id: true, invoice_number: true, total: true } },
        cost_center: true,
        created_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!m) return res.status(404).json({ error: 'Pohyb nenalezen' });
    res.json(m);
  } catch (err) { next(err); }
});

// DELETE /api/cash/movements/:id — smazat (super admin), reverse balance
router.delete('/movements/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const m = await prisma.cashMovement.findUnique({ where: { id }, include: { cash_register: true } });
    if (!m) return res.status(404).json({ error: 'Pohyb nenalezen' });

    await prisma.$transaction(async (tx) => {
      // Reverse balance: in → snížit, out → zvýšit
      const delta = m.direction === 'in' ? -Number(m.amount) : Number(m.amount);
      await tx.cashRegister.update({
        where: { id: m.cash_register_id },
        data: { current_balance: Number(m.cash_register.current_balance) + delta },
      });
      // Smaž paragon ze storage
      if (m.receipt_file_path) {
        try { fs.unlinkSync(m.receipt_file_path); } catch {}
      }
      await tx.cashMovement.delete({ where: { id } });
    });

    await logAudit({
      action: 'delete', entity: 'cash_movement', entity_id: id,
      description: `Smazán pohyb ${m.document_number} ${m.direction} ${m.amount}, balance vrácen`,
      user: req.user, snapshot: m,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/cash/movements/:id/receipt — upload paragonu (base64 v body)
router.post('/movements/:id/receipt', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { file_data, file_name, mime_type } = req.body || {};
    if (!file_data) return res.status(400).json({ error: 'Chybí file_data (base64)' });

    const m = await prisma.cashMovement.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ error: 'Pohyb nenalezen' });

    // Smaž starý paragon, pokud existuje
    if (m.receipt_file_path) {
      try { fs.unlinkSync(m.receipt_file_path); } catch {}
    }

    const saved = saveReceiptBase64(id, file_data, file_name, mime_type);
    const updated = await prisma.cashMovement.update({
      where: { id },
      data: { receipt_file_path: saved.abs_path },
    });
    await logAudit({
      action: 'update', entity: 'cash_movement', entity_id: id,
      description: `Paragon nahrán k ${m.document_number} (${saved.size} B)`,
      user: req.user,
    }).catch(() => {});
    res.json({ ok: true, url: saved.url, size: saved.size });
  } catch (err) { next(err); }
});

// DELETE /api/cash/movements/:id/receipt — smaž paragon
router.delete('/movements/:id/receipt', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const m = await prisma.cashMovement.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ error: 'Pohyb nenalezen' });
    if (!m.receipt_file_path) return res.json({ ok: true, message: 'Paragon tam nebyl' });
    try { fs.unlinkSync(m.receipt_file_path); } catch {}
    await prisma.cashMovement.update({ where: { id }, data: { receipt_file_path: null } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/cash/registers/:id/reconcile — inventura, body: { actual_balance, note? }
//   Pokud actual_balance ≠ current_balance, vyrobí korekční CashMovement (purpose=other)
//   a srovná balance. Vrátí { ok, difference, correction_movement_id|null }
router.post('/registers/:id/reconcile', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = reconcileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validace selhala', details: parsed.error.issues });
    const { actual_balance, note } = parsed.data;

    const reg = await prisma.cashRegister.findUnique({ where: { id } });
    if (!reg) return res.status(404).json({ error: 'Pokladna nenalezena' });

    const expected = Number(reg.current_balance);
    const diff = Number(actual_balance) - expected;

    let correctionId = null;
    if (Math.abs(diff) >= 0.01) {
      // Vytvoř korekční pohyb
      const direction = diff > 0 ? 'in' : 'out';
      const docNumber = await generateMovementNumber(direction);
      const correctionDate = new Date();
      correctionDate.setHours(0, 0, 0, 0);
      const corr = await prisma.cashMovement.create({
        data: {
          cash_register_id: id,
          date: correctionDate,
          document_number: docNumber,
          direction,
          amount: Math.abs(diff),
          purpose: 'other',
          description: `Inventura — vyrovnání rozdílu (očekávaný ${expected.toFixed(2)} ${reg.currency}, skutečný ${Number(actual_balance).toFixed(2)}). ${note || ''}`.trim(),
          created_by_id: req.user?.person?.id || req.user?.id || null,
        },
      });
      correctionId = corr.id;
    }

    const updated = await prisma.cashRegister.update({
      where: { id },
      data: {
        current_balance: actual_balance,
        last_reconciled_at: new Date(),
      },
    });

    await logAudit({
      action: 'reconcile', entity: 'cash_register', entity_id: id,
      description: `Inventura: očekávaný ${expected.toFixed(2)}, skutečný ${Number(actual_balance).toFixed(2)}, rozdíl ${diff.toFixed(2)} ${reg.currency}`,
      user: req.user,
    }).catch(() => {});

    res.json({
      ok: true,
      expected_balance: expected,
      actual_balance: Number(actual_balance),
      difference: diff,
      correction_movement_id: correctionId,
      register: updated,
    });
  } catch (err) { next(err); }
});

// GET /api/cash/purposes — číselník hodnot purpose
router.get('/purposes', (req, res) => {
  res.json([
    { value: 'invoice_payment',   label: 'Úhrada faktury' },
    { value: 'fuel',              label: 'Pohonné hmoty' },
    { value: 'salary_advance',    label: 'Záloha zaměstnanci' },
    { value: 'petty_cash_top_up', label: 'Dotace pokladny z banky' },
    { value: 'sale',              label: 'Tržba (prodej)' },
    { value: 'refund',            label: 'Vratka' },
    { value: 'other',             label: 'Ostatní' },
  ]);
});

module.exports = router;
