// =============================================================================
// HolyOS — Mapper: Factorify StockPhysicalInventory + Position → Inventory + Item
// =============================================================================
// StockPhysicalInventory (164) — hlavička inventury (jaký sklad, kdo, kdy).
// StockPhysicalInventoryPosition (387) — řádky inventury (materiál, expected vs actual).
// StockPhysicalInventoryRecord (mega) — detailní log počítání. Pro start skipujeme,
//   nemá to v HolyOS strukturu (jednotlivé "scan" záznamy lze odvodit ze StockMove).
//
// Závislosti:
//   - warehouses → idCache.warehouses (FY Stock.id → HolyOS Warehouse.id)
//   - materials  → idCache.materials  (FY Goods.id → HolyOS Material.id)
//
// Pořadí:
//   1) upsertInventories
//   2) upsertInventoryItems (vyžaduje hotové inventories)
// =============================================================================

const {
  getStr, getNum, getDate, refId, trimStr, ImportStats,
  batchUpsertByFactorifyId,
} = require('./_helpers');

/**
 * Faktorify StockPhysicalInventory.stockIds je POLE skladů — jedna inventura
 * může pokrývat víc skladů. V HolyOS Inventory je vázaná na jeden warehouse,
 * tak vytvoříme N samostatných Inventory záznamů (jeden per sklad v stockIds).
 *
 * factorify_id formát: "{physInvId}-{stockId}" (kompozitní, ať můžeme idempotentně)
 *
 * State hodnoty z Factorify (string): NEW, IN_PROGRESS, CANCELLED, CLOSED, COMPLETED.
 */
async function upsertInventories(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('inventories');
  if (!opts.idCache) throw new Error('upsertInventories vyžaduje opts.idCache');

  const dataList = [];
  let missingWarehouse = 0, noStocks = 0;
  for (const raw of rawList) {
    const physInvId = raw?.id != null ? String(raw.id) : null;
    if (!physInvId) { stats.noteSkip('missing id'); continue; }

    const stockIds = Array.isArray(raw?.stockIds) ? raw.stockIds : [];
    if (stockIds.length === 0) { noStocks++; stats.noteSkip(`${physInvId}: žádné stockIds`); continue; }

    // state je STRING, ne objekt
    const state = String(raw?.state || '').toUpperCase();
    const status = (state === 'CLOSED' || state === 'COMPLETED' || state === 'OK') ? 'completed' :
                   state === 'CANCELLED' ? 'cancelled' :
                   'in_progress';

    const startedAt = getDate(raw, 'createdAt');
    const completedAt = getDate(raw, 'updatedAt');
    const baseName = trimStr(getStr(raw, 'name', 'referenceName') || `FY inventura ${physInvId}`, 200);

    // Pro každý sklad ve stockIds vytvoříme jednu Inventory
    for (const stockRef of stockIds) {
      const stockFid = stockRef?.id != null ? String(stockRef.id) : null;
      const warehouse_id = stockFid ? opts.idCache.get('warehouses', stockFid) : null;
      if (!warehouse_id) {
        missingWarehouse++;
        stats.noteSkip(`${physInvId}-${stockFid}: warehouse ${stockFid} nenalezen`);
        continue;
      }

      // Kompozitní factorify_id ať dva sklady ze stejné inventury nekolidovaly
      const compositeFid = `${physInvId}-${stockFid}`;
      // Suffix v name pro odlišení (pokud má inventura víc skladů)
      const name = stockIds.length > 1
        ? trimStr(`${baseName} (${stockRef.referenceName || stockFid})`, 255)
        : baseName;

      dataList.push({
        warehouse_id,
        name,
        status,
        started_at: startedAt,
        completed_at: status === 'completed' ? completedAt : null,
        note: null,
        factorify_id: trimStr(compositeFid, 100),
        created_at: startedAt || new Date(),
      });
    }
  }

  if (noStocks || missingWarehouse) {
    console.log(`  ⚠ ${noStocks} inventur bez stockIds, ${missingWarehouse} skipnuto (warehouse nenalezen)`);
  }

  return await batchUpsertByFactorifyId(prisma, 'inventory', dataList, {
    ...opts,
    stats,
    idCacheTable: 'inventories',
  });
}

/**
 * StockPhysicalInventoryPosition jen referencuje pozici (lokaci) v rámci
 * inventury. Faktická count data jsou ve StockPhysicalInventoryRecord (mega).
 * Pro start tedy přeskakujeme — v HolyOS to nemá strukturní ekvivalent.
 *
 * Funkci necháváme pro budoucí use, kdyby se importoval Record (přes streaming).
 */
async function upsertInventoryItems(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('inventory_items');
  if (!opts.idCache) throw new Error('upsertInventoryItems vyžaduje opts.idCache');

  const dataList = [];
  let missingInventory = 0, missingMaterial = 0;
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    const inventoryFid = refId(raw?.stockPhysicalInventory) || refId(raw?.physicalInventory);
    const inventory_id = inventoryFid ? opts.idCache.get('inventories', inventoryFid) : null;
    if (!inventory_id) { missingInventory++; stats.noteSkip(`${factorifyId}: inventory ${inventoryFid} nenalezena`); continue; }

    const materialFid = refId(raw?.goods);
    const material_id = materialFid ? opts.idCache.get('materials', materialFid) : null;
    if (!material_id) { missingMaterial++; stats.noteSkip(`${factorifyId}: material ${materialFid} nenalezen`); continue; }

    const expected_qty = getNum(raw, 'expectedQuantity', 'expected') || 0;
    const actual_qty = getNum(raw, 'actualQuantity', 'counted', 'realQuantity');
    const difference = actual_qty != null ? actual_qty - expected_qty : null;

    dataList.push({
      inventory_id,
      material_id,
      expected_qty,
      actual_qty,
      difference,
      counted_at: getDate(raw, 'countedAt', 'updatedAt'),
      note: getStr(raw, 'note'),
      factorify_id: trimStr(factorifyId, 100),
    });
  }

  if (missingInventory || missingMaterial) {
    console.log(`  ⚠ Skip: ${missingInventory} bez inventur, ${missingMaterial} bez materials`);
  }

  return await batchUpsertByFactorifyId(prisma, 'inventoryItem', dataList, {
    ...opts,
    stats,
    idCacheTable: 'inventory_items',
  });
}

module.exports = { upsertInventories, upsertInventoryItems };
