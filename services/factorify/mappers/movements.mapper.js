// =============================================================================
// HolyOS — Mapper: Factorify StockMove → HolyOS InventoryMovement (STREAMING)
// =============================================================================
// StockMove je MEGA entita (>100MB raw JSON, statisíce až miliony záznamů).
// Plain query() by způsobila out-of-memory. Používáme factorify.queryStream(),
// který volá callback per-record bez akumulace v paměti.
//
// Strategie:
//   - Buffer 500 records v paměti
//   - Při naplnění → batchUpsertByFactorifyId → flush
//   - Tím držíme RAM stabilní + DB roundtripy minimalizujeme
//
// Vazby:
//   - goods → Material (idCache.materials)
//   - stock → Warehouse (idCache.warehouses)
//   - stockDocument → WarehouseDocument (idCache.warehouse_documents)
//   - position → WarehouseLocation (skipujeme, Factorify nemá detail lokace)
//
// Movement TYPE: musí se odvodit od parent StockDocument.type.
// Předáme docTypeMap (Map<factorify_doc_id, holyos_type>) z movements importu.
// =============================================================================

const {
  getStr, getNum, getDate, refId, trimStr, ImportStats,
  batchUpsertByFactorifyId,
} = require('./_helpers');

const factorify = require('../client.service');

const BATCH_SIZE = 500;

/**
 * Mapuje HolyOS WarehouseDocument.type → InventoryMovement.type
 *   receipt_doc  → receipt
 *   issue_doc    → issue
 *   transfer_doc → transfer
 *   inventory_doc → inventory_adjust
 */
function docTypeToMoveType(docType) {
  if (!docType) return 'adjustment';
  if (docType === 'receipt_doc') return 'receipt';
  if (docType === 'issue_doc') return 'issue';
  if (docType === 'transfer_doc') return 'transfer';
  if (docType === 'inventory_doc') return 'inventory_adjust';
  if (docType === 'pick_list') return 'pick';
  return 'adjustment';
}

/**
 * Streamuje StockMove z Factorify a v dávkách upsertuje do HolyOS.
 * @param {PrismaClient} prisma
 * @param {object} opts
 *   - idCache         (povinné) — předehřáté materials, warehouses, warehouse_documents
 *   - docTypeMap      Map<factorify_doc_id, holyos_doc_type> — pro mapping movement type
 *   - dryRun          true → jen počítej, nepiš
 *   - body            tělo dotazu (např. {limit:N} pro debug)
 *   - onProgress      callback (count, batchCount)
 * @returns {Promise<{stats}>}
 */
async function streamAndUpsertMovements(prisma, opts = {}) {
  const stats = new ImportStats('movements');
  if (!opts.idCache) throw new Error('streamAndUpsertMovements vyžaduje opts.idCache');
  const docTypeMap = opts.docTypeMap || new Map();

  let buffer = [];
  let totalCount = 0;
  let batchCount = 0;
  let skipMissingMaterial = 0;
  let skipMissingWarehouse = 0;
  let skipNoDocument = 0;

  async function flushBuffer() {
    if (buffer.length === 0) return;
    const toFlush = buffer;
    buffer = [];
    batchCount++;

    if (opts.dryRun) {
      for (const _ of toFlush) stats.noteCreate();
      return;
    }
    try {
      // Použijeme batch helper — najde existující po factorify_id, rozhodne create/update
      await batchUpsertByFactorifyId(prisma, 'inventoryMovement', toFlush, {
        stats,
        // idCache movement je velký, neudržujeme ho
      });
    } catch (e) {
      stats.noteFail(e, { phase: 'batch flush', batchSize: toFlush.length });
    }
  }

  function recordToData(raw) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) return null;

    const materialFid = refId(raw?.goods);
    const material_id = materialFid ? opts.idCache.get('materials', materialFid) : null;
    if (!material_id) { skipMissingMaterial++; return null; }

    const warehouseFid = refId(raw?.stock);
    const warehouse_id = warehouseFid ? opts.idCache.get('warehouses', warehouseFid) : null;
    if (!warehouse_id) { skipMissingWarehouse++; return null; }

    const docFid = refId(raw?.stockDocument);
    const document_id = docFid ? opts.idCache.get('warehouse_documents', docFid) : null;
    const docType = docFid ? docTypeMap.get(docFid) : null;
    // Pohyb bez parent dokumentu — ok, jen nemáme type → 'adjustment'
    if (!document_id && !docType) skipNoDocument++;

    const moveType = docTypeToMoveType(docType);
    const quantity = getNum(raw, 'quantity') || 0;
    const unit_price = getNum(raw, 'pricePerUnitDomesticCurrency');

    return {
      material_id,
      warehouse_id,
      type: moveType,
      quantity,
      unit_price,
      document_id, // může být null pokud pohyb nemá v HolyOS odpovídající doklad
      reference_type: docFid ? 'document' : null,
      reference_id: document_id,
      note: getStr(raw, 'note'),
      factorify_id: trimStr(factorifyId, 100),
      factorify_document_id: docFid ? trimStr(docFid, 100) : null,
      factorify_state: trimStr(getStr(raw, 'state'), 20),
      factorify_moved_at: getDate(raw, 'movedAt'),
      created_at: getDate(raw, 'createdAt') || getDate(raw, 'movedAt') || new Date(),
    };
  }

  console.log('  Streamuji StockMove — buffered batch á 500 záznamů...');
  const startedAt = Date.now();
  let downloadedMB = 0;
  let lastChunkAt = Date.now();

  const result = await factorify.queryStream('StockMove', opts.body || {}, async (raw) => {
    totalCount++;
    const data = recordToData(raw);
    if (data) {
      buffer.push(data);
      if (buffer.length >= BATCH_SIZE) {
        await flushBuffer();
      }
    } else {
      stats.noteSkip();
    }
    if (opts.onProgress && totalCount % 1000 === 0) {
      opts.onProgress(totalCount, batchCount, downloadedMB);
    }
  }, {
    timeoutMs: 60 * 60 * 1000, // 1 hodina
    onChunk: ({ totalSize }) => {
      downloadedMB = totalSize / 1024 / 1024;
      // Heartbeat každé 2 s i kdyby zatím žádné records nebyly parsed
      if (Date.now() - lastChunkAt > 2000) {
        if (opts.onProgress) opts.onProgress(totalCount, batchCount, downloadedMB);
        lastChunkAt = Date.now();
      }
    },
  });

  // Final flush
  await flushBuffer();
  if (opts.onProgress) opts.onProgress(totalCount, batchCount);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  ⓘ Stream stáhl ${result.count} StockMove (${(result.sizeBytes / 1024 / 1024).toFixed(0)}MB) za ${elapsedSec}s`);
  console.log(`  ⓘ Skip: missing_material=${skipMissingMaterial}, missing_warehouse=${skipMissingWarehouse}, no_document=${skipNoDocument}`);

  return { stats };
}

/**
 * BATCH varianta - mappuje raw page (např. 5000 records ze paginace) na
 * HolyOS data a upsertuje. Používá se s flat {limit, offset} paginací místo
 * streamingu. Stejná logika jako streamAndUpsertMovements, ale na hotovém poli.
 *
 * @param {PrismaClient} prisma
 * @param {Array} rawList                 - pole StockMove records z Factorify
 * @param {object} opts
 *   - idCache         (povinné)
 *   - docTypeMap      Map<factorify_doc_id, holyos_doc_type>
 *   - stats           cumulative stats napříč stránkami
 *   - dryRun
 */
async function upsertMovementsBatch(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('movements');
  if (!opts.idCache) throw new Error('upsertMovementsBatch vyžaduje opts.idCache');
  const docTypeMap = opts.docTypeMap || new Map();

  let skipMissingMaterial = 0, skipMissingWarehouse = 0;
  const dataList = [];
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }

    const materialFid = refId(raw?.goods);
    const material_id = materialFid ? opts.idCache.get('materials', materialFid) : null;
    if (!material_id) { skipMissingMaterial++; stats.noteSkip(`${factorifyId}: material`); continue; }

    const warehouseFid = refId(raw?.stock);
    const warehouse_id = warehouseFid ? opts.idCache.get('warehouses', warehouseFid) : null;
    if (!warehouse_id) { skipMissingWarehouse++; stats.noteSkip(`${factorifyId}: warehouse`); continue; }

    const docFid = refId(raw?.stockDocument);
    const document_id = docFid ? opts.idCache.get('warehouse_documents', docFid) : null;
    const docType = docFid ? docTypeMap.get(docFid) : null;
    const moveType = docTypeToMoveType(docType);

    dataList.push({
      material_id,
      warehouse_id,
      type: moveType,
      quantity: getNum(raw, 'quantity') || 0,
      unit_price: getNum(raw, 'pricePerUnitDomesticCurrency'),
      document_id,
      reference_type: docFid ? 'document' : null,
      reference_id: document_id,
      note: getStr(raw, 'note'),
      factorify_id: trimStr(factorifyId, 100),
      factorify_document_id: docFid ? trimStr(docFid, 100) : null,
      factorify_state: trimStr(getStr(raw, 'state'), 20),
      factorify_moved_at: getDate(raw, 'movedAt'),
      created_at: getDate(raw, 'createdAt') || getDate(raw, 'movedAt') || new Date(),
    });
  }

  if (skipMissingMaterial || skipMissingWarehouse) {
    // jen tichá poznámka, hromadný statistický log nedělá per stránku
  }

  return await batchUpsertByFactorifyId(prisma, 'inventoryMovement', dataList, {
    ...opts,
    stats,
    // movements bývají miliony — nedrtíme idCache
  });
}

module.exports = { streamAndUpsertMovements, upsertMovementsBatch, docTypeToMoveType };
