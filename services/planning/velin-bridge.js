// =============================================================================
// HolyOS — Velín bridge (Fáze 4)
// =============================================================================
// Most mezi výrobním plánovačem (BatchOperation s assigned_person_id) a Velín
// modulem (TaskAssignment + mobilní push). Operuje jednosměrně i obousměrně:
//
//   Plánovač  →  Velín:
//     `syncBatchOperationToVelin(batchOpId)` — pro každou naplánovanou
//     BatchOperation, která má assigned_person_id, vytvoří nebo aktualizuje
//     TaskAssignment v DailyPlan toho člověka pro daný den (planned_start).
//     Idempotentní (re-spuštění aktualizuje, ne duplikuje).
//
//   Velín  →  Plánovač:
//     `propagateTaskStatusToBatchOperation(taskAssignmentId, action)`
//     Když kolega ve Velínu klikne Start / Hotovo / Block, propíšeme do
//     BatchOperation.status + started_at / finished_at / duration_minutes.
//
// Norma TAC+Tpz:
//   estimated_min = preparation_time + (duration × batch.quantity)
//   kde duration je v MINUTE (units přepočítáme).
//
// Side-effect: po vytvoření TaskAssignment se push notifikace pošle skrz
// `createNotification` z routes/notifications.routes.js (Expo push + SSE).

const { prisma } = require('../../config/database');

// Převod duration na minuty bez ohledu na unit z ProductOperation.
function durationToMinutes(value, unit) {
  if (value == null) return 0;
  if (unit === 'HOUR') return value * 60;
  if (unit === 'SECOND') return Math.round(value / 60);
  return value; // MINUTE (default)
}

// Norma pro batch — TAC × n + Tpz
function estimateOperationMinutes(productOperation, batchQuantity) {
  const tac = durationToMinutes(productOperation.duration, productOperation.duration_unit);
  const tpz = productOperation.preparation_time || 0;
  return tpz + tac * (batchQuantity || 1);
}

// Najde nebo vytvoří DailyPlan pro daný person + day (00:00 lokal).
async function ensureDailyPlan(personId, dateInput) {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  let plan = await prisma.dailyPlan.findUnique({
    where: { person_id_date: { person_id: personId, date } },
  });
  if (!plan) {
    plan = await prisma.dailyPlan.create({
      data: { person_id: personId, date, status: 'auto' },
    });
  }
  return plan;
}

/**
 * Vytvoří nebo aktualizuje TaskAssignment podle BatchOperation.
 * Idempotentní: hledá podle source_ref_type='BatchOperation' + source_ref_id.
 *
 * @returns { task, created } — task = TaskAssignment, created = true pokud nový
 */
async function syncBatchOperationToVelin(batchOpId, { sendPush = true, source = 'production' } = {}) {
  const op = await prisma.batchOperation.findUnique({
    where: { id: batchOpId },
    include: {
      operation: {
        include: { product: true },
      },
      batch: {
        include: { product: true },
      },
      workstation: true,
      assigned_person: true,
    },
  });
  if (!op) return null;
  if (!op.assigned_person_id) return null; // nikdo není přiřazen → nic
  if (!op.planned_start) return null; // bez plánu nemá smysl vytvořit Velin task

  const productName = op.batch?.product?.name || op.operation?.product?.name || 'Výrobek';
  const batchNumber = op.batch?.batch_number || `#${op.batch_id}`;
  const wsName = op.workstation?.name || '';
  const title = `${op.operation.name} · ${productName} ${batchNumber}`;
  const estMin = estimateOperationMinutes(op.operation, op.batch?.quantity || 1);

  // Hledej existující TaskAssignment podle source_ref_*
  const existing = await prisma.taskAssignment.findFirst({
    where: {
      source_ref_type: 'BatchOperation',
      source_ref_id: op.id,
    },
  });

  const plan = await ensureDailyPlan(op.assigned_person_id, op.planned_start);

  const payload = {
    person_id: op.assigned_person_id,
    daily_plan_id: plan.id,
    title,
    description: [
      op.operation.description || null,
      wsName ? `Pracoviště: ${wsName}` : null,
      op.note ? `Poznámka: ${op.note}` : null,
    ].filter(Boolean).join('\n') || null,
    priority: 3,
    estimated_min: estMin,
    due_at: op.planned_end,
    location_hint: wsName || null,
    source, // 'production' (ruční plán) | 'ai_dispatcher' (Mistr)
    source_ref_type: 'BatchOperation',
    source_ref_id: op.id,
    created_by: 'system',
  };

  let task;
  let created = false;
  if (existing) {
    // Pokud kolega už úkol start/done — neměň status, jen meta info
    const updateData = {
      person_id: payload.person_id,
      daily_plan_id: payload.daily_plan_id,
      title: payload.title,
      description: payload.description,
      estimated_min: payload.estimated_min,
      due_at: payload.due_at,
      location_hint: payload.location_hint,
    };
    task = await prisma.taskAssignment.update({
      where: { id: existing.id },
      data: updateData,
    });
  } else {
    task = await prisma.taskAssignment.create({
      data: { ...payload, status: 'proposed' },
    });
    created = true;
  }

  // Push notifikace jen u nově vytvořeného úkolu (aby kolega nedostal spam
  // při re-syncu meta dat). Pokud někdo chce push i u re-syncu, předá
  // { sendPush: true } a my voláme `createNotification` níže.
  if (created && sendPush) {
    try {
      const { createNotification } = require('../../routes/notifications.routes');
      const user = await prisma.user.findFirst({
        where: { person: { id: op.assigned_person_id } },
        select: { id: true },
      });
      if (user) {
        await createNotification({
          userId: user.id,
          type: 'task_status',
          title: `Nový úkol z plánovače: ${op.operation.name}`,
          body: `${productName} ${batchNumber} · ${wsName} · ${estMin} min`,
          link: `/modules/velin?task=${task.id}`,
          meta: { task_id: task.id, batch_operation_id: op.id },
        });
      }
    } catch (e) {
      console.warn('[velin-bridge] push notif selhalo:', e.message);
    }
  }

  return { task, created };
}

/**
 * Synchronizuje VŠECHNY BatchOperation v dávce s Velínem (po scheduleru).
 * Vrátí array výsledků (skipped/created/updated per op).
 */
async function syncBatchToVelin(batchId) {
  const ops = await prisma.batchOperation.findMany({
    where: { batch_id: batchId },
    select: { id: true, assigned_person_id: true, planned_start: true },
  });
  const results = [];
  for (const o of ops) {
    if (!o.assigned_person_id || !o.planned_start) {
      results.push({ op_id: o.id, skipped: true });
      continue;
    }
    try {
      const res = await syncBatchOperationToVelin(o.id);
      results.push({ op_id: o.id, ...res });
    } catch (e) {
      results.push({ op_id: o.id, error: e.message });
    }
  }
  return results;
}

/**
 * Když kolega ve Velínu klikne Start / Hotovo / Block na úkolu, který má
 * source_ref_type='BatchOperation', propíšeme změnu zpět do BatchOperation.
 *
 * @param taskId — TaskAssignment.id
 * @param action — 'start' | 'complete' | 'block'
 * @param payload — volitelná data (actual_min při complete, reason při block)
 */
async function propagateTaskStatusToBatchOperation(taskId, action, payload = {}) {
  const task = await prisma.taskAssignment.findUnique({
    where: { id: taskId },
    select: { id: true, source_ref_type: true, source_ref_id: true, started_at: true, completed_at: true },
  });
  if (!task) return null;
  if (task.source_ref_type !== 'BatchOperation' || !task.source_ref_id) return null;

  const opId = task.source_ref_id;
  const data = {};
  if (action === 'start') {
    data.status = 'in_progress';
    data.started_at = task.started_at || new Date();
  } else if (action === 'complete') {
    data.status = 'completed';
    data.finished_at = task.completed_at || new Date();
    if (typeof payload.actual_min === 'number') {
      data.duration_minutes = payload.actual_min;
    } else if (data.finished_at && task.started_at) {
      data.duration_minutes = Math.max(
        1,
        Math.round((new Date(data.finished_at).getTime() - new Date(task.started_at).getTime()) / 60000)
      );
    }
  } else if (action === 'block') {
    // BatchOperation nemá nativní 'blocked' status — uložíme poznámku.
    data.note = payload.reason || 'Blokováno kolegou ve Velínu';
  }

  if (Object.keys(data).length === 0) return null;
  return await prisma.batchOperation.update({
    where: { id: opId },
    data,
  });
}

module.exports = {
  syncBatchOperationToVelin,
  syncBatchToVelin,
  propagateTaskStatusToBatchOperation,
  estimateOperationMinutes,
};
