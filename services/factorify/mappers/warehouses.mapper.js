// =============================================================================
// HolyOS — Mapper: Factorify Stock → HolyOS Warehouse
// =============================================================================
// Faktorify Stock (51 záznamů) má pole:
//   id, name, HALA (HALA1..HALA4), referenceName, externalId,
//   receiveStock, productionStock, dispatch, consignmentStock, separate,
//   nonconformityStock, excludeFromMaxStockQuantity, loadFloorPlan,
//   orderWeight, palletMaximumCapacity, company, dispositionArea, plant,
//   physicalInventoryCostCenter, readPermission, receivePermission, issuePermission
//
// Strategie:
//   1. Najít existující po factorify_id
//   2. Fallback po name (case-insensitive)
//   3. Pozor: HolyOS má hardcoded warehouse id=1 (SKLAD-A-RK) a id=7 (Sklad Vrtačka).
//      Při importu je nesmím přepsat — jejich Factorify ID si nastavíme manuálně,
//      pokud Factorify name odpovídá.
//
// Type mapping (HolyOS Warehouse.type — main je default):
//   - dispatch=true       → 'dispatch'
//   - consignmentStock    → 'consignment'
//   - productionStock     → 'production'
//   - nonconformityStock  → 'nonconformity'
//   - default             → 'main'
// =============================================================================

const { getStr, trimStr, ImportStats } = require('./_helpers');

function mapWarehouseType(raw) {
  if (raw.dispatch) return 'dispatch';
  if (raw.consignmentStock) return 'consignment';
  if (raw.productionStock) return 'production';
  if (raw.nonconformityStock) return 'nonconformity';
  if (raw.receiveStock) return 'receiving';
  return 'main';
}

async function upsertWarehouse(prisma, raw, opts = {}) {
  const stats = opts.stats || new ImportStats('warehouses');
  const factorifyId = raw?.id != null ? String(raw.id) : null;
  if (!factorifyId) { stats.noteSkip('missing id'); return null; }

  const name = trimStr(getStr(raw, 'name', 'referenceName'), 255);
  if (!name) { stats.noteSkip(`${factorifyId}: missing name`); return null; }

  const halaCode = trimStr(getStr(raw, 'HALA'), 20);
  const code = trimStr(getStr(raw, 'externalId') || `FY-${factorifyId}`, 50);
  const type = mapWarehouseType(raw);

  const data = {
    name,
    code,
    type,
    factorify_id: trimStr(factorifyId, 100),
    hala_code: halaCode,
    active: true,
  };

  if (opts.dryRun) {
    stats.noteCreate();
    if (opts.idCache) opts.idCache.set('warehouses', factorifyId, -1);
    return null;
  }

  try {
    // 1) Po factorify_id
    let existing = await prisma.warehouse.findFirst({
      where: { factorify_id: factorifyId },
      select: { id: true },
    });
    // 2) Fallback: po jméně (case-insensitive)
    if (!existing) {
      existing = await prisma.warehouse.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
    }
    let warehouseId;
    if (existing) {
      // Pokud je to hardcoded warehouse (id=1, id=7), nepřepisujeme name/code,
      // jen doplníme factorify_id a hala_code (paměť: holyos_warehouse_ids).
      const isHardcoded = existing.id === 1 || existing.id === 7;
      const updateData = isHardcoded
        ? { factorify_id: data.factorify_id, hala_code: data.hala_code }
        : data;
      await prisma.warehouse.update({ where: { id: existing.id }, data: updateData });
      warehouseId = existing.id;
      stats.noteUpdate();
    } else {
      const created = await prisma.warehouse.create({ data });
      warehouseId = created.id;
      stats.noteCreate();
    }
    if (opts.idCache) opts.idCache.set('warehouses', factorifyId, warehouseId);
    return warehouseId;
  } catch (e) {
    stats.noteFail(e, { factorify_id: factorifyId, name });
    return null;
  }
}

async function upsertWarehouses(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('warehouses');
  const onProgress = opts.onProgress;
  for (let i = 0; i < rawList.length; i++) {
    await upsertWarehouse(prisma, rawList[i], { ...opts, stats });
    if (onProgress && (i + 1) % 10 === 0) onProgress(i + 1, rawList.length);
  }
  if (onProgress) onProgress(rawList.length, rawList.length);
  return stats;
}

module.exports = { upsertWarehouse, upsertWarehouses, mapWarehouseType };
