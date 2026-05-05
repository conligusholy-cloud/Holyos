// =============================================================================
// HolyOS — Mapper: Factorify StockDocument → HolyOS WarehouseDocument
// =============================================================================
// StockDocument (mega) — hlavička skladového pohybu (příjemka/výdejka/přesunka).
// Vazby: stock, counterpartyCompany, costCenter, project, batch, deliveryBill,
//        stockPhysicalInventory, ...
//
// HolyOS WarehouseDocument.type:
//   - receipt_doc, issue_doc, transfer_doc, pick_list, inventory_doc
//
// Faktorify type (pravděpodobné hodnoty enumu):
//   - RECEIVE / RECEIVE_PURCHASE → receipt_doc
//   - ISSUE / DISPATCH            → issue_doc
//   - TRANSFER / MOVE             → transfer_doc
//   - PHYSICAL_INVENTORY          → inventory_doc
//   - SCRAP / NONCONFORMITY       → issue_doc (zjednodušeně)
//
// Ukládáme původní hodnotu do factorify_type pro audit.
// =============================================================================

const {
  getStr, getDate, refId, trimStr, ImportStats,
  batchUpsertByFactorifyId,
} = require('./_helpers');

function mapDocType(rawType) {
  if (!rawType) return 'receipt_doc';
  const t = String(rawType).toUpperCase();
  if (t.includes('RECEIV') || t.includes('PURCHASE_RECEIVE') || t.includes('PRIJEM')) return 'receipt_doc';
  if (t.includes('ISSUE') || t.includes('DISPATCH') || t.includes('VYDEJ')) return 'issue_doc';
  if (t.includes('TRANSFER') || t.includes('MOVE')) return 'transfer_doc';
  if (t.includes('INVENTORY') || t.includes('PHYSICAL') || t.includes('STOCKTAKE')) return 'inventory_doc';
  if (t.includes('SCRAP') || t.includes('NONCONFORM')) return 'issue_doc';
  return 'receipt_doc';
}

async function upsertDocuments(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('documents');
  if (!opts.idCache) throw new Error('upsertDocuments vyžaduje opts.idCache');

  const dataList = [];
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    // counterpartyCompany — dodavatel u příjemky / odběratel u výdejky
    const partnerFid = refId(raw?.counterpartyCompany);
    const partner_id = partnerFid ? opts.idCache.get('companies', partnerFid) : null;

    const projectFid = refId(raw?.project);
    const costCenterFid = refId(raw?.costCenter);
    const project_id = projectFid ? opts.idCache.get('projects', projectFid) : null;
    const cost_center_id = costCenterFid ? opts.idCache.get('cost_centers', costCenterFid) : null;

    const factorify_type = trimStr(getStr(raw, 'type'), 50);
    const docType = mapDocType(factorify_type || getStr(raw?.type, 'code'));

    // HolyOS vyžaduje unique number → vyrobíme z factorify_id, prefix ať se to nepere s manuálně zadanými.
    const number = `FY-DOC-${factorifyId}`;

    dataList.push({
      type: docType,
      number,
      status: 'completed',
      partner_id,
      cost_center_id,
      project_id,
      reference: trimStr(getStr(raw, 'note'), 255),
      factorify_id: trimStr(factorifyId, 100),
      factorify_type,
      created_at: getDate(raw, 'createdAt') || new Date(),
      updated_at: getDate(raw, 'updatedAt') || new Date(),
    });
  }

  return await batchUpsertByFactorifyId(prisma, 'warehouseDocument', dataList, {
    ...opts,
    stats,
    idCacheTable: 'warehouse_documents',
  });
}

module.exports = { upsertDocuments, mapDocType };
