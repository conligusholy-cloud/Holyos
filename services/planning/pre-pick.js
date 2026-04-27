// =============================================================================
// HolyOS — Plánovač: Pre-pick V1 (návrh transferů materiálu na pracoviště)
// =============================================================================
//
// Pro každou BatchOperation:
//   1. Zjisti potřebu materiálu (OperationMaterial × batch.quantity)
//   2. Pro každý materiál:
//        - Cíl: workstation.input_location_id
//        - Zdroj: Stock location s největší dostupností (jednoduché FIFO)
//        - Pokud cíl nemá nastavený, návrh "(bez cílové lokace)"
//   3. Konsoliduj duplicity (stejný materiál ve víc operacích → 1 transfer)
//
// V1 je pouze NÁVRH — neplodí žádný InventoryMovement / TransferOrder.
// Uživatel rozhodne, zda transfery vystaví reálně (v UI Skladové doklady).

const { prisma: defaultPrisma } = require('../../config/database');

/**
 * Spočítá pre-pick transfery pro dávku.
 *
 * @param {number} batchId
 * @param {object} [opts]
 * @returns {Promise<object>} { batch, by_workstation, summary }
 */
async function computePrePickForBatch(batchId, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const id = parseInt(batchId, 10);
  if (isNaN(id)) throw new Error('Neplatné batchId');

  const batch = await tx.productionBatch.findUnique({
    where: { id },
    select: {
      id: true, batch_number: true, quantity: true, status: true,
      product: { select: { id: true, code: true, name: true } },
    },
  });
  if (!batch) throw new Error(`Dávka id=${id} nenalezena`);

  // Načti BatchOperation s operations + materials a workstation s lokací
  const ops = await tx.batchOperation.findMany({
    where: { batch_id: id },
    include: {
      operation: { include: { materials: true } },
      workstation: { select: { id: true, name: true, code: true,
        input_location_id: true,
        input_location: { select: { id: true, code: true, name: true, warehouse_id: true } },
      } },
    },
    orderBy: { sequence: 'asc' },
  });

  if (ops.length === 0) {
    return {
      batch, by_workstation: [], summary: { warning: 'Dávka nemá BatchOperation' },
    };
  }

  // Konsolidace: per (workstation_id, material_id) → součet potřeby napříč operacemi
  // Klíč: `${workstation_id || 'null'}:${material_id}`
  const map = new Map();
  for (const op of ops) {
    const wsId = op.workstation_id || null;
    for (const om of op.operation.materials) {
      const key = `${wsId || 'null'}:${om.material_id}`;
      const cur = map.get(key) || {
        workstation_id: wsId,
        workstation: op.workstation,
        material_id: om.material_id,
        unit: om.unit || 'ks',
        needed: 0,
      };
      cur.needed += Number(om.quantity) * batch.quantity;
      map.set(key, cur);
    }
  }

  if (map.size === 0) {
    return {
      batch, by_workstation: [],
      summary: { warning: 'Operace nemají OperationMaterial — nelze sestavit pre-pick' },
    };
  }

  // Načti Material info + Stock per location
  const materialIds = Array.from(new Set(Array.from(map.values()).map(v => v.material_id)));
  const materials = await tx.material.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, code: true, name: true, unit: true },
  });
  const matMap = new Map(materials.map(m => [m.id, m]));

  // Pro každý materiál najdi Stock řádek s největší dostupností (NEJ-source)
  const stocks = await tx.stock.findMany({
    where: { material_id: { in: materialIds } },
    select: {
      material_id: true, location_id: true, quantity: true, reserved_quantity: true,
      location: { select: { id: true, code: true, name: true, warehouse_id: true,
        warehouse: { select: { id: true, name: true } } } },
    },
  });

  // Group by material_id, vyber location s největší available
  const sourceByMat = new Map();
  for (const s of stocks) {
    const avail = Number(s.quantity) - Number(s.reserved_quantity);
    const cur = sourceByMat.get(s.material_id);
    if (!cur || avail > cur.available) {
      sourceByMat.set(s.material_id, {
        location_id: s.location_id,
        location: s.location,
        available: avail,
      });
    }
  }

  // Sestav transfery, group podle pracoviště
  const wsGroups = new Map(); // workstation_id || 'null' → { workstation, transfers }
  for (const item of map.values()) {
    const m = matMap.get(item.material_id);
    const source = sourceByMat.get(item.material_id);
    const target = item.workstation?.input_location || null;
    const sameLocation = source && target && source.location_id === target.id;
    const wsKey = item.workstation_id || 'null';
    const group = wsGroups.get(wsKey) || {
      workstation: item.workstation,
      input_location: target,
      transfers: [],
    };
    group.transfers.push({
      material: m ? { id: m.id, code: m.code, name: m.name, unit: m.unit } : null,
      needed: +item.needed.toFixed(4),
      unit: item.unit,
      source_location: source ? source.location : null,
      source_warehouse: source?.location?.warehouse || null,
      target_location: target,
      available_at_source: source ? +source.available.toFixed(4) : 0,
      sufficient: source ? source.available >= item.needed : false,
      no_transfer_needed: sameLocation, // už je tam, kde má být
      action: !target ? 'no_target' :
              !source ? 'no_source' :
              sameLocation ? 'on_location' :
              source.available < item.needed ? 'shortage' : 'transfer_ok',
    });
    wsGroups.set(wsKey, group);
  }

  const byWorkstation = Array.from(wsGroups.values()).sort((a, b) => {
    return (a.workstation?.name || '').localeCompare(b.workstation?.name || '');
  });

  const allTransfers = byWorkstation.flatMap(g => g.transfers);
  const summary = {
    workstations_count: byWorkstation.length,
    transfers_total: allTransfers.length,
    transfers_ok: allTransfers.filter(t => t.action === 'transfer_ok').length,
    on_location: allTransfers.filter(t => t.action === 'on_location').length,
    shortages: allTransfers.filter(t => t.action === 'shortage').length,
    no_source: allTransfers.filter(t => t.action === 'no_source').length,
    no_target: allTransfers.filter(t => t.action === 'no_target').length,
  };

  return { batch, by_workstation: byWorkstation, summary };
}

module.exports = { computePrePickForBatch };
