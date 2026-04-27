// =============================================================================
// HolyOS — Plánovač: MRP V1 (Material Requirements Planning)
// =============================================================================
//
// V1 logika:
//   1. Načti dávku + BOM (snapshot pokud má, jinak fallback na OperationMaterial)
//   2. Pro každou BOM položku spočítej:
//        needed   = bom_qty_per_ks × batch_quantity
//        available = SUM(Stock.quantity - reserved_quantity) přes všechny lokace
//        shortage  = max(0, needed - available)
//   3. Pro každý shortage > 0 navrhni PO:
//        quantity_to_order   = max(shortage, material.batch_size_default || shortage)
//        expected_delivery   = today + material.lead_time_days
//
// V1 NEŘEŠÍ:
//   - Rekurzi přes polotovary (sub-produkty se chovají jako samostatný materiál)
//   - Reservace stocku napříč více souběžných dávek (FIFO/LIFO ze stock pool)
//   - Konsolidaci PO per supplier
//   - Forecast / safety stock
//   - Multi-warehouse alokaci (sčítáme přes vše)

const { prisma: defaultPrisma } = require('../../config/database');

/**
 * Spočítá MRP analýzu pro jednu dávku.
 *
 * @param {number} batchId
 * @param {object} [opts]
 * @param {object} [opts.tx]  Volitelný Prisma tx klient.
 * @returns {Promise<object>} { batch, bom_source, items, summary, po_proposals }
 */
async function computeMrpForBatch(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const id = parseInt(batchId, 10);
  if (isNaN(id)) throw new Error('Neplatné batchId');

  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: {
      id: true, batch_number: true, product_id: true, quantity: true, status: true,
      bom_snapshot_id: true,
      product: { select: { id: true, code: true, name: true } },
    },
  });
  if (!batch) throw new Error(`Dávka id=${id} nenalezena`);

  // ── 1. Vyřeš BOM ─────────────────────────────────────────────────────────
  // Vrátíme pole { material_id, qty_per_ks, unit, source_operation_id? }
  let bomItems = [];
  let bomSource = 'computed';

  if (batch.bom_snapshot_id) {
    const items = await tx.bomSnapshotItem.findMany({
      where: { snapshot_id: batch.bom_snapshot_id },
      select: { material_id: true, quantity: true, unit: true, source_operation_id: true },
    });
    bomItems = items.map(it => ({
      material_id: it.material_id,
      qty_per_ks: Number(it.quantity),
      unit: it.unit,
      source_operation_id: it.source_operation_id,
    }));
    bomSource = 'bom_snapshot';
  } else {
    // Fallback: agreguj OperationMaterial přes ProductOperation produktu.
    const ops = await tx.productOperation.findMany({
      where: { product_id: batch.product_id },
      include: { materials: true },
    });
    const acc = new Map(); // material_id → { qty_per_ks, unit }
    for (const op of ops) {
      for (const om of op.materials) {
        const cur = acc.get(om.material_id) || { qty_per_ks: 0, unit: om.unit, source_operation_id: op.id };
        cur.qty_per_ks += Number(om.quantity);
        acc.set(om.material_id, cur);
      }
    }
    bomItems = Array.from(acc.entries()).map(([material_id, v]) => ({
      material_id,
      qty_per_ks: v.qty_per_ks,
      unit: v.unit,
      source_operation_id: v.source_operation_id,
    }));
    bomSource = 'fallback_operation_materials';
  }

  if (bomItems.length === 0) {
    return {
      batch,
      bom_source: bomSource,
      items: [],
      summary: { all_materials_ok: true, items_count: 0, shortage_count: 0, warning: 'BOM je prázdný' },
      po_proposals: [],
    };
  }

  // ── 2. Načti Material info + Stock agregát ───────────────────────────────
  const materialIds = bomItems.map(b => b.material_id);
  const materials = await tx.material.findMany({
    where: { id: { in: materialIds } },
    select: {
      id: true, code: true, name: true, unit: true,
      lead_time_days: true, batch_size_default: true, batch_size_min: true,
      supplier_id: true,
      supplier: { select: { id: true, name: true } },
    },
  });
  const matMap = new Map(materials.map(m => [m.id, m]));

  const stockSums = await tx.stock.groupBy({
    by: ['material_id'],
    where: { material_id: { in: materialIds } },
    _sum: { quantity: true, reserved_quantity: true },
  });
  const stockMap = new Map();
  for (const s of stockSums) {
    const total = Number(s._sum.quantity || 0);
    const reserved = Number(s._sum.reserved_quantity || 0);
    stockMap.set(s.material_id, { total, reserved, available: total - reserved });
  }

  // ── 3. Sestav per-material analýzu ────────────────────────────────────────
  const today = new Date();
  const items = bomItems.map(b => {
    const m = matMap.get(b.material_id);
    const stock = stockMap.get(b.material_id) || { total: 0, reserved: 0, available: 0 };
    const needed = +(b.qty_per_ks * batch.quantity).toFixed(4);
    const shortage = +Math.max(0, needed - stock.available).toFixed(4);

    let expected_delivery = null;
    if (m && m.lead_time_days != null && shortage > 0) {
      const days = Number(m.lead_time_days);
      const d = new Date(today.getTime() + days * 86400000);
      expected_delivery = d.toISOString().slice(0, 10);
    }

    return {
      material_id: b.material_id,
      material: m ? { id: m.id, code: m.code, name: m.name, unit: m.unit, lead_time_days: m.lead_time_days } : null,
      qty_per_ks: b.qty_per_ks,
      unit: b.unit,
      needed,
      stock: stock,
      shortage,
      expected_delivery,
      supplier: m?.supplier || null,
    };
  });

  // ── 4. PO návrhy pro materiály se shortage > 0 ───────────────────────────
  const poProposals = items
    .filter(it => it.shortage > 0)
    .map(it => {
      const m = matMap.get(it.material_id);
      // Kvantita: pokud má material batch_size_default, zaokrouhli nahoru na násobek
      let qtyToOrder = it.shortage;
      if (m?.batch_size_default && Number(m.batch_size_default) > 0) {
        const step = Number(m.batch_size_default);
        qtyToOrder = Math.ceil(it.shortage / step) * step;
      } else if (m?.batch_size_min && Number(m.batch_size_min) > 0) {
        const min = Number(m.batch_size_min);
        if (qtyToOrder < min) qtyToOrder = min;
      }
      return {
        material: it.material,
        supplier: it.supplier,
        quantity_to_order: +qtyToOrder.toFixed(4),
        unit: it.unit,
        lead_time_days: m?.lead_time_days != null ? Number(m.lead_time_days) : null,
        expected_delivery: it.expected_delivery,
        shortage: it.shortage,
      };
    });

  const shortageCount = items.filter(it => it.shortage > 0).length;

  return {
    batch: {
      id: batch.id, batch_number: batch.batch_number, status: batch.status,
      quantity: batch.quantity, product: batch.product,
    },
    bom_source: bomSource,
    items,
    summary: {
      all_materials_ok: shortageCount === 0,
      items_count: items.length,
      shortage_count: shortageCount,
    },
    po_proposals: poProposals,
  };
}

module.exports = { computeMrpForBatch };
