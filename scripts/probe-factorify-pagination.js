// =============================================================================
// HolyOS — Probe paginace + filtrace Factorify Stage API
// Cíl: zjistit, jaký body Factorify akceptuje pro:
//   1) Limit počtu záznamů v odpovědi  (kvůli mega entitám StockMove apod.)
//   2) Filtrace podle datumu             (kvůli --since=YYYY-MM-DD v inkrementálním importu)
// =============================================================================

require('dotenv').config();
const factorify = require('../services/factorify/client.service');

const TARGET_ENTITY = 'BuyingPriceListItem'; // 1329 záznamů, dostatečně velké, ne mega
const SMALL_ENTITY = 'Stock';                // 51 záznamů, kontrolní

const VARIANTS = [
  { label: 'no-body (kontrola)', body: {} },
  { label: 'limit=5', body: { limit: 5 } },
  { label: 'first=5 (GraphQL)', body: { first: 5 } },
  { label: 'pageSize=5', body: { pageSize: 5 } },
  { label: 'size=5', body: { size: 5 } },
  { label: 'take=5', body: { take: 5 } },
  { label: 'count=5', body: { count: 5 } },
  { label: 'paging.count=5', body: { paging: { count: 5 } } },
  { label: 'paging.size=5', body: { paging: { size: 5 } } },
  { label: 'paging.limit=5', body: { paging: { limit: 5 } } },
  { label: 'paging.take=5', body: { paging: { take: 5 } } },
  { label: 'paging.first=5', body: { paging: { first: 5 } } },
  { label: 'pagination.size=5', body: { pagination: { size: 5 } } },
  { label: 'page.size=5', body: { page: { size: 5 } } },
];

// Date filter varianty
const DATE_VARIANTS = [
  { label: 'createdAt>2025-01-01', body: { createdAt: { gt: '2025-01-01' } } },
  { label: 'createdAt$gt', body: { createdAt: { $gt: '2025-01-01' } } },
  { label: 'filter.createdAt', body: { filter: { createdAt: { gt: '2025-01-01' } } } },
  { label: 'where.createdAt', body: { where: { createdAt: { gt: '2025-01-01' } } } },
  { label: 'filters.createdAt', body: { filters: { createdAt: { gt: '2025-01-01' } } } },
  { label: 'createdAtFrom', body: { createdAtFrom: '2025-01-01' } },
];

async function tryVariants(entity, variants, label) {
  console.log(`\n─── ${label} (proti ${entity}) ───`);
  let baselineCount = null;
  for (const v of variants) {
    process.stdout.write(`  ${v.label.padEnd(36)} `);
    try {
      const rows = await factorify.query(entity, v.body, { timeoutMs: 60_000, retries: 0 });
      const count = rows.length;
      const marker = baselineCount === null ? '🟦' :
                     count < baselineCount ? '✅ FUNGUJE' :
                     count === baselineCount ? '◯ ignored' : '? větší';
      console.log(`${count} záznamů  ${marker}`);
      if (baselineCount === null) baselineCount = count;
    } catch (e) {
      console.log(`❌ ${e.message.substring(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  const cfg = factorify.getConfig();
  console.log(`🔗 ${cfg.baseUrl}, AU=${cfg.accountingUnit}, token=${cfg.tokenPreview}`);

  // 1) Paginace na BuyingPriceListItem (1329 záznamů → uvidíme zda body limit zafunguje)
  await tryVariants(TARGET_ENTITY, VARIANTS, 'PAGINACE');

  // 2) Date filter na PurchaseOrder (3494 záznamů → uvidíme zda createdAt filter zafunguje)
  await tryVariants('PurchaseOrder', DATE_VARIANTS, 'DATE FILTER');

  console.log(`\nHotovo.`);
}

main().catch(e => { console.error(e); process.exit(1); });
