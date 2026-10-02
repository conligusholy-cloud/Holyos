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
  // PRAVIDLO: na pracovišti se vyrábí v jednu chvíli jen JEDEN výrobek (dávka). Výrobek pracoviště
  // drží po celou dobu, co na něm je — od začátku své první operace do konce poslední — včetně
  // mezer mezi operacemi. Proto se operace jiných dávek slučují per (pracoviště, dávka) do jednoho
  // obsazeného úseku; jiná dávka se do mezery nevejde.
  const spans = new Map(); // key ws|batch → { start, end, batch_id, op_id }
  for (const o of others) {
    const key = o.workstation_id + '|' + o.batch_id;
    const st = new Date(o.planned_start), en = new Date(o.planned_end);
    const cur = spans.get(key);
    if (!cur) spans.set(key, { ws: o.workstation_id, start: st, end: en, batch_id: o.batch_id, op_id: o.id, ops: 1 });
    else { if (st < cur.start) cur.start = st; if (en > cur.end) cur.end = en; cur.ops++; }
  }
  const map = new Map();
  for (const sp of spans.values()) {
    if (!map.has(sp.ws)) map.set(sp.ws, []);
    map.get(sp.ws).push({ start: sp.start, end: sp.end, batch_id: sp.batch_id, op_id: sp.op_id, whole_batch: true, ops: sp.ops });
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
  // 0. Explicitní seznam „kdo smí operaci dělat" má přednost — vybírá se z těchto variant (podle priority,
  //    přednost má ten, kdo je kmenový na daném pracovišti).
  const allowed = ctx.allowedByOp.get(op.operation_id) || [];
  if (allowed.length > 0) {
    const wsW = op.workstation_id ? (ctx.workersByWs.get(op.workstation_id) || []) : [];
    const prim = new Set(wsW.filter(w => w.is_primary).map(w => w.person_id));
    const onWs = new Set(wsW.map(w => w.person_id));
    const sorted = allowed.slice().sort((a, b) => (prim.has(b.person.id) - prim.has(a.person.id)) || (onWs.has(b.person.id) - onWs.has(a.person.id)) || (a.priority - b.priority));
    return sorted[0].person;
  }
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
  const allowedByOp = new Map();

  if (operationIds.length > 0) {
    const allowed = await tx.operationAllowedPerson.findMany({
      where: { operation_id: { in: operationIds }, person: { active: true } },
      select: { operation_id: true, priority: true, person: { select: { id: true, first_name: true, last_name: true } } },
      orderBy: { priority: 'asc' },
    });
    for (const a of allowed) { if (!allowedByOp.has(a.operation_id)) allowedByOp.set(a.operation_id, []); allowedByOp.get(a.operation_id).push(a); }
  }

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

  return { requiredByOp, personsByComp, workersByWs, allowedByOp };
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
          workstation_group_id: true,
          operation_id: true,
          assigned_person_id: true,
          operation: { select: { duration: true, duration_unit: true, preparation_time: true, is_parallel: true, parallel_from: true, parallel_to: true, step_number: true } },
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

  // Skupiny pracovišť — operace se skupinou bez konkrétního pracoviště: plánovač vybere kterékoli volné ve skupině
  const groupIds = [...new Set(
    batch.batch_operations.map(o => o.workstation_group_id).filter(g => g != null)
  )];
  const membersByGroup = new Map();
  if (groupIds.length > 0) {
    const members = await tx.workstation.findMany({
      where: { group_id: { in: groupIds } },
      select: { id: true, group_id: true },
      orderBy: { id: 'asc' },
    });
    for (const m of members) {
      if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
      membersByGroup.get(m.group_id).push(m.id);
    }
  }

  const wsIds = [...new Set([
    ...batch.batch_operations.map(o => o.workstation_id).filter(wsid => wsid != null),
    ...[...membersByGroup.values()].flat(),
  ])];
  const opIds = [...new Set(batch.batch_operations.map(o => o.operation_id).filter(Boolean))];
  const queueByWs = await loadQueueByWorkstation(tx, id, wsIds, exclusive);
  const assignCtx = await loadAssignmentContext(tx, opIds, wsIds);

  const anchor = batch.planned_start ? new Date(batch.planned_start) : new Date();
  let prevEnd = new Date(anchor);
  const updates = [];
  const opWarnings = [];
  let totalWork = 0;
  let totalWait = 0;

  // Hlavní linie se plánuje za sebou; paralelní (plovoucí) operace až potom — do okna
  // mezi koncem hlavní operace před parallel_from a startem hlavní operace za parallel_to.
  const mainOps = batch.batch_operations.filter(o => !(o.operation && o.operation.is_parallel));
  const parallelOps = batch.batch_operations.filter(o => o.operation && o.operation.is_parallel);
  const mainByStep = new Map(); // step_number → { start, end }
  const orderedOps = mainOps.concat(parallelOps);
  const batchWsUsed = new Set(); // pracoviště, kde už tato dávka má operaci (výrobek na něm zůstává)

  for (const op of orderedOps) {
    if (op.status === 'done' || op.status === 'cancelled') continue;
    const isParallel = !!(op.operation && op.operation.is_parallel);

    const warnings = [];
    let candidateStart;
    if (isParallel) {
      // okno: od konce hlavní operace s krokem (parallel_from − 1), jinak od začátku dávky
      const from = op.operation.parallel_from;
      let winStart = anchor.getTime();
      if (from != null) { const prevMain = [...mainByStep.entries()].filter(([st]) => st < from).sort((a, b) => b[0] - a[0])[0]; if (prevMain) winStart = prevMain[1].end.getTime(); }
      candidateStart = new Date(Math.max(winStart, anchor.getTime()));
      warnings.push('parallel');
    } else {
      candidateStart = new Date(Math.max(prevEnd.getTime(), anchor.getTime()));
    }

    const blockCheck = pushPastSlotBlock(candidateStart, slotBlocks);
    if (blockCheck.blocked) {
      warnings.push(`crossed_slot_block:${blockCheck.blocked}`);
      candidateStart = blockCheck.date;
    }

    candidateStart = nextShiftStart(candidateStart, cfg);

    const prepMin = op.operation?.preparation_time || 0;
    const runMin = operationMinutes(op.operation || {}, batch.quantity);
    const totalMin = prepMin + runMin;

    // Výběr pracoviště ze skupiny: to, které je v kandidátním čase volné (nebo se uvolní nejdřív)
    let pickedWsId = null;
    if (isParallel) {
      // Plovoucí pracoviště: paralelní operace se dělá tam, kde je výrobek — převezme pracoviště
      // hlavní operace, u které okno začíná (resp. nejbližší hlavní operace v okně).
      const from = op.operation.parallel_from;
      const cands = [...mainByStep.entries()].filter(([st]) => from == null || st >= from).sort((a, b) => a[0] - b[0]);
      const host = cands[0] || [...mainByStep.entries()].sort((a, b) => b[0] - a[0])[0];
      if (host && host[1].wsId) { pickedWsId = host[1].wsId; warnings.push('floating_ws:ws' + pickedWsId + '@step' + host[0]); }
      else warnings.push('floating_ws_unknown');
    } else if (!op.workstation_id && op.workstation_group_id) {
      const members = membersByGroup.get(op.workstation_group_id) || [];
      if (members.length === 0) {
        warnings.push('group_has_no_workstations');
      } else {
        const probe = consumeShift(candidateStart, totalMin, cfg);
        // Přednost má pracoviště, kde už tato dávka je (výrobek se nestěhuje); jinak první volné,
        // jinak to, které se uvolní nejdřív. Volné = žádný JINÝ výrobek ho v okně nedrží.
        const ordered = members.slice().sort((x, y) => (batchWsUsed.has(y) ? 1 : 0) - (batchWsUsed.has(x) ? 1 : 0));
        let best = null;
        for (const wsid of ordered) {
          const ce = findQueueConflictEnd(queueByWs, wsid, candidateStart, probe.end);
          if (!ce) { best = { wsid, free: candidateStart.getTime() }; break; }
          if (!best || ce.getTime() < best.free) best = { wsid, free: ce.getTime() };
        }
        pickedWsId = best.wsid;
        warnings.push(`picked_from_group:ws${pickedWsId}`);
        if (best.free > candidateStart.getTime()) warnings.push('group_all_busy_waiting');
      }
    }
    const wsId = op.workstation_id || pickedWsId;
    if (!wsId) warnings.push('no_workstation_assigned');

    let consumed;
    for (let i = 0; i < 50; i++) {
      consumed = consumeShift(candidateStart, totalMin, cfg);
      if (isParallel) break; // plovoucí: pracoviště drží hlavní operace, paralelní ho neblokuje ani nečeká
      const conflictEnd = findQueueConflictEnd(
        queueByWs, wsId, candidateStart, consumed.end
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
      assignedPerson = pickAssignee({ ...op, workstation_id: wsId }, assignCtx);
      if (!assignedPerson) warnings.push('no_assignee_found');
    }

    updates.push({
      id: op.id,
      planned_start: start,
      planned_end: end,
      minutes: +totalMin.toFixed(1),
      warnings,
      workstation_id: pickedWsId || undefined,
      assigned_person_id: assignedPerson ? assignedPerson.id : undefined,
      assigned_person_name: assignedPerson ? `${assignedPerson.first_name} ${assignedPerson.last_name}` : null,
    });

    if (wsId && !isParallel) {
      batchWsUsed.add(wsId);
      if (!queueByWs.has(wsId)) queueByWs.set(wsId, []);
      queueByWs.get(wsId).push({
        start, end, batch_id: id, op_id: op.id,
      });
    }

    if (isParallel) {
      // Přesah za okno (start hlavní operace za parallel_to) → jen varování, hlavní linii to neposouvá
      const to = op.operation.parallel_to;
      if (to != null) { const nextMain = [...mainByStep.entries()].filter(([st]) => st > to).sort((a, b) => a[0] - b[0])[0]; if (nextMain && end.getTime() > nextMain[1].start.getTime()) warnings.push('parallel_overflow:' + Math.round((end.getTime() - nextMain[1].start.getTime()) / 60000) + 'min'); }
    } else {
      mainByStep.set(op.operation && op.operation.step_number != null ? op.operation.step_number : op.sequence, { start, end, wsId });
      prevEnd = end;
    }
    if (warnings.length > 0) opWarnings.push({ op_id: op.id, sequence: op.sequence, warnings });
  }

  if (updates.length === 0) {
    return {
      batch_number: batch.batch_number,
      operations_scheduled: 0,
      warning: 'Všechny operace jsou done/cancelled',
    };
  }

  // Když už běžíme uvnitř interaktivní transakce (simulace), $transaction není k dispozici → zapisuj přímo přes tx
  const runTx = typeof tx.$transaction === 'function' ? (fn) => tx.$transaction(fn) : (fn) => fn(tx);
  await runTx(async (txx) => {
    for (const u of updates) {
      const data = { planned_start: u.planned_start, planned_end: u.planned_end };
      if (u.assigned_person_id !== undefined) data.assigned_person_id = u.assigned_person_id;
      if (u.workstation_id !== undefined) data.workstation_id = u.workstation_id; // vybráno ze skupiny
      await txx.batchOperation.update({ where: { id: u.id }, data });
    }
    // Paralelní operace jsou na konci pole → začátek/konec dávky počítej z min/max
    const firstStart = new Date(Math.min(...updates.map(u => u.planned_start.getTime())));
    const lastEnd = new Date(Math.max(...updates.map(u => u.planned_end.getTime())));
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
    plan_start: new Date(Math.min(...updates.map(u => u.planned_start.getTime()))).toISOString(),
    anchor: anchor.toISOString(),
    plan_end: new Date(Math.max(...updates.map(u => u.planned_end.getTime()))).toISOString(),
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

  // Operace ze skupiny pracovišť: uvolni dříve vybrané pracoviště, ať se při přeplánování vybere znovu
  await tx.batchOperation.updateMany({
    where: {
      batch: { status: { in: ['planned', 'released', 'paused'] } },
      status: { notIn: ['in_progress', 'done', 'cancelled'] },
      workstation_group_id: { not: null },
    },
    data: { workstation_id: null },
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
