// =============================================================================
// HolyOS — Plánovač: dílčí dávky polotovarů (feeder batches)
// =============================================================================
// Když operace výrobku spotřebovává díl, který má VLASTNÍ pracovní postup (polotovar / podsestava)
// a není ho dost skladem, založí se automaticky dílčí dávka (parent_batch_id = rodič), rekurzivně
// do hloubky. Dílčí dávky se plánují PŘED rodičem a operace rodiče, která díl spotřebovává,
// nesmí začít dřív, než je dílčí dávka hotová (hlídá scheduler přes feederReadyAt).
// =============================================================================

'use strict';

const { prisma: defaultPrisma } = require('../../config/database');

const BATCH_SUFFIX_RE = /^(.*?)(?:-(\d+))?$/;

async function nextFeederNumber(tx, parentNumber) {
  // Číslo dílčí dávky = číslo rodiče + pořadí: TEST-2026-001-1, -2 …
  const rows = await tx.productionBatch.findMany({ where: { batch_number: { startsWith: parentNumber + '-' } }, select: { batch_number: true } });
  let max = 0;
  for (const r of rows) { const m = r.batch_number.slice(parentNumber.length + 1).match(/^(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return parentNumber + '-' + (max + 1);
}

/**
 * Založí dílčí dávky pro dávku `batchId` (a rekurzivně pro ně).
 * @returns {{ created: Array, skipped: Array }} created = [{ id, batch_number, product, quantity, for_material }], skipped = [{ product, reason }]
 */
async function createFeederBatches(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const depth = opts.depth || 0;
  const out = { created: [], skipped: [] };
  if (depth > 8) return out;
  const id = parseInt(batchId, 10);
  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: { id: true, batch_number: true, product_id: true, quantity: true, is_test: true, ignore_stock: true, priority: true, status: true,
      batch_operations: { where: { status: { not: 'cancelled' } }, select: { operation: { select: { id: true, step_number: true, name: true, materials: { select: { material_id: true, product_id: true, quantity: true, unit: true, material: { select: { id: true, code: true, name: true } } } } } } } },
      feeder_batches: { select: { id: true, product_id: true, quantity: true, status: true } } },
  });
  if (!batch) return out;

  // Potřeba per díl (materiál) napříč operacemi dávky
  const need = new Map(); // material_id → { qty, product_id, material }
  for (const bo of batch.batch_operations) {
    for (const m of (bo.operation?.materials || [])) {
      const q = Number(m.quantity) * Number(batch.quantity);
      const cur = need.get(m.material_id) || { qty: 0, product_id: m.product_id || null, material: m.material };
      cur.qty += q; if (!cur.product_id && m.product_id) cur.product_id = m.product_id;
      need.set(m.material_id, cur);
    }
  }
  if (!need.size) return out;

  // Díl → výrobek s postupem (přímo z OperationMaterial.product_id, nebo Product.material_id)
  const matIds = [...need.keys()];
  const linked = await tx.product.findMany({ where: { OR: [{ id: { in: [...need.values()].map(v => v.product_id).filter(Boolean) } }, { material_id: { in: matIds } }] }, select: { id: true, code: true, name: true, material_id: true, active: true, operations: { where: { is_staging: false, variant_of_id: null }, select: { id: true, variants: { select: { id: true } } } }, equipment: { select: { id: true } }, output_variants: { select: { id: true } } } });
  const byId = new Map(linked.map(p => [p.id, p])), byMat = new Map(linked.filter(p => p.material_id).map(p => [p.material_id, p]));

  // Zásoba (dostupná = množství − rezervace)
  const stock = batch.ignore_stock ? [] : await tx.stock.findMany({ where: { material_id: { in: matIds } }, select: { material_id: true, quantity: true, reserved_quantity: true } });
  const avail = new Map(); for (const s of stock) avail.set(s.material_id, (avail.get(s.material_id) || 0) + Number(s.quantity) - Number(s.reserved_quantity || 0));
  // Už existující dílčí dávky rodiče (idempotence)
  const existingFor = new Map(); for (const f of batch.feeder_batches) if (f.status !== 'cancelled') existingFor.set(f.product_id, (existingFor.get(f.product_id) || 0) + Number(f.quantity));

  for (const [matId, n] of need) {
    const prod = (n.product_id && byId.get(n.product_id)) || byMat.get(matId);
    if (!prod || !prod.operations.length) continue; // nakupovaný díl → řeší nákup (MRP)
    const shortage = batch.ignore_stock ? n.qty : n.qty - Math.max(0, avail.get(matId) || 0);
    if (shortage <= 0) continue;
    const already = existingFor.get(prod.id) || 0;
    const qty = Math.ceil(shortage - already);
    if (qty <= 0) continue;
    const needsChoice = prod.operations.some(o => o.variants.length) || prod.output_variants.length;
    if (needsChoice) { out.skipped.push({ product: { id: prod.id, code: prod.code, name: prod.name }, quantity: qty, reason: 'Polotovar má varianty/výbavu — zadej ho do výroby ručně s volbou provedení.' }); continue; }
    const number = await nextFeederNumber(tx, batch.batch_number);
    const child = await tx.productionBatch.create({
      data: { batch_number: number, product_id: prod.id, quantity: qty, status: 'planned', batch_type: 'feeder', priority: batch.priority, parent_batch_id: batch.id, is_test: batch.is_test, ignore_stock: batch.ignore_stock,
        note: 'Dílčí dávka pro ' + batch.batch_number + ' — ' + (n.material ? (n.material.code + ' ' + n.material.name) : 'díl') + ' (potřeba ' + n.qty + ', skladem ' + Math.max(0, avail.get(matId) || 0) + ')' },
      select: { id: true, batch_number: true, quantity: true },
    });
    const { generateBatchOperationsForBatch } = require('./batch-operations');
    await generateBatchOperationsForBatch(child.id, { tx });
    out.created.push({ id: child.id, batch_number: child.batch_number, quantity: child.quantity, product: { id: prod.id, code: prod.code, name: prod.name }, for_material: n.material ? { id: n.material.id, code: n.material.code, name: n.material.name } : null, parent_id: batch.id });
    // rekurze: polotovar může sám potřebovat další polotovary
    const sub = await createFeederBatches(child.id, { tx, depth: depth + 1 });
    out.created.push(...sub.created); out.skipped.push(...sub.skipped);
  }
  return out;
}

/** Dílčí dávky rodiče (hloubka 1) — pro plánování: nejdřív děti, pak rodič. */
async function listFeeders(tx, batchId) {
  return tx.productionBatch.findMany({ where: { parent_batch_id: parseInt(batchId, 10), status: { in: ['planned', 'released', 'in_progress', 'paused'] } }, select: { id: true, batch_number: true, product_id: true, quantity: true, planned_end: true, status: true, product: { select: { id: true, code: true, name: true, material_id: true } } }, orderBy: { id: 'asc' } });
}

module.exports = { createFeederBatches, listFeeders };
