// =============================================================================
// HolyOS — Mapper: Factorify PurchaseOrder + Item → HolyOS Order + OrderItem
// =============================================================================
// PurchaseOrder (3494 hlaviček) — vazby na supplier (Company), targetStock,
// project, costCenter, paymentMethod. Má custom Best Series pole STAV/DUVOD/POPT/
// SCHASTAV/PLAT/" REASON" — uložíme do factorify_metadata (JSON).
// PurchaseOrderItem (14347 řádků) — vazba na stockOrder, material, batch,
// buyingPriceListItem, targetStock.
//
// Závislosti (pre-conditions):
//   - suppliers (Company)        → idCache.companies
//   - materials (Goods)          → idCache.materials
//   - projects                   → idCache.projects (volitelné)
//   - cost_centers               → idCache.cost_centers (volitelné)
//   - warehouses (Stock)         → idCache.warehouses (volitelné, pro target)
//   - price_lists                → idCache.supplier_price_lists (volitelné)
//
// Pořadí spouštění:
//   1) upsertOrders         → vytvoří Order, plní idCache.orders
//   2) upsertOrderItems     → vyžaduje hotové orders + materials
// =============================================================================

const {
  getStr, getNum, getDate, refId, trimStr, ImportStats,
  batchUpsertByFactorifyId,
} = require('./_helpers');

// Custom Best Series pole na PurchaseOrder, která uložíme do factorify_metadata
const BS_CUSTOM_FIELDS = ['STAV', 'DUVOD', 'POPT', ' REASON', 'SCHASTAV', 'PLAT'];

/**
 * Mapuje state Factorify PurchaseOrderItem → status HolyOS OrderItem.
 *   CANCELLED → 'cancelled'
 *   DELIVERED → 'completed'
 *   ostatní (NEW, PARTIAL, OPEN, ...) → 'pending'
 */
function mapItemStatus(state) {
  if (!state) return 'pending';
  const s = String(state).toUpperCase();
  if (s === 'CANCELLED' || s === 'CANCELED') return 'cancelled';
  if (s === 'DELIVERED' || s === 'COMPLETED' || s === 'CLOSED') return 'completed';
  if (s === 'PARTIAL' || s === 'PARTIALLY_DELIVERED') return 'partial';
  return 'pending';
}

/**
 * Mapuje status na úrovni PurchaseOrder. Faktorify nemá samotný status, jen
 * STAV (custom) a SCHASTAV (datum schválení). Detekujeme:
 *   - pokud žádný item není pending → 'completed'
 *   - jinak → 'imported'
 *
 * Pro účely importu vrátíme jen 'imported' — finální status se dopočítá
 * z items v post-passu (případně, pokud bude potřeba).
 */
function mapOrderStatus(raw, items = []) {
  // Faktorify má STAV jako string "OK", null, nebo nic.
  const stav = getStr(raw, 'STAV');
  if (stav === 'OK') return 'completed';
  return 'imported';
}

// ─── ORDERS ───────────────────────────────────────────────────────────────

async function upsertOrders(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('orders');
  if (!opts.idCache) throw new Error('upsertOrders vyžaduje opts.idCache');

  const dataList = [];
  let missingSupplier = 0;

  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    const supplierFid = refId(raw?.supplier);
    const company_id = supplierFid ? opts.idCache.get('companies', supplierFid) : null;
    if (!company_id) {
      missingSupplier++;
      stats.noteSkip(`${factorifyId}: supplier ${supplierFid} nenalezen v idCache`);
      continue;
    }

    // Custom Best Series pole → JSON metadata
    const factorify_metadata = {};
    let hasMetadata = false;
    for (const k of BS_CUSTOM_FIELDS) {
      const v = raw?.[k];
      if (v != null) { factorify_metadata[k] = v; hasMetadata = true; }
    }

    // Vazby (volitelné — pokud chybí, prostě null)
    const projectFid = refId(raw?.project);
    const costCenterFid = refId(raw?.costCenter);
    const project_id = projectFid ? opts.idCache.get('projects', projectFid) : null;
    const cost_center_id = costCenterFid ? opts.idCache.get('cost_centers', costCenterFid) : null;

    // order_number — Faktorify používá referenceName ("1555") nebo přímo id
    const refName = trimStr(getStr(raw, 'referenceName') || factorifyId, 50);
    // Prefix kvůli unique pravidlu HolyOS Order.order_number — jiné objednávky
    // mohou mít stejné číslo, ale Factorify import má vlastní namespace.
    const order_number = `FY-${refName}`;

    dataList.push({
      order_number,
      type: 'purchase',
      company_id,
      status: mapOrderStatus(raw),
      currency: trimStr(getStr(raw, 'currency') || 'CZK', 3),
      note: getStr(raw, 'note'),
      source: 'import',
      approval_status: 'auto_approved',
      project_id,
      cost_center_id,
      factorify_id: trimStr(factorifyId, 100),
      factorify_metadata: hasMetadata ? factorify_metadata : null,
      created_at: getDate(raw, 'createdAt') || new Date(),
      updated_at: getDate(raw, 'updatedAt') || new Date(),
    });
  }

  if (missingSupplier) {
    console.log(`  ⚠ ${missingSupplier} objednávek skipnuto (supplier není v idCache — spusť nejprve --only=suppliers)`);
  }

  return await batchUpsertByFactorifyId(prisma, 'order', dataList, {
    ...opts,
    stats,
    idCacheTable: 'orders',
  });
}

// ─── ORDER ITEMS ──────────────────────────────────────────────────────────

async function upsertOrderItems(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('order_items');
  if (!opts.idCache) throw new Error('upsertOrderItems vyžaduje opts.idCache');

  const dataList = [];
  let missingOrder = 0, missingMaterial = 0;

  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    // Vazba na parent Order — přes stockOrder.id
    const orderFid = refId(raw?.stockOrder);
    const order_id = orderFid ? opts.idCache.get('orders', orderFid) : null;
    if (!order_id) {
      missingOrder++;
      stats.noteSkip(`${factorifyId}: parent order ${orderFid} nenalezen`);
      continue;
    }

    // Vazba na Material — přes material.id
    const materialFid = refId(raw?.material);
    const material_id = materialFid ? opts.idCache.get('materials', materialFid) : null;
    if (!material_id) {
      missingMaterial++;
      stats.noteSkip(`${factorifyId}: material ${materialFid} nenalezen`);
      continue;
    }

    const quantity = getNum(raw, 'quantity') || 0;
    const unit_price = getNum(raw, 'price') || 0;
    const total_price = getNum(raw, 'totalPriceDomestic') || (quantity * unit_price);
    const delivered_quantity = getNum(raw, 'deliveredQuantity') || 0;

    // Vazba na buying price list item (volitelné)
    const priceListItemFid = refId(raw?.buyingPriceListItem);

    // Název — Factorify nemá explicit name na řádku, použijeme name z material objektu
    const name = trimStr(
      getStr(raw, 'name') || getStr(raw?.material, 'name', 'referenceName') || `FY-item-${factorifyId}`,
      255
    );

    dataList.push({
      order_id,
      material_id,
      name,
      quantity,
      unit: trimStr(getStr(raw?.material, 'unit') || 'ks', 20),
      unit_price,
      total_price,
      delivered_quantity,
      expected_delivery: getDate(raw, 'originalDeliveryDate'),
      status: mapItemStatus(getStr(raw, 'state')),
      note: getStr(raw, 'note'),
      factorify_id: trimStr(factorifyId, 100),
      factorify_price_list_item_id: priceListItemFid ? trimStr(priceListItemFid, 100) : null,
    });
  }

  if (missingOrder || missingMaterial) {
    console.log(`  ⚠ Skip: ${missingOrder} bez orders, ${missingMaterial} bez materials — pre-conditions`);
  }

  return await batchUpsertByFactorifyId(prisma, 'orderItem', dataList, {
    ...opts,
    stats,
    idCacheTable: 'order_items',
  });
}

module.exports = { upsertOrders, upsertOrderItems, mapItemStatus, mapOrderStatus };
