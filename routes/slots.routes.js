// HolyOS — Výrobní sloty: CRUD pro sloty, přiřazení zakázek, blokace
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, requireAuthOrApiKey } = require('../middleware/auth');

// Per-path autentizace:
//   /calendar*   → cookie NEBO X-API-Key (pro externí integrace)
//   vše ostatní  → pouze cookie (interní moduly HolyOS)
router.use((req, res, next) => {
  const isCalendar = req.path === '/calendar' || req.path.startsWith('/calendar/');
  if (isCalendar) return requireAuthOrApiKey(req, res, next);
  return requireAuth(req, res, next);
});

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
        // Natáhni zároveň položku objednávky kvůli výrobnímu číslu — přes FK order_item_id.
        // include místo zvlášť dotazovat → žádné N+1.
        assignments: {
          orderBy: { priority: 'desc' },
          include: {
            order_item: { select: { id: true, serial_number: true, name: true } },
          },
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

// ─── VEŘEJNÝ KALENDÁŘ (sanitizovaný pro externí stránky) ─────────────────
// GET /api/slots/calendar — naplněnost slotů BEZ detailů zakázek
router.get('/calendar', async (req, res, next) => {
  try {
    const { from, to, workstation_id } = req.query;
    const where = {};
    if (from) where.start_date = { gte: new Date(from) };
    if (to) where.end_date = { ...(where.end_date || {}), lte: new Date(to) };
    if (workstation_id) where.workstation_id = parseInt(workstation_id);

    const slots = await prisma.productionSlot.findMany({
      where,
      include: {
        workstation: { select: { id: true, name: true, code: true } },
        assignments: { select: { estimated_hours: true, quantity: true, status: true } },
        blocks: { select: { id: true, start_date: true, end_date: true, reason: true, block_type: true } },
      },
      orderBy: { start_date: 'asc' },
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const calendar = slots.map(s => {
      const start = new Date(s.start_date);
      const end = new Date(s.end_date);
      let workDays = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) workDays++;
      }
      const capacityTotal = Number(s.capacity_hours) * Math.max(workDays, 1);
      const usedHours = s.assignments.reduce((sum, a) => sum + Number(a.estimated_hours || 0), 0);
      const occupancyPct = capacityTotal > 0
        ? Math.min(100, Math.round((usedHours / capacityTotal) * 100))
        : 0;

      let derivedStatus = 'free';
      let label = 'Volno';
      const isBlocked = s.status === 'blocked' || (s.blocks && s.blocks.length > 0);
      if (isBlocked) {
        derivedStatus = 'blocked';
        label = 'Blokováno';
      } else if (end < now) {
        derivedStatus = 'expired';
        label = 'Prošlé';
      } else if (occupancyPct >= 100) {
        derivedStatus = 'full';
        label = 'Plno';
      } else if (s.assignments.length > 0) {
        derivedStatus = 'occupied';
        label = `Obsazeno ${occupancyPct} %`;
      }

      return {
        id: s.id,
        name: s.name,
        start_date: s.start_date,
        end_date: s.end_date,
        workstation: s.workstation,
        status: derivedStatus,
        label,
        occupancy_pct: occupancyPct,
        assignment_count: s.assignments.length,
        used_hours: Math.round(usedHours * 10) / 10,
        capacity_hours_per_day: Number(s.capacity_hours),
        capacity_total_hours: Math.round(capacityTotal * 10) / 10,
        color: s.color,
        is_blocked: isBlocked,
        blocks: s.blocks.map(b => ({
          id: b.id,
          start_date: b.start_date,
          end_date: b.end_date,
          reason: b.reason,
          block_type: b.block_type,
        })),
      };
    });

    res.json({
      range: { from: from || null, to: to || null },
      count: calendar.length,
      slots: calendar,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/slots/calendar/block — zablokovat období
router.post('/calendar/block', async (req, res, next) => {
  try {
    const { start_date, end_date, reason, block_type, capacity_hours } = req.body;
    if (!start_date || !end_date || !reason) {
      return res.status(400).json({ error: 'Začátek, konec a důvod jsou povinné' });
    }

    const slot = await prisma.productionSlot.create({
      data: {
        name: `Blokace: ${reason}`,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        capacity_hours: capacity_hours ? parseFloat(capacity_hours) : 8,
        status: 'blocked',
        color: '#dc2626',
        note: reason,
        blocks: {
          create: {
            start_date: new Date(start_date),
            end_date: new Date(end_date),
            reason,
            block_type: block_type || 'holiday',
          },
        },
      },
      include: { blocks: true },
    });

    res.status(201).json({
      id: slot.id,
      block_id: slot.blocks[0]?.id,
      start_date: slot.start_date,
      end_date: slot.end_date,
      reason,
      status: 'blocked',
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/slots/calendar/block/:slotId — zrušit blokaci
router.delete('/calendar/block/:slotId', async (req, res, next) => {
  try {
    const slotId = parseInt(req.params.slotId);
    const slot = await prisma.productionSlot.findUnique({ where: { id: slotId } });
    if (!slot) return res.status(404).json({ error: 'Slot nenalezen' });
    if (slot.status !== 'blocked') {
      return res.status(400).json({ error: 'Tento slot není blokace, smazání přes tento endpoint nelze' });
    }
    await prisma.productionSlot.delete({ where: { id: slotId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/slots/calendar/next-free?hours=X — nejbližší volný slot
router.get('/calendar/next-free', async (req, res, next) => {
  try {
    const neededHours = parseFloat(req.query.hours) || 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const slots = await prisma.productionSlot.findMany({
      where: {
        end_date: { gte: now },
        status: { notIn: ['blocked', 'closed'] },
      },
      include: {
        assignments: { select: { estimated_hours: true } },
        blocks: { select: { id: true } },
      },
      orderBy: { start_date: 'asc' },
    });

    for (const s of slots) {
      if (s.blocks.length > 0) continue;
      const start = new Date(s.start_date);
      const end = new Date(s.end_date);
      let workDays = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) workDays++;
      }
      const capacity = Number(s.capacity_hours) * Math.max(workDays, 1);
      const used = s.assignments.reduce((sum, a) => sum + Number(a.estimated_hours || 0), 0);
      const free = capacity - used;
      if (free >= neededHours) {
        return res.json({
          id: s.id,
          name: s.name,
          start_date: s.start_date,
          end_date: s.end_date,
          free_hours: Math.round(free * 10) / 10,
          needed_hours: neededHours,
        });
      }
    }
    res.status(404).json({ error: 'Žádný volný slot s dostatečnou kapacitou' });
  } catch (err) {
    next(err);
  }
});

// GET /api/slots/:id — detail slotu
// GET /api/slots/:id/health-score — vytížení slotu
//   Vrátí poměr SUM(estimated_hours z assignments) / (capacity_hours × pracovní_dny).
//   Pracovní_dny = počet dnů Po-Pá mezi start_date a end_date (včetně).
//   POZN: Per memory holyos_express_route_order — pevný podcestu nad dynamickou route.
router.get('/:id/health-score', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const slot = await prisma.productionSlot.findUnique({
      where: { id },
      include: { assignments: { select: { estimated_hours: true, status: true } } },
    });
    if (!slot) return res.status(404).json({ error: 'Slot nenalezen' });

    // Spočítej pracovní dny (Po-Pá) v intervalu start_date..end_date
    let workingDays = 0;
    const start = new Date(slot.start_date);
    const end = new Date(slot.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow >= 1 && dow <= 5) workingDays++;
    }
    if (workingDays === 0) workingDays = 1; // ochrana proti dělení nulou

    const capacityPerDay = Number(slot.capacity_hours) || 0;
    const capacityTotal = +(capacityPerDay * workingDays).toFixed(2);

    const totalEstimated = slot.assignments.reduce(
      (sum, a) => sum + (a.status === 'cancelled' ? 0 : Number(a.estimated_hours || 0)),
      0,
    );
    const utilizationPct = capacityTotal > 0 ? +(totalEstimated / capacityTotal * 100).toFixed(1) : 0;

    let status, color, label;
    if (capacityTotal === 0) {
      status = 'no_capacity'; color = 'gray'; label = 'Bez kapacity';
    } else if (utilizationPct < 70) {
      status = 'under'; color = '#22c55e'; label = 'Volná kapacita';
    } else if (utilizationPct < 90) {
      status = 'optimal'; color = '#14b8a6'; label = 'Optimální';
    } else if (utilizationPct <= 100) {
      status = 'full'; color = '#f59e0b'; label = 'Plně vytížený';
    } else {
      status = 'overloaded'; color = '#ef4444'; label = 'Přetížený';
    }

    res.json({
      slot_id: id,
      slot_name: slot.name,
      utilization_pct: utilizationPct,
      total_estimated_hours: +totalEstimated.toFixed(2),
      capacity_total_hours: capacityTotal,
      capacity_per_day: capacityPerDay,
      working_days: workingDays,
      assignments_count: slot.assignments.length,
      status, color, label,
    });
  } catch (err) { next(err); }
});

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

// DELETE /api/slots/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.productionSlot.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PŘIŘAZENÍ ZAKÁZEK ──────────────────────────────────────────────────

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

router.delete('/assignments/:id', async (req, res, next) => {
  try {
    await prisma.slotAssignment.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── BLOKACE ────────────────────────────────────────────────────────────

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

router.delete('/blocks/:id', async (req, res, next) => {
  try {
    await prisma.slotBlock.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── STATISTIKY ────────────────────────────────────────────────────────

router.get('/stats/overview', async (req, res, next) => {
  try {
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
