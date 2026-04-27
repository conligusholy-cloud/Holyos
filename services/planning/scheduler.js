// =============================================================================
// HolyOS — Plánovač: jednoduchý sekvenční scheduler V1 (F3.3)
// =============================================================================
//
// Pro každou BatchOperation v dávce sekvenčně nastaví planned_start a
// planned_end. Algoritmus V1 je NAIVNÍ — pro pochopitelnost a předvídatelnost:
//
//   1. Operace se řadí podle `sequence`.
//   2. Anchor = batch.planned_start (pokud je) nebo NOW.
//   3. Pro každou operaci:
//        planned_start = max(anchor, předchozí_op.planned_end)
//        duration_min  = op.duration × batch.quantity
//                        (převod podle duration_unit: HOUR×60, MINUTE, SECOND/60)
//        planned_end   = planned_start + duration_min
//   4. batch.planned_end se zaktualizuje na planned_end poslední operace
//      (pokud nebyl předtím nastaven jiný).
//
// CO SCHEDULER V1 NEDĚLÁ (TODO pro F3.2 RCCP):
//   - Working hours (shift) — počítá se 24/7.
//   - Konflikty s ostatními BatchOperation na stejném pracovišti.
//   - Konflikty s SlotBlock (dovolené, údržba).
//   - Setup time / cooling / change-over.
//   - Multi-resource constraints (lidi × stroj × materiál).

const { prisma: defaultPrisma } = require('../../config/database');

function operationMinutes(op, quantity) {
  const d = op.duration || 0;
  const u = op.duration_unit || 'MINUTE';
  const perKs = u === 'HOUR' ? d * 60 : u === 'SECOND' ? d / 60 : d;
  return perKs * (quantity || 1);
}

async function scheduleBatch(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const id = parseInt(batchId, 10);
  if (isNaN(id)) throw new Error('Neplatné batchId');

  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: { id: true, batch_number: true, quantity: true, planned_start: true,
      batch_operations: {
        select: {
          id: true, sequence: true, status: true,
          operation: { select: { duration: true, duration_unit: true } },
        },
        orderBy: { sequence: 'asc' },
      } },
  });
  if (!batch) throw new Error(`Dávka id=${id} nenalezena`);
  if (batch.batch_operations.length === 0) {
    return {
      batch_number: batch.batch_number,
      operations_scheduled: 0,
      warning: 'Dávka nemá BatchOperation — nelze plánovat',
    };
  }

  const anchor = batch.planned_start ? new Date(batch.planned_start) : new Date();
  let cursor = new Date(anchor);
  const updates = [];

  for (const op of batch.batch_operations) {
    // Přeskoč už dokončené / zrušené (jejich časy nepřepisujeme)
    if (op.status === 'done' || op.status === 'cancelled') continue;

    const start = new Date(cursor);
    const minutes = operationMinutes(op.operation, batch.quantity);
    const end = new Date(start.getTime() + minutes * 60 * 1000);

    updates.push({
      id: op.id,
      planned_start: start,
      planned_end: end,
      minutes: +minutes.toFixed(1),
    });
    cursor = end;
  }

  if (updates.length === 0) {
    return {
      batch_number: batch.batch_number,
      operations_scheduled: 0,
      warning: 'Všechny operace jsou done/cancelled',
    };
  }

  // Apply v transakci
  await tx.$transaction(async (txx) => {
    for (const u of updates) {
      await txx.batchOperation.update({
        where: { id: u.id },
        data: { planned_start: u.planned_start, planned_end: u.planned_end },
      });
    }
    // Update batch.planned_end na poslední operaci
    const lastEnd = updates[updates.length - 1].planned_end;
    await txx.productionBatch.update({
      where: { id },
      data: {
        planned_start: anchor,
        planned_end: lastEnd,
      },
    });
  });

  return {
    batch_number: batch.batch_number,
    operations_scheduled: updates.length,
    plan_start: anchor.toISOString(),
    plan_end: updates[updates.length - 1].planned_end.toISOString(),
    total_minutes: +updates.reduce((s, u) => s + u.minutes, 0).toFixed(1),
    operations: updates.map(u => ({
      batch_operation_id: u.id,
      planned_start: u.planned_start,
      planned_end: u.planned_end,
      minutes: u.minutes,
    })),
  };
}

module.exports = { scheduleBatch };
