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
const { checkAndCloseBatch } = require('../services/planning/batch-state');
const { scheduleBatch } = require('../services/planning/scheduler');

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
// PLÁNOVAČ — WORKFLOW AKCE (pause / resume / cancel batch)
// =============================================================================

// Helper — bezpečně přepne status dávky podle whitelist of allowed transitions.
async function transitionBatchStatus(id, fromStatuses, toStatus, extraData = {}) {
  const existing = await prisma.productionBatch.findUnique({
    where: { id }, select: { status: true, batch_number: true },
  });
  if (!existing) {
    const err = new Error('Dávka nenalezena');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!fromStatuses.includes(existing.status)) {
    const err = new Error(`Nelze přejít ze stavu '${existing.status}' do '${toStatus}'`);
    err.code = 'BAD_TRANSITION';
    throw err;
  }
  return prisma.productionBatch.update({
    where: { id }, data: { status: toStatus, ...extraData },
    include: { product: { select: { code: true, name: true } } },
  });
}

function handleTransitionError(err, res, next) {
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
  if (err.code === 'BAD_TRANSITION') return res.status(409).json({ error: err.message });
  next(err);
}

// POST /api/planning/batches/:id/pause — released | in_progress → paused
router.post('/batches/:id/pause', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const updated = await transitionBatchStatus(id, ['released', 'in_progress'], 'paused');
    res.json(updated);
  } catch (err) { handleTransitionError(err, res, next); }
});

// POST /api/planning/batches/:id/resume — paused → in_progress
router.post('/batches/:id/resume', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const updated = await transitionBatchStatus(id, ['paused'], 'in_progress');
    res.json(updated);
  } catch (err) { handleTransitionError(err, res, next); }
});

// POST /api/planning/batches/:id/schedule
//   Naive sekvenční scheduling: nastaví planned_start/planned_end pro každou
//   BatchOperation. Ignoruje shift hours a queue na pracovišti (V1).
router.post('/batches/:id/schedule', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const result = await scheduleBatch(id);
    res.json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// POST /api/planning/batches/:id/check-completion
//   Auto-close: pokud všechny BatchOperation jsou done/cancelled, přepne batch
//   na 'done' (nebo 'cancelled' pokud žádná není done) a nastaví actual_end.
//   Idempotentní — vrací action: noop_* / auto_closed / auto_cancelled.
router.post('/batches/:id/check-completion', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const result = await checkAndCloseBatch(id);
    res.json(result);
  } catch (err) {
    if (/nenalezena/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// POST /api/planning/batches/:id/cancel — planned | released | paused → cancelled
//   in_progress nelze rovnou cancel (musí se nejdřív paused, vědomé rozhodnutí).
router.post('/batches/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const updated = await transitionBatchStatus(id, ['planned', 'released', 'paused'], 'cancelled');
    res.json(updated);
  } catch (err) { handleTransitionError(err, res, next); }
});

// =============================================================================
// PLÁNOVAČ — PROBLEM REPORTING (z kiosku)
// =============================================================================

// POST /api/planning/batch-operations/:id/problem
//   body: { person_id, note }
//   Pracovník hlásí problém s úkolem (chybí materiál, špatný výkres, ...).
//   Akce: BatchOperation.status → 'blocked', BatchOperationLog action='problem' + note.
//   Foreman pak v audit logu uvidí.
router.post('/batch-operations/:id/problem', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const personId = req.body?.person_id ? parseInt(req.body.person_id, 10) : null;
    const note = (req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'note je povinná — popiš problém' });

    const existing = await prisma.batchOperation.findUnique({
      where: { id }, select: { status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Operace nenalezena' });

    const result = await prisma.$transaction(async (tx) => {
      const op = await tx.batchOperation.update({
        where: { id },
        data: { status: 'blocked' },
      });
      await tx.batchOperationLog.create({
        data: { batch_operation_id: id, person_id: personId, action: 'problem', note },
      });
      return op;
    });

    res.json({ batch_operation: result, status_before: existing.status, action_logged: 'problem' });
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'Person neexistuje' });
    next(err);
  }
});

// POST /api/planning/batch-operations/:id/unblock
//   Foreman/admin uvolní zablokovanou operaci po vyřešení problému.
//   blocked → ready (defaultně) nebo zachová původní status, pokud je v body.
router.post('/batch-operations/:id/unblock', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const targetStatus = req.body?.target_status || 'ready';
    if (!['ready', 'pending', 'in_progress'].includes(targetStatus)) {
      return res.status(400).json({ error: "target_status musí být 'ready', 'pending' nebo 'in_progress'" });
    }
    const note = (req.body?.note || '').trim() || null;
    const personId = req.body?.person_id ? parseInt(req.body.person_id, 10) : null;

    const existing = await prisma.batchOperation.findUnique({
      where: { id }, select: { status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Operace nenalezena' });
    if (existing.status !== 'blocked') {
      return res.status(409).json({ error: `Nelze unblockovat ze stavu '${existing.status}', musí být 'blocked'` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const op = await tx.batchOperation.update({
        where: { id }, data: { status: targetStatus },
      });
      await tx.batchOperationLog.create({
        data: { batch_operation_id: id, person_id: personId, action: 'comment',
          note: `Unblock → ${targetStatus}` + (note ? ': ' + note : '') },
      });
      return op;
    });

    res.json({ batch_operation: result, status_before: 'blocked', status_after: targetStatus });
  } catch (err) { next(err); }
});

// =============================================================================
// PLÁNOVAČ — AUDIT LOG (BatchOperationLog query)
// =============================================================================

// GET /api/planning/audit-log
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD       (default: dnes)
//   ?person_id=N&batch_id=N&action=start|pause|resume|done|problem|comment
//   ?limit=200 (default 200, max 1000)
//   Vrátí seznam akcí v kioscích — pro mzdy / audit / debug.
router.get('/audit-log', async (req, res, next) => {
  try {
    const { from, to, person_id, batch_id, action } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    const where = {};
    if (action) where.action = action;
    if (person_id) where.person_id = parseInt(person_id, 10);
    if (batch_id) where.batch_operation = { batch_id: parseInt(batch_id, 10) };

    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = new Date(from + 'T00:00:00');
      if (to) where.created_at.lte = new Date(to + 'T23:59:59');
    } else {
      // default: dnes
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
      where.created_at = { gte: dayStart, lte: dayEnd };
    }

    const logs = await prisma.batchOperationLog.findMany({
      where,
      take: limit,
      include: {
        person: { select: { first_name: true, last_name: true } },
        batch_operation: {
          select: {
            id: true, sequence: true, duration_minutes: true,
            operation: { select: { name: true } },
            workstation: { select: { name: true } },
            batch: { select: { id: true, batch_number: true,
              product: { select: { code: true, name: true } } } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Agregát per person + per action — užitečný pro mzdy
    const byPerson = new Map();
    const byAction = {};
    for (const l of logs) {
      byAction[l.action] = (byAction[l.action] || 0) + 1;
      if (!l.person) continue;
      const key = l.person.first_name + ' ' + l.person.last_name;
      const cur = byPerson.get(key) || { name: key, actions: 0, done_count: 0, total_minutes: 0 };
      cur.actions++;
      if (l.action === 'done') {
        cur.done_count++;
        cur.total_minutes += (l.batch_operation?.duration_minutes || 0);
      }
      byPerson.set(key, cur);
    }

    if (req.query.format === 'csv') {
      const esc = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csvLines = [
        ['Čas', 'Akce', 'Pracovník', 'Dávka', 'Produkt', 'Operace', 'Pracoviště', 'Trvání (min)', 'Poznámka'].join(';'),
      ];
      for (const l of logs) {
        const time = new Date(l.created_at).toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        csvLines.push([
          esc(time),
          esc(l.action),
          esc(l.person ? l.person.first_name + ' ' + l.person.last_name : ''),
          esc(l.batch_operation?.batch?.batch_number || ''),
          esc(l.batch_operation?.batch?.product ? l.batch_operation.batch.product.code + ' ' + l.batch_operation.batch.product.name : ''),
          esc(l.batch_operation?.operation?.name || ''),
          esc(l.batch_operation?.workstation?.name || ''),
          esc(l.batch_operation?.duration_minutes != null ? l.batch_operation.duration_minutes : ''),
          esc(l.note || ''),
        ].join(';'));
      }
      const csv = '﻿' + csvLines.join('\r\n');
      const dateLabel = (from && to) ? `${from}_${to}` : (from || to || new Date().toISOString().slice(0, 10));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${dateLabel}.csv"`);
      return res.send(csv);
    }

    res.json({
      filter: { from: from || null, to: to || null, person_id: person_id || null, batch_id: batch_id || null, action: action || null },
      summary: {
        total: logs.length,
        by_action: byAction,
        by_person: Array.from(byPerson.values()).sort((a, b) => b.done_count - a.done_count),
      },
      logs: logs.map(l => ({
        id: l.id,
        created_at: l.created_at,
        action: l.action,
        person: l.person ? `${l.person.first_name} ${l.person.last_name}` : null,
        batch_number: l.batch_operation?.batch?.batch_number || null,
        product: l.batch_operation?.batch?.product
          ? `${l.batch_operation.batch.product.code} ${l.batch_operation.batch.product.name}`
          : null,
        operation: l.batch_operation?.operation?.name || null,
        workstation: l.batch_operation?.workstation?.name || null,
        duration_minutes: l.batch_operation?.duration_minutes || null,
        note: l.note,
      })),
    });
  } catch (err) { next(err); }
});

// =============================================================================
// PLÁNOVAČ — VÝKON PRACOVNÍKA (today / per date)
// =============================================================================

// GET /api/planning/persons/:id/performance?date=YYYY-MM-DD
//   Co pracovník daný den udělal — kolik BatchOperation dokončil, kolik minut.
//   Default date = dnes.
router.get('/persons/:id/performance', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.id, 10);
    if (isNaN(personId)) return res.status(400).json({ error: 'Neplatné ID' });

    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dateStr + 'T23:59:59');
    if (isNaN(dayStart.getTime())) return res.status(400).json({ error: 'Neplatné datum' });

    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { id: true, first_name: true, last_name: true, employee_number: true },
    });
    if (!person) return res.status(404).json({ error: 'Pracovník nenalezen' });

    // Dokončené BatchOperation, kde pracovník byl assigned (nezáleží na logu —
    // BatchOperation.assigned_person_id + finished_at je zdroj pravdy).
    const completed = await prisma.batchOperation.findMany({
      where: {
        assigned_person_id: personId,
        finished_at: { gte: dayStart, lte: dayEnd },
        status: 'done',
      },
      include: {
        operation: { select: { name: true, step_number: true } },
        workstation: { select: { name: true } },
        batch: { select: { batch_number: true,
          product: { select: { code: true, name: true } } } },
      },
      orderBy: { finished_at: 'asc' },
    });

    // Rozpracované, které pracovník začal a stále jede
    const inProgress = await prisma.batchOperation.findMany({
      where: { assigned_person_id: personId, status: 'in_progress' },
      include: {
        operation: { select: { name: true } },
        workstation: { select: { name: true } },
        batch: { select: { batch_number: true,
          product: { select: { code: true, name: true } } } },
      },
    });

    const totalMinutes = completed.reduce((s, op) => s + (op.duration_minutes || 0), 0);

    res.json({
      person,
      date: dateStr,
      summary: {
        completed_count: completed.length,
        in_progress_count: inProgress.length,
        total_minutes: totalMinutes,
        total_hours: +(totalMinutes / 60).toFixed(2),
        avg_minutes_per_operation: completed.length > 0 ? +(totalMinutes / completed.length).toFixed(1) : 0,
      },
      completed: completed.map(op => ({
        id: op.id,
        batch_number: op.batch?.batch_number,
        product: op.batch?.product ? `${op.batch.product.code} ${op.batch.product.name}` : null,
        operation: op.operation?.name,
        step: op.operation?.step_number,
        workstation: op.workstation?.name,
        started_at: op.started_at,
        finished_at: op.finished_at,
        duration_minutes: op.duration_minutes,
      })),
      in_progress: inProgress.map(op => ({
        id: op.id,
        batch_number: op.batch?.batch_number,
        product: op.batch?.product ? `${op.batch.product.code} ${op.batch.product.name}` : null,
        operation: op.operation?.name,
        workstation: op.workstation?.name,
        started_at: op.started_at,
      })),
    });
  } catch (err) { next(err); }
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
//   ?format=csv  → vrátí text/csv (jinak JSON).
//   Vrátí materiály, které je třeba objednat napříč všemi dávkami.
router.get('/purchase-report', async (req, res, next) => {
  try {
    const statuses = req.query.statuses ? String(req.query.statuses).split(',').map(s => s.trim()).filter(Boolean) : null;
    const result = await computePurchaseReport({ statuses });

    if (req.query.format === 'csv') {
      // CSV s BOM (Excel je očekává pro UTF-8 v české diakritice)
      const esc = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [
        ['Kód', 'Název', 'Objednat', 'Jednotka', 'Dodavatel', 'Lead time (dní)', 'Očekávané dodání', 'Pokrývá dávek'].join(';'),
      ];
      for (const it of result.items) {
        lines.push([
          esc(it.material?.code),
          esc(it.material?.name),
          esc(it.total_shortage),
          esc(it.unit),
          esc(it.supplier?.name || ''),
          esc(it.lead_time_days != null ? it.lead_time_days : ''),
          esc(it.expected_delivery || ''),
          esc(it.contributors.length),
        ].join(';'));
      }
      const csv = '﻿' + lines.join('\r\n');
      const filename = `nakupni-report-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

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
