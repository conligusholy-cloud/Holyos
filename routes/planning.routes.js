// =============================================================================
// HolyOS — Planning routes (BomSnapshot, MRP, weekly/daily plan)
// =============================================================================
//
// Plánovací API. Zatím jen F2.5 BomSnapshot, později se sem přidá:
//   - F3 weekly-plan, daily-plan
//   - F4 mrp-run
//   - F5 slot-health-score

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { generateBatchOperationsForBatch } = require('../services/planning/batch-operations');
const { computeMrpForBatch } = require('../services/planning/mrp');
const { computePrePickForBatch } = require('../services/planning/pre-pick');
const { computePurchaseReport } = require('../services/planning/purchase-report');

// =============================================================================
// BOM SNAPSHOTS — zamražený kusovník pro plánování dávky
// =============================================================================

// POST /api/planning/snapshot-bom
//   body: { product_id (povinné), variant_key?, source? ('computed'|'factorify_pull'|'manual'),
//           source_ref?, note? }
//   Vyrobí nový BomSnapshot + BomSnapshotItem z aktuálních ProductOperation/OperationMaterial.
//   Snapshot je nezávislý na pozdějších změnách BOM — plánovač ho použije jako frozen view.
//
//   POZN: Pro V1 generuje flat snapshot (depth=0) z přímých OperationMaterial.
//   Rekurze přes sub-produkty (polotovary → materiály) je TODO (F4 MRP rozšíření).
router.post('/snapshot-bom', async (req, res, next) => {
  try {
    const { product_id, variant_key, source, source_ref, note } = req.body || {};
    const productId = parseInt(product_id, 10);
    if (isNaN(productId)) return res.status(400).json({ error: 'product_id je povinné' });

    // Ověř produkt
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, code: true, name: true },
    });
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });

    // Načti operace + materiály
    const operations = await prisma.productOperation.findMany({
      where: { product_id: productId },
      include: { materials: true },
      orderBy: { step_number: 'asc' },
    });

    if (operations.length === 0) {
      return res.status(400).json({ error: 'Produkt nemá žádné operace — BOM nelze sestavit' });
    }

    // Sestav položky snapshotu — flat, depth=0
    const items = [];
    for (const op of operations) {
      for (const om of op.materials) {
        items.push({
          material_id: om.material_id,
          source_operation_id: op.id,
          quantity: om.quantity,
          unit: om.unit || 'ks',
          depth: 0,
        });
      }
    }

    // Vytvoř snapshot + items v jedné transakci
    const snapshot = await prisma.$transaction(async (tx) => {
      const snap = await tx.bomSnapshot.create({
        data: {
          product_id: productId,
          variant_key: variant_key || null,
          source: source || 'computed',
          source_ref: source_ref || null,
          note: note || null,
        },
      });
      if (items.length > 0) {
        await tx.bomSnapshotItem.createMany({
          data: items.map(it => ({ ...it, snapshot_id: snap.id })),
        });
      }
      return snap;
    });

    // Vrátíme snapshot s items pro UI
    const full = await prisma.bomSnapshot.findUnique({
      where: { id: snapshot.id },
      include: {
        product: { select: { id: true, code: true, name: true } },
        items: {
          include: {
            material: { select: { id: true, code: true, name: true, unit: true } },
            source_operation: { select: { id: true, name: true, step_number: true } },
          },
        },
      },
    });

    res.status(201).json({
      ...full,
      stats: {
        operations_processed: operations.length,
        items_count: items.length,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/planning/snapshot-bom — seznam snapshotů
//   ?product_id=N
router.get('/snapshot-bom', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.product_id) where.product_id = parseInt(req.query.product_id, 10);

    const list = await prisma.bomSnapshot.findMany({
      where,
      include: {
        product: { select: { id: true, code: true, name: true } },
        _count: { select: { items: true, batches: true } },
      },
      orderBy: { snapshot_at: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// GET /api/planning/snapshot-bom/:id — detail snapshotu
router.get('/snapshot-bom/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const snap = await prisma.bomSnapshot.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, code: true, name: true } },
        items: {
          include: {
            material: { select: { id: true, code: true, name: true, unit: true } },
            source_operation: { select: { id: true, name: true, step_number: true } },
          },
          orderBy: [{ source_operation: { step_number: 'asc' } }, { material: { code: 'asc' } }],
        },
        batches: {
          select: { id: true, batch_number: true, status: true, quantity: true },
        },
      },
    });
    if (!snap) return res.status(404).json({ error: 'Snapshot nenalezen' });
    res.json(snap);
  } catch (err) { next(err); }
});

// DELETE /api/planning/snapshot-bom/:id — smaže snapshot (cascade na items).
//   Pozor: pokud na snapshot odkazuje ProductionBatch.bom_snapshot_id, FK má SetNull
//   (smazaný snapshot dávku nezruší, jen jí zruší vazbu).
router.delete('/snapshot-bom/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    await prisma.bomSnapshot.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Snapshot nenalezen' });
    next(err);
  }
});

// =============================================================================
// PLÁNOVAČ — GENERÁTOR BatchOperation Z PRODUKTOVÉHO POSTUPU (F3.1)
// =============================================================================

// POST /api/planning/batches/:id/generate-operations
//   Vygeneruje BatchOperation pro každou ProductOperation produktu dávky.
//   Idempotentní — pokud už BatchOperation existují, vrátí { skipped: true, existing_count: N }.
//
//   body (volitelné): { initial_status?: 'ready' | 'pending' }  — default 'ready'.
router.post('/batches/:id/generate-operations', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID dávky' });

    const initialStatus = req.body?.initial_status || 'ready';
    if (!['ready', 'pending'].includes(initialStatus)) {
      return res.status(400).json({ error: "initial_status musí být 'ready' nebo 'pending'" });
    }

    const result = await generateBatchOperationsForBatch(id, { initialStatus });
    res.status(result.skipped ? 200 : 201).json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// =============================================================================
// PLÁNOVAČ — MRP V1 (Material Requirements Planning) (F4)
// =============================================================================

// POST /api/planning/mrp-run
//   body: { batch_id }
//   Vrátí MRP analýzu pro jednu dávku — co potřebuje, co je na skladě,
//   čeho je shortage a návrh nákupních objednávek (po_proposals).
router.post('/mrp-run', async (req, res, next) => {
  try {
    const batchId = parseInt(req.body?.batch_id, 10);
    if (isNaN(batchId)) return res.status(400).json({ error: 'batch_id je povinné' });

    const result = await computeMrpForBatch(batchId);
    res.json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// =============================================================================
// PLÁNOVAČ — VYTÍŽENÍ PRACOVIŠŤ (queue summary)
// =============================================================================

// GET /api/planning/workstation-queue
//   Per pracoviště: počty pending/ready/in_progress/done_today + total planned minutes
//   pro nezpracované (operation.duration × batch.quantity), oldest waiting (kolik
//   dní BatchOperation visí ve frontě).
router.get('/workstation-queue', async (req, res, next) => {
  try {
    // Načti všechny aktivní BatchOperation (kromě done starší než dnes a cancelled)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const ops = await prisma.batchOperation.findMany({
      where: {
        OR: [
          { status: { in: ['pending', 'ready', 'in_progress'] } },
          { AND: [{ status: 'done' }, { finished_at: { gte: todayStart } }] },
        ],
      },
      select: {
        id: true, workstation_id: true, status: true, created_at: true, finished_at: true,
        batch: { select: { quantity: true } },
        operation: { select: { duration: true, duration_unit: true } },
      },
    });

    // Načti pracoviště pro lookup (jen ty s nějakou operací — buď v ops nebo i ostatní)
    const wsIds = Array.from(new Set(ops.map(o => o.workstation_id).filter(Boolean)));
    const wsAll = await prisma.workstation.findMany({
      where: wsIds.length > 0 ? { id: { in: wsIds } } : undefined,
      select: { id: true, name: true, code: true, flow_type: true,
        hall: { select: { name: true } } },
    });

    const wsMap = new Map(wsAll.map(w => [w.id, w]));

    // Helpér — operation.duration v minutách
    function opMinutes(op) {
      const d = op.operation?.duration || 0;
      const u = op.operation?.duration_unit || 'MINUTE';
      const qty = op.batch?.quantity || 1;
      const perKs = u === 'HOUR' ? d * 60 : u === 'SECOND' ? d / 60 : d;
      return perKs * qty;
    }

    // Group by workstation
    const groups = new Map(); // ws_id || 'null' → counters
    for (const o of ops) {
      const key = o.workstation_id || 'null';
      const cur = groups.get(key) || {
        workstation: o.workstation_id ? wsMap.get(o.workstation_id) : null,
        pending: 0, ready: 0, in_progress: 0, done_today: 0,
        planned_minutes: 0, oldest_waiting_at: null,
      };
      if (o.status === 'pending') {
        cur.pending++;
        cur.planned_minutes += opMinutes(o);
        if (!cur.oldest_waiting_at || o.created_at < cur.oldest_waiting_at) cur.oldest_waiting_at = o.created_at;
      } else if (o.status === 'ready') {
        cur.ready++;
        cur.planned_minutes += opMinutes(o);
        if (!cur.oldest_waiting_at || o.created_at < cur.oldest_waiting_at) cur.oldest_waiting_at = o.created_at;
      } else if (o.status === 'in_progress') {
        cur.in_progress++;
      } else if (o.status === 'done') {
        cur.done_today++;
      }
      groups.set(key, cur);
    }

    const now = Date.now();
    const result = Array.from(groups.values()).map(g => ({
      workstation: g.workstation || null,
      pending: g.pending,
      ready: g.ready,
      in_progress: g.in_progress,
      done_today: g.done_today,
      queue_total: g.pending + g.ready,
      planned_minutes: Math.round(g.planned_minutes),
      planned_hours: +(g.planned_minutes / 60).toFixed(1),
      oldest_waiting_days: g.oldest_waiting_at ? +((now - new Date(g.oldest_waiting_at).getTime()) / 86400000).toFixed(1) : null,
    }));

    // Sort: nejvyšší fronta první
    result.sort((a, b) => b.queue_total - a.queue_total || b.planned_minutes - a.planned_minutes);

    res.json({
      generated_at: new Date().toISOString(),
      workstations_count: result.length,
      summary: {
        total_pending: result.reduce((s, r) => s + r.pending, 0),
        total_ready: result.reduce((s, r) => s + r.ready, 0),
        total_in_progress: result.reduce((s, r) => s + r.in_progress, 0),
        total_done_today: result.reduce((s, r) => s + r.done_today, 0),
        total_planned_hours: +result.reduce((s, r) => s + r.planned_hours, 0).toFixed(1),
      },
      workstations: result,
    });
  } catch (err) { next(err); }
});

// =============================================================================
// PLÁNOVAČ — KONSOLIDOVANÝ NÁKUPNÍ REPORT (F4.5)
// =============================================================================

// GET /api/planning/purchase-report
//   ?statuses=planned,released,in_progress  (CSV — default je všech aktivních)
//   Vrátí materiály, které je třeba objednat napříč všemi dávkami.
router.get('/purchase-report', async (req, res, next) => {
  try {
    const statuses = req.query.statuses ? String(req.query.statuses).split(',').map(s => s.trim()).filter(Boolean) : null;
    const result = await computePurchaseReport({ statuses });
    res.json(result);
  } catch (err) { next(err); }
});

// =============================================================================
// PLÁNOVAČ — PRE-PICK V1 (F3.4) — návrh transferů na pracoviště
// =============================================================================

// POST /api/planning/batches/:id/pre-pick — spočítá návrh transferů.
// Volitelně GET pro lazy-load v UI.
router.post('/batches/:id/pre-pick', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const result = await computePrePickForBatch(id);
    res.json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.get('/batches/:id/pre-pick', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const result = await computePrePickForBatch(id);
    res.json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// GET /api/planning/batches/:id/mrp — kratší zápis pro UI lazy-load.
router.get('/batches/:id/mrp', async (req, res, next) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (isNaN(batchId)) return res.status(400).json({ error: 'Neplatné ID' });

    const result = await computeMrpForBatch(batchId);
    res.json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
