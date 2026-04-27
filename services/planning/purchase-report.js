// =============================================================================
// HolyOS — Plánovač: konsolidovaný nákupní report (F4.5)
// =============================================================================
//
// Agreguje shortage napříč všemi aktivními dávkami (planned/released/in_progress)
// a vrátí seznam materiálů, které je potřeba objednat — sumovaná potřeba per
// (material, supplier).
//
// Pro každou dávku spustí computeMrpForBatch (využívá F4 MRP). V1 nedělá žádnou
// optimalizaci (nepřesouvá Stock mezi dávkami) — pro každou dávku se počítá
// nezávisle proti aktuálnímu Stock. To je konzervativní (= o trochu nadhodnocuje
// shortage), ale bezpečné.
//
// Output:
//   {
//     batches_processed: N,
//     items_count: M,
//     items: [
//       { material, supplier, total_shortage, batches: [...], expected_delivery, ... }
//     ],
//     by_supplier: [ { supplier, items_count, total_value } ]
//   }

const { computeMrpForBatch } = require('./mrp');
const { prisma: defaultPrisma } = require('../../config/database');

const ACTIVE_STATUSES = ['planned', 'released', 'in_progress', 'paused'];

async function computePurchaseReport(opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const statuses = opts.statuses && opts.statuses.length > 0 ? opts.statuses : ACTIVE_STATUSES;

  const batches = await tx.productionBatch.findMany({
    where: { status: { in: statuses } },
    select: { id: true, batch_number: true, status: true, quantity: true,
      product: { select: { code: true, name: true } } },
    orderBy: [{ priority: 'asc' }, { planned_start: 'asc' }],
  });

  // material_id → { material, supplier, total_shortage, contributors[] }
  const acc = new Map();

  for (const b of batches) {
    let mrp;
    try {
      mrp = await computeMrpForBatch(b.id, { tx });
    } catch (e) {
      // Tichá chyba per dávka — ostatní zpracujeme.
      console.warn(`[purchase-report] dávka ${b.batch_number} skip: ${e.message}`);
      continue;
    }
    for (const it of mrp.items || []) {
      if (it.shortage <= 0) continue;
      const cur = acc.get(it.material_id) || {
        material: it.material,
        supplier: it.supplier || null,
        unit: it.unit,
        total_shortage: 0,
        lead_time_days: it.material?.lead_time_days != null ? Number(it.material.lead_time_days) : null,
        contributors: [],
      };
      cur.total_shortage += it.shortage;
      cur.contributors.push({
        batch_id: b.id,
        batch_number: b.batch_number,
        product: b.product ? `${b.product.code} ${b.product.name}` : null,
        quantity: b.quantity,
        shortage: it.shortage,
      });
      acc.set(it.material_id, cur);
    }
  }

  // Sestav items s expected_delivery (today + lead_time_days)
  const today = new Date();
  const items = Array.from(acc.values()).map(it => {
    let expected_delivery = null;
    if (it.lead_time_days != null) {
      const d = new Date(today.getTime() + it.lead_time_days * 86400000);
      expected_delivery = d.toISOString().slice(0, 10);
    }
    return {
      ...it,
      total_shortage: +it.total_shortage.toFixed(4),
      expected_delivery,
    };
  });

  // Sort: nejdřív bez dodavatele (varování), pak podle dodavatele
  items.sort((a, b) => {
    const sa = a.supplier?.name || '~';
    const sb = b.supplier?.name || '~';
    if (sa !== sb) return sa.localeCompare(sb);
    return (a.material?.code || '').localeCompare(b.material?.code || '');
  });

  // Per-supplier summary
  const supplierMap = new Map();
  for (const it of items) {
    const sName = it.supplier?.name || '— bez dodavatele —';
    const cur = supplierMap.get(sName) || {
      supplier: it.supplier || null,
      items_count: 0,
      total_shortage_units: 0,
      sample_lead_time_days: null,
    };
    cur.items_count++;
    cur.total_shortage_units += it.total_shortage;
    if (cur.sample_lead_time_days == null && it.lead_time_days != null) {
      cur.sample_lead_time_days = it.lead_time_days;
    }
    supplierMap.set(sName, cur);
  }

  const by_supplier = Array.from(supplierMap.values()).sort((a, b) => {
    return (a.supplier?.name || '~').localeCompare(b.supplier?.name || '~');
  });

  return {
    batches_processed: batches.length,
    statuses_filter: statuses,
    items_count: items.length,
    items,
    by_supplier,
  };
}

module.exports = { computePurchaseReport };
