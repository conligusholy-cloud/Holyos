// HolyOS — Výrobní sloty: CRUD pro sloty, přiřazení zakázek, blokace
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── SLOTY ────────────────────────────────────────────────────────────────

// GET /api/slots — seznam slotů s filtrováním
router.get('/', async (req, res, next) => {
  try {
    const { from, to, workstation_id, status } = req.query;
    const where = {};
    if (from) where.start_date = { gte: new Date(from) };
    if (to) where.end_date = { ...(where.end_date || {}), lte: new Date(to) };
    if (workstation_id) where.workstation_id = parseInt(workstation_id);
    if (status) where.status = status;

    const slots = await prisma.productionSlot.findMany({
      where,
      include: {
        workstation: { select: { id: true, name: true, code: true } },
        assignments: {
          orderBy: { priority: 'desc' },
        },
        blocks: true,
        _count: { select: { assignments: true } },
      },
      orderBy: { start_date: 'asc' },
    });
    res.json(slots);
  } catch (err) {
    next(err);
  }
});

// GET /api/slots/:id — detail slotu
router.get('/:id', async (req, res, next) => {
  try {
    const slot = await prisma.productionSlot.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        workstation: { select: { id: true, name: true, code: true } },
        assignments: { orderBy: { priority: 'desc' } },
        blocks: { orderBy: { start_date: 'asc' } },
      },
    });
    if (!slot) return res.status(404).json({ error: 'Slot nenalezen' });
    res.json(slot);
  } catch (err) {
    next(err);
  }
});

// POST /api/slots — nový slot
router.post('/', async (req, res, next) => {
  try {
    const { name, workstation_id, start_date, end_date, capacity_hours, status, color, note } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Název, začátek a konec jsou povinné' });
    }
    const slot = await prisma.productionSlot.create({
      data: {
        name,
        workstation_id: workstation_id ? parseInt(workstation_id) : null,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        capacity_hours: capacity_hours ? parseFloat(capacity_hours) : 8,
        status: status || 'open',
        color: color || '#3b82f6',
        note: note || null,
      },
    });
    res.status(201).json(slot);
  } catch (err) {
    next(err);
  }
});

// PUT /api/slots/:id — úprava slotu
router.put('/:id', async (req, res, next) => {
  try {
    const { name, workstation_id, start_date, end_date, capacity_hours, status, color, note } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (workstation_id !== undefined) data.workstation_id = workstation_id ? parseInt(workstation_id) : null;
    if (start_date) data.start_date = new Date(start_date);
    if (end_date) data.end_date = new Date(end_date);
    if (capacity_hours !== undefined) data.capacity_hours = parseFloat(capacity_hours);
    if (status) data.status = status;
    if (color) data.color = color;
    if (note !== undefined) data.note = note;

    const slot = await prisma.productionSlot.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json(slot);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/slots/:id — smazání slotu
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.productionSlot.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PŘIŘAZENÍ ZAKÁZEK DO SLOTŮ ──────────────────────────────────────────

// POST /api/slots/:id/assignments — přiřadit zakázku do slotu
router.post('/:id/assignments', async (req, res, next) => {
  try {
    const { order_id, order_item_id, product_name, customer_name, quantity, estimated_hours, priority, note } = req.body;
    if (!product_name) return res.status(400).json({ error: 'Název produktu je povinný' });

    const assignment = await prisma.slotAssignment.create({
      data: {
        slot_id: parseInt(req.params.id),
        order_id: order_id ? parseInt(order_id) : null,
        order_item_id: order_item_id ? parseInt(order_item_id) : null,
        product_name,
        customer_name: customer_name || null,
        quantity: quantity ? parseFloat(quantity) : 1,
        estimated_hours: estimated_hours ? parseFloat(estimated_hours) : 0,
        priority: priority ? parseInt(priority) : 0,
        note: note || null,
      },
    });
    res.status(201).json(assignment);
  } catch (err) {
    next(err);
  }
});

// PUT /api/slots/assignments/:id — úprava přiřazení
router.put('/assignments/:id', async (req, res, next) => {
  try {
    const { product_name, customer_name, quantity, estimated_hours, priority, status, note, slot_id } = req.body;
    const data = {};
    if (product_name !== undefined) data.product_name = product_name;
    if (customer_name !== undefined) data.customer_name = customer_name;
    if (quantity !== undefined) data.quantity = parseFloat(quantity);
    if (estimated_hours !== undefined) data.estimated_hours = parseFloat(estimated_hours);
    if (priority !== undefined) data.priority = parseInt(priority);
    if (status) data.status = status;
    if (note !== undefined) data.note = note;
    if (slot_id) data.slot_id = parseInt(slot_id);

    const assignment = await prisma.slotAssignment.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json(assignment);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/slots/assignments/:id — odebrání zakázky ze slotu
router.delete('/assignments/:id', async (req, res, next) => {
  try {
    await prisma.slotAssignment.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── BLOKACE ──────────────────────────────────────────────────────────────

// POST /api/slots/:id/blocks — blokovat slot (dovolená, údržba, ...)
router.post('/:id/blocks', async (req, res, next) => {
  try {
    const { start_date, end_date, reason, block_type } = req.body;
    if (!start_date || !end_date || !reason) {
      return res.status(400).json({ error: 'Začátek, konec a důvod jsou povinné' });
    }
    const block = await prisma.slotBlock.create({
      data: {
        slot_id: parseInt(req.params.id),
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        reason,
        block_type: block_type || 'holiday',
      },
    });
    res.status(201).json(block);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/slots/blocks/:id — odebrat blokaci
router.delete('/blocks/:id', async (req, res, next) => {
  try {
    await prisma.slotBlock.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── STATISTIKY ───────────────────────────────────────────────────────────

// GET /api/slots/stats/overview — přehled pro dashboard
router.get('/stats/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const [total, open, blocked, assignments] = await Promise.all([
      prisma.productionSlot.count(),
      prisma.productionSlot.count({ where: { status: 'open' } }),
      prisma.productionSlot.count({ where: { status: 'blocked' } }),
      prisma.slotAssignment.count({ where: { status: { not: 'done' } } }),
    ]);
    res.json({ total, open, blocked, active_assignments: assignments });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
