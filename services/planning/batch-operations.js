// =============================================================================
// HolyOS — Plánovač: generátor BatchOperation z ProductionBatch
// =============================================================================
//
// Sdílená logika pro vytvoření instancí operací (BatchOperation) z dávky.
// Použití:
//   - automaticky při POST /api/production/batches (default chování)
//   - manuálně přes POST /api/planning/batches/:id/generate-operations
//
// V1 generuje 1:1 podle ProductOperation:
//   - sequence = op.step_number
//   - workstation_id = op.workstation_id
//   - status = 'ready' (rovnou dostupné v kiosku)
//
// TODO pro F3 plnou:
//   - planned_start / planned_end z kapacitního plánu (RCCP)
//   - závislosti mezi operacemi (jen po dokončení předchozí přejde z pending → ready)
//   - feeder dávky (parent_batch_id rozpouští komponenty na sub-dávky)

const { prisma: defaultPrisma } = require('../../config/database');

/**
 * Vygeneruje BatchOperation pro všechny ProductOperation dané dávky.
 * Idempotentní: pokud už nějaké BatchOperation pro dávku existují, nic nepřidává.
 *
 * @param {number} batchId
 * @param {object} [opts]
 * @param {object} [opts.tx]            Volitelný Prisma transaction klient.
 * @param {string} [opts.initialStatus] Default 'ready'. 'pending' pokud chceš ručně releasovat.
 * @returns {{ skipped: boolean, created_count: number, existing_count: number, batch_operations: Array }}
 */
async function generateBatchOperationsForBatch(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const initialStatus = opts.initialStatus || 'ready';

  const id = parseInt(batchId, 10);
  if (isNaN(id)) throw new Error('Neplatné batchId');

  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: {
      id: true, product_id: true, batch_number: true,
      _count: { select: { batch_operations: true } },
    },
  });
  if (!batch) throw new Error(`Dávka id=${id} nenalezena`);

  if (batch._count.batch_operations > 0) {
    return {
      skipped: true,
      created_count: 0,
      existing_count: batch._count.batch_operations,
      batch_operations: [],
    };
  }

  const productOps = await tx.productOperation.findMany({
    where: { product_id: batch.product_id },
    orderBy: { step_number: 'asc' },
    select: { id: true, step_number: true, workstation_id: true, name: true },
  });

  if (productOps.length === 0) {
    return {
      skipped: true,
      created_count: 0,
      existing_count: 0,
      batch_operations: [],
      warning: `Produkt id=${batch.product_id} nemá žádné ProductOperation — BatchOperation nelze vygenerovat`,
    };
  }

  // V Prisma createMany nevrací řádky; pro přehled vracíme zase findMany.
  await tx.batchOperation.createMany({
    data: productOps.map(op => ({
      batch_id: id,
      operation_id: op.id,
      workstation_id: op.workstation_id,
      sequence: op.step_number,
      status: initialStatus,
    })),
  });

  const batchOperations = await tx.batchOperation.findMany({
    where: { batch_id: id },
    orderBy: { sequence: 'asc' },
    include: {
      operation: { select: { id: true, name: true, step_number: true, duration: true } },
      workstation: { select: { id: true, name: true } },
    },
  });

  return {
    skipped: false,
    created_count: batchOperations.length,
    existing_count: 0,
    batch_operations: batchOperations,
  };
}

module.exports = { generateBatchOperationsForBatch };
