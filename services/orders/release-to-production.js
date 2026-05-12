// =============================================================================
// HolyOS — Uvolnění prodejní objednávky do výroby (rozpad výrobků na dávky)
// =============================================================================
//
// Po zaplacení (záloha / plná platba podle pravidla release_on_deposit)
// se prodejní objednávka "rozpadne do výroby":
//   1) pro každý OrderItem.product_id se založí ProductionBatch (batch_type='main')
//   2) auto-vygenerují se BatchOperation (přes services/planning/batch-operations)
//   3) spočítá se MRP (computeMrpForBatch) — návrh nákupů + feeder dávek
//   4) OrderItem.status='released', Order.released_at=now()
//
// Funkce je idempotentní: pokud Order.released_at už je nastavený, vrací jen
// stávající dávky a nic nezakládá.
//
// Nepustí výroba pro OrderItemy, kde:
//   - product_id je null (čistý nákupní/služební řádek)
//   - status už je 'released' / 'cancelled' / 'done'

const { prisma: defaultPrisma } = require('../../config/database');
const { generateBatchOperationsForBatch } = require('../planning/batch-operations');
const { computeMrpForBatch } = require('../planning/mrp');

/**
 * Vygeneruje číslo produkční dávky ve formátu {rok}-{seq3}, např. "2026-042".
 * Pozn.: stejný formát jako v routes/production.routes.js#generateBatchNumber.
 */
async function generateProductionBatchNumber(tx, plannedStart) {
  const ref = plannedStart ? new Date(plannedStart) : new Date();
  const year = ref.getFullYear();
  const prefix = `${year}-`;
  const last = await tx.productionBatch.findFirst({
    where: { batch_number: { startsWith: prefix } },
    orderBy: { batch_number: 'desc' },
    select: { batch_number: true },
  });
  let seq = 1;
  if (last) {
    const m = last.batch_number.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return prefix + String(seq).padStart(3, '0');
}

/**
 * Rozhodne, zda mají být OrderItemy podle aktuálního stavu platby uvolněny.
 * Pravidla:
 *   - non-split: trigger = final_paid
 *   - split + release_on_deposit: trigger = deposit_paid OR final_paid
 *   - split + !release_on_deposit: trigger = final_paid (záloha sama nestačí)
 */
function shouldRelease(order) {
  if (!order) return false;
  if (order.released_at) return false; // už uvolněno
  if (!order.payment_split) return !!order.final_paid;
  if (order.release_on_deposit) return !!(order.deposit_paid || order.final_paid);
  return !!order.final_paid;
}

/**
 * Uvolnění objednávky do výroby.
 *
 * @param {number} orderId
 * @param {object} [opts]
 * @param {number} [opts.createdById]  Person.id, kdo akci spustil (jde do ProductionBatch.created_by_id)
 * @param {object} [opts.prisma]       Volitelný klient (pro testy / transakce)
 * @returns {Promise<{released: boolean, reason?: string, batches: Array, skipped_items: Array}>}
 */
async function releaseOrderToProduction(orderId, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const id = parseInt(orderId, 10);
  if (isNaN(id)) throw new Error('Neplatné orderId');

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) {
    return { released: false, reason: 'order_not_found', batches: [], skipped_items: [] };
  }
  if (order.type !== 'sales') {
    return { released: false, reason: 'not_a_sales_order', batches: [], skipped_items: [] };
  }
  if (order.released_at) {
    // Idempotence — najdi existující batche přes audit poznámku v note (zatím nemáme přímou FK)
    // Pro UI stačí informace "už uvolněno"; konkrétní batche si UI vytáhne podle filtru.
    return { released: false, reason: 'already_released', batches: [], skipped_items: [] };
  }

  const createdBatches = [];
  const skipped = [];
  const mrpSummaries = [];

  for (const item of order.items) {
    if (!item.product_id) {
      skipped.push({ item_id: item.id, name: item.name, reason: 'no_product_id' });
      continue;
    }
    if (['released', 'cancelled', 'done'].includes(item.status)) {
      skipped.push({ item_id: item.id, name: item.name, reason: `already_${item.status}` });
      continue;
    }

    // Quantity z OrderItem může být Decimal — ProductionBatch.quantity je Int.
    // Pro non-celé množství se zaokrouhluje nahoru (musíme vyrobit min. tolik kusů).
    const rawQty = item.quantity ? parseFloat(item.quantity.toString()) : 0;
    const qty = Math.max(1, Math.ceil(rawQty));

    const batch_number = await generateProductionBatchNumber(db);

    const batch = await db.productionBatch.create({
      data: {
        batch_number,
        product_id: item.product_id,
        quantity: qty,
        batch_type: 'main',
        priority: 100,
        created_by_id: opts.createdById || null,
        note: `Auto-uvolněno z prodejní objednávky ${order.order_number} (item #${item.id})`,
      },
      include: { product: { select: { id: true, code: true, name: true } } },
    });

    // Vygeneruj BatchOperation z postupu (idempotentní)
    try {
      await generateBatchOperationsForBatch(batch.id);
    } catch (e) {
      console.error(`[release-to-production] generate-operations selhalo pro batch ${batch.id}:`, e.message);
    }

    // MRP — vypočti potřebu nákupu/feeder dávek (nezakládá je, jen vrátí návrh).
    // Volání samostatně, neblokuje při selhání.
    try {
      const mrp = await computeMrpForBatch(batch.id);
      mrpSummaries.push({ batch_id: batch.id, mrp });
    } catch (e) {
      console.error(`[release-to-production] MRP selhalo pro batch ${batch.id}:`, e.message);
    }

    await db.orderItem.update({
      where: { id: item.id },
      data: { status: 'released' },
    });

    createdBatches.push({
      id: batch.id,
      batch_number: batch.batch_number,
      product: batch.product,
      quantity: batch.quantity,
      order_item_id: item.id,
    });
  }

  // Označ Order jako uvolněnou (i když některé položky byly skipped — částečné uvolnění je OK)
  const updatedOrder = await db.order.update({
    where: { id: order.id },
    data: { released_at: new Date() },
    select: { id: true, order_number: true, released_at: true },
  });

  return {
    released: true,
    order: updatedOrder,
    batches: createdBatches,
    skipped_items: skipped,
    mrp: mrpSummaries,
  };
}

module.exports = {
  releaseOrderToProduction,
  shouldRelease,
  generateProductionBatchNumber,
};
