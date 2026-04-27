// =============================================================================
// HolyOS — Plánovač: state transitions dávek (auto-close + audit)
// =============================================================================
//
// `checkAndCloseBatch(batchId)`:
//   - Spočítá BatchOperation per status pro dávku.
//   - Pokud všechny operace jsou 'done' nebo 'cancelled' (a alespoň 1 je 'done'),
//     automaticky přepne batch.status na 'done' a nastaví actual_end = NOW.
//   - Idempotentní — pokud je batch už 'done' nebo 'cancelled', nic neudělá.
//   - Vrátí stav před a po, plus důvod akce.

const { prisma: defaultPrisma } = require('../../config/database');

const FINAL_OP_STATUSES = ['done', 'cancelled'];

async function checkAndCloseBatch(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const id = parseInt(batchId, 10);
  if (isNaN(id)) throw new Error('Neplatné batchId');

  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: {
      id: true, batch_number: true, status: true,
      actual_start: true, actual_end: true,
    },
  });
  if (!batch) throw new Error(`Dávka id=${id} nenalezena`);

  // Už finalizovaná — nic neměň
  if (batch.status === 'done' || batch.status === 'cancelled') {
    return { batch_number: batch.batch_number, status_before: batch.status, status_after: batch.status, action: 'noop_already_final' };
  }

  // Spočítej operace per status
  const grouped = await tx.batchOperation.groupBy({
    by: ['status'],
    where: { batch_id: id },
    _count: { _all: true },
  });
  const counts = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    total += g._count._all;
  }

  if (total === 0) {
    return { batch_number: batch.batch_number, status_before: batch.status, status_after: batch.status,
             action: 'noop_no_operations', counts };
  }

  const finalCount = (counts.done || 0) + (counts.cancelled || 0);
  const allFinal = finalCount === total;
  const hasDone = (counts.done || 0) > 0;

  if (!allFinal) {
    return { batch_number: batch.batch_number, status_before: batch.status, status_after: batch.status,
             action: 'noop_in_progress', counts, total };
  }

  if (!hasDone) {
    // Všechny operace cancelled — dávku považujeme za zrušenou (ne done)
    const updated = await tx.productionBatch.update({
      where: { id },
      data: { status: 'cancelled', actual_end: new Date() },
      select: { batch_number: true, status: true, actual_end: true },
    });
    return { batch_number: updated.batch_number, status_before: batch.status, status_after: 'cancelled',
             action: 'auto_cancelled', counts, total, actual_end: updated.actual_end };
  }

  // Standardní close — všechny operace done (nebo done+cancelled)
  const updated = await tx.productionBatch.update({
    where: { id },
    data: { status: 'done', actual_end: new Date() },
    select: { batch_number: true, status: true, actual_end: true },
  });
  return {
    batch_number: updated.batch_number,
    status_before: batch.status,
    status_after: 'done',
    action: 'auto_closed',
    counts, total,
    actual_end: updated.actual_end,
  };
}

module.exports = { checkAndCloseBatch };
