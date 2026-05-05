// =============================================================================
// HolyOS — Mapper: Factorify BuyingPriceList(Item) → HolyOS SupplierPriceList(Item)
// =============================================================================
// BuyingPriceList (2028 záznamů) — kombinace (supplier × goods × validita).
// BuyingPriceListItem (1329 záznamů) — cenové tiery (množstevní slevy).
//
// Závislosti:
//   - suppliers (Company) musí být importovány předem  → idCache.companies
//   - materials (Goods) musí být importovány předem    → idCache.materials
//
// Jeden PriceList může mít 0..N items. Items mapujeme přes vazbu price_list.factorify_id.
// =============================================================================

const {
  getStr, getNum, getDate, getBool, refId, trimStr, ImportStats,
  batchUpsertByFactorifyId,
} = require('./_helpers');

/**
 * Importuje hlavičky (BuyingPriceList → SupplierPriceList).
 * @param {object} opts.idCache  - musí mít předehřáté companies + materials
 */
async function upsertPriceLists(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('price_lists');
  if (!opts.idCache) throw new Error('upsertPriceLists vyžaduje opts.idCache');

  const dataList = [];
  let missingSupplier = 0, missingMaterial = 0;
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    const supplierFid = refId(raw?.supplier);
    const materialFid = refId(raw?.goods);
    const supplier_id = supplierFid ? opts.idCache.get('companies', supplierFid) : null;
    const material_id = materialFid ? opts.idCache.get('materials', materialFid) : null;

    if (!supplier_id) { missingSupplier++; stats.noteSkip(`${factorifyId}: supplier ${supplierFid} nenalezen`); continue; }
    if (!material_id) { missingMaterial++; stats.noteSkip(`${factorifyId}: material ${materialFid} nenalezen`); continue; }

    // countryOfOrigin může být objekt { iso31662: 'CZ' } nebo string
    let coo = null;
    if (raw?.countryOfOrigin) {
      coo = typeof raw.countryOfOrigin === 'object'
        ? (raw.countryOfOrigin.iso31662 || raw.countryOfOrigin.code)
        : raw.countryOfOrigin;
    }

    dataList.push({
      supplier_id,
      material_id,
      valid_from: getDate(raw, 'validFrom'),
      valid_to: getDate(raw, 'validTo'),
      is_primary: getBool(raw, 'isPrimary'),
      is_valid: getBool(raw, 'valid') || raw?.valid !== false, // default true
      country_of_origin: trimStr(coo, 2),
      note: getStr(raw, 'note'),
      factorify_id: trimStr(factorifyId, 100),
    });
  }

  if (missingSupplier || missingMaterial) {
    console.log(`  ⚠ Skip: supplier nenalezen ${missingSupplier}, material nenalezen ${missingMaterial} — možná je třeba spustit nejprve --only=suppliers,materials`);
  }

  return await batchUpsertByFactorifyId(prisma, 'supplierPriceList', dataList, {
    ...opts,
    stats,
    idCacheTable: 'supplier_price_lists',
  });
}

/**
 * Importuje řádky ceníku (BuyingPriceListItem → SupplierPriceListItem).
 * @param {object} opts.idCache  - musí mít předehřáté supplier_price_lists
 */
async function upsertPriceListItems(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('price_list_items');
  if (!opts.idCache) throw new Error('upsertPriceListItems vyžaduje opts.idCache');

  const dataList = [];
  let missingPriceList = 0;
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    const priceListFid = refId(raw?.buyingPriceList);
    const price_list_id = priceListFid ? opts.idCache.get('supplier_price_lists', priceListFid) : null;
    if (!price_list_id) { missingPriceList++; stats.noteSkip(`${factorifyId}: price list ${priceListFid} nenalezen`); continue; }

    const price = getNum(raw, 'price');
    if (price == null) { stats.noteSkip(`${factorifyId}: missing price`); continue; }

    dataList.push({
      price_list_id,
      quantity_min: getNum(raw, 'quantity'),
      price,
      currency: trimStr(getStr(raw, 'priceCurrency') || 'CZK', 3),
      additional_cost: getNum(raw, 'additionalCost'),
      additional_cost_currency: trimStr(getStr(raw, 'additionalCostCurrency'), 3),
      min_order_quantity: getNum(raw, 'minimumOrderQuantity'),
      delivery_time_days: getNum(raw, 'deliveryTimeDays'),
      supplier_part_no: trimStr(getStr(raw, 'orderNo'), 100),
      factorify_id: trimStr(factorifyId, 100),
    });
  }

  if (missingPriceList) {
    console.log(`  ⚠ Skip: ${missingPriceList} items bez nalezeného price list — spusť nejprve --only=price_lists`);
  }

  return await batchUpsertByFactorifyId(prisma, 'supplierPriceListItem', dataList, {
    ...opts,
    stats,
    idCacheTable: 'supplier_price_list_items',
  });
}

module.exports = { upsertPriceLists, upsertPriceListItems };
