// =============================================================================
// HolyOS — Plánovač: RCCP V2 scheduler (queue + shift + setup + SlotBlock)
// =============================================================================
//
// Pro každou BatchOperation v dávce sekvenčně nastaví planned_start a
// planned_end s ohledem na:
//
//   1. Pořadí v dávce (sequence) — předchozí operace musí skončit dřív.
//   2. Pracovní dobu — operace neběží mimo shift (env SCHEDULER_SHIFT_*).
//      Pokud env chybí, fallback je 24/7 (V1 chování, backward-compat).
//   3. Queue na pracovišti — pokud jiná BatchOperation (status planned/released/
//      in_progress/paused) blokuje WS, nová operace čeká až se uvolní.
//   4. Setup time — ProductOperation.preparation_time se přičítá k duration.
//   5. SlotBlock — pokud dávka má SlotAssignment a slot má SlotBlock překrývající
//      navržený interval, operace se posune za blok.
//
// Volání:
//   scheduleBatch(id)                  — standardní, respektuje frontu jiných dávek
//   scheduleBatch(id, { exclusive: true })  — ignoruje frontu, plánuje "od nuly"
//
// CO V2 NEDĚLÁ (TODO V3):
//   - Per-workstation shift (zatím globální env)
//   - ALAP / backward scheduling z deadline
//   - Capacity > 1 na pracoviště (paralelní výroba)
//   - Feeder dependencies (jedna dávka čeká na výstup druhé)
//   - Multi-resource (lidi × stroj × materiál)
//   - WorkstationBlock model (per-stroj údržba)
// =============================================================================

const { prisma: defaultPrisma } = require('../../config/database');
const { getShiftConfig, consumeShift, nextShiftStart } = require('./shift-calendar');

const ACTIVE_BATCH_STATUSES = ['planned', 'released', 'in_progress', 'paused'];

function operationMinutes(op, quantity) {
  const d = op.duration || 0;
  const u = op.duration_unit || 'MINUTE';
  const perKs = u === 'HOUR' ? d * 60 : u === 'SECOND' ? d / 60 : d;
  return perKs * (quantity || 1);
}

function findQueueConflictEnd(queueByWs, workstationId, start, end) {
  if (!workstationId) return null;
  const queue = queueByWs.get(workstationId);
  if (!queue || queue.length === 0) return null;
  let maxConflictEnd = null;
  for (const slot of queue) {
    if (slot.start < end && slot.end > start) {
      if (!maxConflictEnd || slot.end > maxConflictEnd) {
        maxConflictEnd = slot.end;
      }
    }
  }
  return maxConflictEnd;
}

async function loadQueueByWorkstation(tx, batchId, workstationIds, exclusive) {
  if (exclusive || workstationIds.length === 0) return new Map();
  const others = await tx.batchOperation.findMany({
    where: {
      workstation_id: { in: workstationIds },
      batch_id: { not: batchId },
      planned_start: { not: null },
      planned_end: { not: null },
      batch: { status: { in: ACTIVE_BATCH_STATUSES } },
      status: { notIn: ['done', 'cancelled'] },
    },
    select: {
      id: true,
      batch_id: true,
      workstation_id: true,
      planned_start: true,
      planned_end: true,
    },
  });
  const map = new Map();
  for (const o of others) {
    if (!map.has(o.workstation_id)) map.set(o.workstation_id, []);
    map.get(o.workstation_id).push({
      start: new Date(o.planned_start),
      end: new Date(o.planned_end),
      batch_id: o.batch_id,
      op_id: o.id,
    });
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.start - b.start);
  }
  return map;
}

/**
 * Resource assignment — vybere doporučeného pracovníka pro operaci.
 *
 * Heuristika:
 *  1. Pokud má ProductOperation required_competencies → najdi pracovníky, kteří
 *     mají VŠECHNY tyto kompetence s min_level. Z nich preferuj is_primary na
 *     daném workstation, jinak první podle abecedy.
 *  2. Jinak fallback na WorkstationWorker pro daný workstation (is_primary first).
 *  3. Jinak null (žádný doporučený).
 *
 * Předpoklady — všechny lookup tabulky pre-loaded (žádné N+1).
 */
function pickAssignee(op, ctx) {
  const required = ctx.requiredByOp.get(op.operation_id) || [];
  let candidates = null;
  if (required.length > 0) {
    // Najdi pracovníky, kteří mají VŠECHNY required kompetence s min_level
    const setsPerComp = required.map(r => {
      const arr = ctx.personsByComp.get(r.competency_id) || [];
      return new Map(arr.filter(p => p.level >= r.min_level).map(p => [p.person_id, p.person]));
    });
    if (setsPerComp.length === 0 || setsPerComp.some(m => m.size === 0)) return null;
    // intersection
    let intersection = setsPerComp[0];
    for (let i = 1; i < setsPerComp.length; i++) {
      const next = new Map();
      for (const [k, v] of intersection) if (setsPerComp[i].has(k)) next.set(k, v);
      intersection = next;
    }
    candidates = [...intersection.values()];
  }

  // Sort: is_primary na daném WS → alphabetical
  const wsWorkers = op.workstation_id ? (ctx.workersByWs.get(op.workstation_id) || []) : [];
  const primaryIds = new Set(wsWorkers.filter(w => w.is_primary).map(w => w.person_id));
  const onWsIds = new Set(wsWorkers.map(w => w.person_id));

  if (!candidates) {
    // Fallback na WorkstationWorker pro daný WS
    candidates = wsWorkers.map(w => w.person);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aPrim = primaryIds.has(a.id) ? 0 : 1;
    const bPrim = primaryIds.has(b.id) ? 0 : 1;
    if (aPrim !== bPrim) return aPrim - bPrim;
    const aOnWs = onWsIds.has(a.id) ? 0 : 1;
    const bOnWs = onWsIds.has(b.id) ? 0 : 1;
    if (aOnWs !== bOnWs) return aOnWs - bOnWs;
    return (a.last_name || '').localeCompare(b.last_name || '');
  });
  return candidates[0];
}

/**
 * Pre-load všech dat potřebných pro assignment v 1 batchi (3 queries místo N+1).
 */
async function loadAssignmentContext(tx, operationIds, workstationIds) {
  const requiredByOp = new Map();
  const personsByComp = new Map();
  const workersByWs = new Map();

  if (operationIds.length > 0) {
    const reqs = await tx.operationRequiredCompetency.findMany({
      where: { operation_id: { in: operationIds } },
      select: { operation_id: true, competency_id: true, min_level: true },
    });
    for (const r of reqs) {
      if (!requiredByOp.has(r.operation_id)) requiredByOp.set(r.operation_id, []);
      requiredByOp.get(r.operation_id).push({ competency_id: r.competency_id, min_level: r.min_level });
    }
    const allCompIds = [...new Set(reqs.map(r => r.competency_id))];
    if (allCompIds.length > 0) {
      const wcs = await tx.workerCompetency.findMany({
        where: { competency_id: { in: allCompIds }, person: { active: true } },
        select: {
          competency_id: true,
          level: true,
          person: { select: { id: true, first_name: true, last_name: true } },
        },
      });
      for (const w of wcs) {
        if (!personsByComp.has(w.competency_id)) personsByComp.set(w.competency_id, []);
        personsByComp.get(w.competency_id).push({
          person_id: w.person.id,
          level: w.level,
          person: w.person,
        });
      }
    }
  }

  if (workstationIds.length > 0) {
    const wws = await tx.workstationWorker.findMany({
      where: { workstation_id: { in: workstationIds }, person: { active: true } },
      select: {
        workstation_id: true,
        is_primary: true,
        person: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: [{ is_primary: 'desc' }],
    });
    for (const w of wws) {
      if (!workersByWs.has(w.workstation_id)) workersByWs.set(w.workstation_id, []);
      workersByWs.get(w.workstation_id).push({
        person_id: w.person.id,
        is_primary: w.is_primary,
        person: w.person,
      });
    }
  }

  return { requiredByOp, personsByComp, workersByWs };
}

function pushPastSlotBlock(date, blocks) {
  if (!blocks || blocks.length === 0) return { date, blocked: null };
  for (const b of blocks) {
    const blockStart = new Date(b.start_date);
    blockStart.setHours(0, 0, 0, 0);
    const blockEnd = new Date(b.end_date);
    blockEnd.setHours(23, 59, 59, 999);
    if (date >= blockStart && date <= blockEnd) {
      const afterBlock = new Date(blockEnd);
      afterBlock.setDate(afterBlock.getDate() + 1);
      afterBlock.setHours(0, 0, 0, 0);
      return { date: afterBlock, blocked: b.reason || 'block' };
    }
  }
  return { date, blocked: null };
}

async function scheduleBatch(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const exclusive = opts.exclusive === true;
  const id = parseInt(batchId, 10);
  if (isNaN(id)) throw new Error('Neplatné batchId');

  const cfg = getShiftConfig();

  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: {
      id: true,
      batch_number: true,
      quantity: true,
      planned_start: true,
      batch_operations: {
        select: {
          id: true,
          sequence: true,
          status: true,
          workstation_id: true,
          operation_id: true,
          assigned_person_id: true,
          operation: { select: { duration: true, duration_unit: true, preparation_time: true } },
        },
        orderBy: { sequence: 'asc' },
      },
      slot_assignments: {
        select: {
          slot: { select: { blocks: { select: { start_date: true, end_date: true, reason: true } } } },
        },
      },
    },
  });

  if (!batch) throw new Error(`Dávka id=${id} nenalezena`);
  if (batch.batch_operations.length === 0) {
    return {
      batch_number: batch.batch_number,
      operations_scheduled: 0,
      warning: 'Dávka nemá BatchOperation — nelze plánovat',
    };
  }

  const slotBlocks = [];
  for (const sa of batch.slot_assignments || []) {
    if (sa.slot && sa.slot.blocks) {
      for (const b of sa.slot.blocks) slotBlocks.push(b);
    }
  }

  const wsIds = [...new Set(
    batch.batch_operations.map(o => o.workstation_id).filter(wsid => wsid != null)
  )];
  const opIds = [...new Set(batch.batch_operations.map(o => o.operation_id).filter(Boolean))];
  const queueByWs = await loadQueueByWorkstation(tx, id, wsIds, exclusive);
  const assignCtx = await loadAssignmentContext(tx, opIds, wsIds);

  const anchor = batch.planned_start ? new Date(batch.planned_start) : new Date();
  let prevEnd = new Date(anchor);
  const updates = [];
  const opWarnings = [];
  let totalWork = 0;
  let totalWait = 0;

  for (const op of batch.batch_operations) {
    if (op.status === 'done' || op.status === 'cancelled') continue;

    const warnings = [];
    let candidateStart = new Date(Math.max(prevEnd.getTime(), anchor.getTime()));

    const blockCheck = pushPastSlotBlock(candidateStart, slotBlocks);
    if (blockCheck.blocked) {
      warnings.push(`crossed_slot_block:${blockCheck.blocked}`);
      candidateStart = blockCheck.date;
    }

    candidateStart = nextShiftStart(candidateStart, cfg);

    const prepMin = op.operation?.preparation_time || 0;
    const runMin = operationMinutes(op.operation || {}, batch.quantity);
    const totalMin = prepMin + runMin;

    if (!op.workstation_id) warnings.push('no_workstation_assigned');

    let consumed;
    for (let i = 0; i < 50; i++) {
      consumed = consumeShift(candidateStart, totalMin, cfg);
      const conflictEnd = findQueueConflictEnd(
        queueByWs, op.workstation_id, candidateStart, consumed.end
      );
      if (!conflictEnd) break;
      const conflictedBy = Math.round((conflictEnd.getTime() - candidateStart.getTime()) / 60000);
      warnings.push(`pushed_by_queue:+${conflictedBy}min`);
      candidateStart = nextShiftStart(conflictEnd, cfg);
    }

    const start = candidateStart;
    const end = consumed.end;
    totalWork += runMin + prepMin;
    totalWait += consumed.wait_minutes || 0;

    // Resource assignment — jen pokud operace zatím nemá assigned (nepřepíšeme manuální volbu)
    let assignedPerson = null;
    if (!op.assigned_person_id) {
      assignedPerson = pickAssignee(op, assignCtx);
      if (!assignedPerson) warnings.push('no_assignee_found');
    }

    updates.push({
      id: op.id,
      planned_start: start,
      planned_end: end,
      minutes: +totalMin.toFixed(1),
      warnings,
      assigned_person_id: assignedPerson ? assignedPerson.id : undefined,
      assigned_person_name: assignedPerson ? `${assignedPerson.first_name} ${assignedPerson.last_name}` : null,
    });

    if (op.workstation_id) {
      if (!queueByWs.has(op.workstation_id)) queueByWs.set(op.workstation_id, []);
      queueByWs.get(op.workstation_id).push({
        start, end, batch_id: id, op_id: op.id,
      });
    }

    if (warnings.length > 0) opWarnings.push({ op_id: op.id, sequence: op.sequence, warnings });
    prevEnd = end;
  }

  if (updates.length === 0) {
    return {
      batch_number: batch.batch_number,
      operations_scheduled: 0,
      warning: 'Všechny operace jsou done/cancelled',
    };
  }

  await tx.$transaction(async (txx) => {
    for (const u of updates) {
      const data = { planned_start: u.planned_start, planned_end: u.planned_end };
      if (u.assigned_person_id !== undefined) data.assigned_person_id = u.assigned_person_id;
      await txx.batchOperation.update({ where: { id: u.id }, data });
    }
    const firstStart = updates[0].planned_start;
    const lastEnd = updates[updates.length - 1].planned_end;
    await txx.productionBatch.update({
      where: { id },
      data: { planned_start: firstStart, planned_end: lastEnd },
    });
  });

  const work = +totalWork.toFixed(1);
  const wait = +totalWait.toFixed(1);
  const total = work + wait;
  return {
    batch_number: batch.batch_number,
    operations_scheduled: updates.length,
    plan_start: updates[0].planned_start.toISOString(),
    anchor: anchor.toISOString(),
    plan_end: updates[updates.length - 1].planned_end.toISOString(),
    work_minutes: work,
    wait_minutes: wait,
    idle_pct: total > 0 ? +((wait / total) * 100).toFixed(1) : 0,
    shift_config: cfg.enabled
      ? { enabled: true, start: cfg.start, end: cfg.end, work_days: cfg.workDays }
      : { enabled: false, mode: '24/7' },
    exclusive_mode: exclusive,
    operations: updates.map(u => ({
      batch_operation_id: u.id,
      planned_start: u.planned_start,
      planned_end: u.planned_end,
      minutes: u.minutes,
      warnings: u.warnings,
      assigned_person_name: u.assigned_person_name,
    })),
    op_warnings: opWarnings,
    assignees_assigned: updates.filter(u => u.assigned_person_id).length,
    assignees_total: updates.length,
  };
}

async function scheduleAllActive(opts = {}) {
  const tx = opts.tx || defaultPrisma;

  const batches = await tx.productionBatch.findMany({
    where: { status: { in: ['planned', 'released', 'paused'] } },
    select: { id: true, batch_number: true, priority: true, planned_end: true },
    orderBy: [{ priority: 'desc' }, { planned_end: 'asc' }],
  });

  await tx.batchOperation.updateMany({
    where: {
      batch: { status: { in: ['planned', 'released', 'paused'] } },
      status: { notIn: ['in_progress', 'done', 'cancelled'] },
    },
    data: { planned_start: null, planned_end: null },
  });

  const results = [];
  for (const b of batches) {
    try {
      const r = await scheduleBatch(b.id, { tx });
      results.push({ batch_id: b.id, batch_number: b.batch_number, ok: true, result: r });
    } catch (e) {
      results.push({ batch_id: b.id, batch_number: b.batch_number, ok: false, error: e.message });
    }
  }

  const okCount = results.filter(r => r.ok).length;
  return {
    total: results.length,
    ok: okCount,
    failed: results.length - okCount,
    results,
  };
}

module.exports = { scheduleBatch, scheduleAllActive };
