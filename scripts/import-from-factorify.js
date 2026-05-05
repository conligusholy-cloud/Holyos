// =============================================================================
// HolyOS — Master import skript: Factorify → HolyOS (sklad + nákup)
// =============================================================================
// Spuštění:
//   node scripts/import-from-factorify.js --only=suppliers,warehouses
//   node scripts/import-from-factorify.js --dry-run --only=projects
//   node scripts/import-from-factorify.js --only=all
//
// Flagy:
//   --dry-run           jen načte z Factorify, nezapisuje do HolyOS
//   --only=...          čárkou oddělené sekce (suppliers, warehouses, projects,
//                       cost_centers, materials, price_lists, orders,
//                       documents, movements, inventories, all)
//   --since=YYYY-MM-DD  filtr na movedAt/createdAt — aplikujeme client-side
//                       v mapperu (Factorify Stage API server-side filter
//                       nepodporuje, viz probe-factorify-pagination.js)
//   --limit=N           [debug] omezit počet záznamů per sekce (přidá {limit:N}
//                       do query body; mega entity to obejdou streamem)
//
// Idempotence: vše přes upsert podle factorify_id, lze pustit opakovaně.
// Master import respektuje pořadí závislostí (suppliers → warehouses → ... → movements).
// =============================================================================

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const factorify = require('../services/factorify/client.service');
const mappers = require('../services/factorify/mappers');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

// ─── Parse CLI args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FLAGS = {
  dryRun: args.includes('--dry-run'),
  only: null,    // array of sections, null = default
  since: null,   // Date | null
  limit: null,   // number | null
};

for (const a of args) {
  if (a.startsWith('--only=')) {
    FLAGS.only = a.substring('--only='.length).split(',').map(s => s.trim()).filter(Boolean);
  } else if (a.startsWith('--since=')) {
    const d = new Date(a.substring('--since='.length));
    if (Number.isNaN(d.getTime())) { console.error(`Špatné --since= datum: ${a}`); process.exit(1); }
    FLAGS.since = d;
  } else if (a.startsWith('--limit=')) {
    FLAGS.limit = parseInt(a.substring('--limit='.length), 10);
    if (Number.isNaN(FLAGS.limit) || FLAGS.limit <= 0) { console.error(`Špatné --limit=`); process.exit(1); }
  }
}

const ALL_SECTIONS = [
  'suppliers',
  'warehouses',
  'projects',
  'cost_centers',
  'materials',
  'price_lists',
  'orders',
  'documents',
  'movements',
  'inventories',
];

if (!FLAGS.only || FLAGS.only.includes('all')) {
  FLAGS.only = ALL_SECTIONS.slice();
}

const SECTIONS = FLAGS.only.filter(s => ALL_SECTIONS.includes(s));
if (SECTIONS.length === 0) {
  console.error(`Žádná validní sekce. Dostupné: ${ALL_SECTIONS.join(', ')}`);
  process.exit(1);
}

// ─── Diagnostika konfigurace ──────────────────────────────────────────────

const cfg = factorify.getConfig();
if (!cfg.tokenSet) {
  console.error('❌ FACTORIFY_TOKEN není nastaven v .env');
  process.exit(1);
}

console.log('═══════════════════════════════════════════');
console.log('  HolyOS — Factorify import');
console.log('═══════════════════════════════════════════');
console.log(`  Factorify:    ${cfg.baseUrl}  (AU=${cfg.accountingUnit}, token=${cfg.tokenPreview})`);
console.log(`  Mode:         ${FLAGS.dryRun ? 'DRY-RUN (nepíšeme do HolyOS)' : 'LIVE'}`);
console.log(`  Sekce:        ${SECTIONS.join(', ')}`);
if (FLAGS.since) console.log(`  Since:        ${FLAGS.since.toISOString().substring(0, 10)} (filter client-side)`);
if (FLAGS.limit) console.log(`  Limit:        ${FLAGS.limit} per sekce (debug)`);
console.log('───────────────────────────────────────────\n');

// ─── Pomocné funkce ──────────────────────────────────────────────────────

function progressBar(label) {
  return (current, total) => {
    const pct = total ? Math.round((current / total) * 100) : 0;
    process.stdout.write(`\r  [${label}] ${current}/${total} (${pct}%)   `);
    if (current >= total) process.stdout.write('\n');
  };
}

function buildQueryBody() {
  const body = {};
  if (FLAGS.limit) body.limit = FLAGS.limit;
  return body;
}

const idCache = new mappers.helpers.IdCache();

// ─── Sekce ────────────────────────────────────────────────────────────────

async function runSection(name) {
  console.log(`\n📦 ${name.toUpperCase()}`);
  const startedAt = Date.now();

  switch (name) {
    case 'suppliers': {
      const rows = await factorify.query('Company', buildQueryBody());
      console.log(`  Stahuji Company: ${rows.length} záznamů`);
      // Filtruj jen dodavatele a smíšené (BOTH) — podle Tomášova rozhodnutí
      // ostatní (čistí customer) můžeme klidně zaimportovat taky, vyhodit je
      // později snadno přes flag.
      const r = await mappers.suppliers.upsertSuppliers(prisma, rows, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('suppliers'),
      });
      console.log(`  ${(r.stats || r).summary()}`);
      break;
    }

    case 'warehouses': {
      const rows = await factorify.query('Stock', buildQueryBody());
      console.log(`  Stahuji Stock: ${rows.length} záznamů`);
      const r = await mappers.warehouses.upsertWarehouses(prisma, rows, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('warehouses'),
      });
      console.log(`  ${(r.stats || r).summary()}`);
      break;
    }

    case 'projects': {
      const rows = await factorify.query('Project', buildQueryBody());
      console.log(`  Stahuji Project: ${rows.length} záznamů`);
      const r = await mappers.projects.upsertProjects(prisma, rows, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('projects'),
      });
      console.log(`  ${(r.stats || r).summary()}`);
      break;
    }

    case 'cost_centers': {
      const rows = await factorify.query('CostCenter', buildQueryBody());
      console.log(`  Stahuji CostCenter: ${rows.length} záznamů`);
      const r = await mappers.costCenters.upsertCostCenters(prisma, rows, {
        dryRun: FLAGS.dryRun,
        idCache,
      });
      console.log(`  ${(r.stats || r).summary()}`);
      break;
    }

    // Placeholdery pro další iterace — naimplementujeme až budou mappery hotové.
    case 'materials':
      console.log(`  ⚠ TODO — použij scripts/dump-factorify.js (existující skript pro Materials/Goods)`);
      break;
    case 'price_lists': {
      // Lists první, pak items (items potřebují idCache.supplier_price_lists)
      const lists = await factorify.query('BuyingPriceList', buildQueryBody());
      console.log(`  Stahuji BuyingPriceList: ${lists.length} záznamů`);
      const r1 = await mappers.priceLists.upsertPriceLists(prisma, lists, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('price_lists'),
      });
      console.log(`  ${(r1.stats || r1).summary()}`);

      const items = await factorify.query('BuyingPriceListItem', buildQueryBody());
      console.log(`  Stahuji BuyingPriceListItem: ${items.length} záznamů`);
      const r2 = await mappers.priceLists.upsertPriceListItems(prisma, items, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('price_list_items'),
      });
      console.log(`  ${(r2.stats || r2).summary()}`);
      break;
    }
    case 'orders': {
      // Hlavičky první, pak items (items potřebují idCache.orders)
      const orders = await factorify.query('PurchaseOrder', buildQueryBody());
      console.log(`  Stahuji PurchaseOrder: ${orders.length} záznamů`);
      const r1 = await mappers.orders.upsertOrders(prisma, orders, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('orders'),
      });
      console.log(`  ${(r1.stats || r1).summary()}`);

      const items = await factorify.query('PurchaseOrderItem', buildQueryBody());
      console.log(`  Stahuji PurchaseOrderItem: ${items.length} záznamů`);
      const r2 = await mappers.orders.upsertOrderItems(prisma, items, {
        dryRun: FLAGS.dryRun,
        idCache,
        onProgress: progressBar('order_items'),
      });
      console.log(`  ${(r2.stats || r2).summary()}`);
      break;
    }
    case 'documents': {
      // POZN.: streaming JSON parser má bug pro StockDocument (zasekává se v parsingu).
      // Plain query() funguje (testováno na PurchaseOrderItem 238MB). Faktorify vrátí celé
      // pole najednou — Node si poradí, kterážto cca 200-500MB je na 8GB+ stroji v pohodě.
      console.log(`  Stahuji StockDocument (plain query)…`);
      const startedAt = Date.now();
      const docs = await factorify.query('StockDocument', buildQueryBody(), { timeoutMs: 30 * 60_000 });
      console.log(`  ⓘ Staženo ${docs.length} StockDocument za ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
      const stats = new mappers.helpers.ImportStats('documents');

      // Upsert v dávkách po 500 (kvůli batch helper); voláme upsertDocuments s celým polem,
      // batchUpsertByFactorifyId si data sám rozdělí (interně txSize=200).
      const r = await mappers.documents.upsertDocuments(prisma, docs, {
        dryRun: FLAGS.dryRun, idCache, stats,
        onProgress: (count, total, phase) => {
          process.stdout.write(`\r  [documents] ${count}/${total} (${phase})    `);
        },
      });
      process.stdout.write('\n');
      console.log(`  ${(r.stats || r).summary()}`);
      break;
    }
    case 'inventories': {
      // POZN.: StockPhysicalInventory hlavičky migrujeme.
      // StockPhysicalInventoryPosition je jen lokační reference, NE ekvivalent
      // InventoryItem (skutečné count data jsou v Record mega entitě).
      // Items zatím skipujeme — Tomáš inventury reálně ve Factorify minimálně používal.
      const inv = await factorify.query('StockPhysicalInventory', buildQueryBody());
      console.log(`  Stahuji StockPhysicalInventory: ${inv.length} záznamů`);
      const r1 = await mappers.inventories.upsertInventories(prisma, inv, {
        dryRun: FLAGS.dryRun, idCache,
      });
      console.log(`  ${(r1.stats || r1).summary()}`);
      break;
    }
    case 'movements': {
      // PAGINATED IMPORT — Factorify podporuje {limit, offset} flat (ověřeno v
      // scripts/probe-factorify-offset.js). Streaming nepoužíváme; po stránkách
      // 5000 záznamů držíme RAM stabilní a máme ovladatelný progress.
      console.log(`  Předehřívám docTypeMap (factorify_id → HolyOS doc type)...`);
      const docs = await prisma.warehouseDocument.findMany({
        where: { factorify_id: { not: null } },
        select: { factorify_id: true, type: true },
      });
      const docTypeMap = new Map(docs.map(d => [d.factorify_id, d.type]));
      console.log(`  Načteno ${docTypeMap.size} dokumentů z HolyOS`);

      const PAGE_SIZE = FLAGS.limit ? Math.min(FLAGS.limit, 5000) : 5000;
      const stats = new mappers.helpers.ImportStats('movements');
      let offset = 0, totalDownloaded = 0, totalProcessed = 0;
      const startedAt = Date.now();

      while (true) {
        const pageStartedAt = Date.now();
        const page = await factorify.query('StockMove', {
          limit: PAGE_SIZE,
          offset,
        }, { timeoutMs: 5 * 60_000 });
        if (page.length === 0) break;
        totalDownloaded += page.length;

        // Mapper přijme raw page a rozhoduje co s tím
        await mappers.movements.upsertMovementsBatch(prisma, page, {
          dryRun: FLAGS.dryRun,
          idCache,
          docTypeMap,
          stats,
        });
        totalProcessed += page.length;

        const pageMs = Date.now() - pageStartedAt;
        process.stdout.write(`\r  [movements] offset=${offset} · ${totalDownloaded} downloaded · ${stats.created + stats.updated} uloženo · ${pageMs}ms/stránka          `);

        if (page.length < PAGE_SIZE) break; // poslední stránka
        offset += PAGE_SIZE;

        // V debug režimu (--limit) jen jedna stránka
        if (FLAGS.limit) break;
      }
      process.stdout.write('\n');
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  ⓘ Staženo ${totalDownloaded} StockMove z Factorify za ${elapsed}s`);
      console.log(`  ${stats.summary()}`);
      break;
    }

    default:
      console.log(`  ❓ neznámá sekce: ${name}`);
  }

  console.log(`  ✓ Hotovo za ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Předem nahrát existující factorify_id mapping do cache (zrychlí lookups
  // při běhu mapperů, které potřebují FK references).
  console.log('🔄 Předehřívám idCache z existujících factorify_id...');
  const preloads = await Promise.all([
    idCache.preload(prisma, 'companies', 'company'),
    idCache.preload(prisma, 'warehouses', 'warehouse'),
    idCache.preload(prisma, 'materials', 'material'),
    idCache.preload(prisma, 'projects', 'project'),
    idCache.preload(prisma, 'cost_centers', 'costCenter'),
    idCache.preload(prisma, 'orders', 'order'),
    idCache.preload(prisma, 'supplier_price_lists', 'supplierPriceList'),
    idCache.preload(prisma, 'warehouse_documents', 'warehouseDocument'),
    idCache.preload(prisma, 'inventories', 'inventory'),
  ]);
  console.log(`  companies=${preloads[0]}, warehouses=${preloads[1]}, materials=${preloads[2]}, projects=${preloads[3]}, cost_centers=${preloads[4]}, orders=${preloads[5]}, price_lists=${preloads[6]}, documents=${preloads[7]}, inventories=${preloads[8]}`);

  for (const sec of SECTIONS) {
    try {
      await runSection(sec);
    } catch (e) {
      console.error(`\n❌ ${sec}: ${e.message}`);
      console.error(e.stack);
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  HOTOVO');
  console.log('═══════════════════════════════════════════');
}

main()
  .catch(e => { console.error('Fatální chyba:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
