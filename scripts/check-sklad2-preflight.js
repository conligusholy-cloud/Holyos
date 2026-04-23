// HolyOS — Pre-flight kontrola před migrací Sklad 2.0 (PWA + tisk)
// Ověří, že migrace `sklad-2-pwa-tisk` neselže na duplikátních barcode.
//
// Spuštění: node scripts/check-sklad2-preflight.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(70));
  console.log('HolyOS — Sklad 2.0 | Pre-flight kontrola');
  console.log('='.repeat(70));

  // --- 1. Duplikátní barcode v materiálech ---
  const dupMaterials = await prisma.$queryRaw`
    SELECT barcode, COUNT(*)::int AS pocet
    FROM materials
    WHERE barcode IS NOT NULL AND barcode <> ''
    GROUP BY barcode
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `;
  console.log(`\n[1/4] Duplikátní barcode v materials: ${dupMaterials.length === 0 ? 'OK (žádný)' : dupMaterials.length + ' duplikátů'}`);
  if (dupMaterials.length > 0) {
    console.table(dupMaterials);
  }

  // --- 2. Duplikátní barcode v lokacích ---
  const dupLocations = await prisma.$queryRaw`
    SELECT barcode, COUNT(*)::int AS pocet
    FROM warehouse_locations
    WHERE barcode IS NOT NULL AND barcode <> ''
    GROUP BY barcode
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `;
  console.log(`\n[2/4] Duplikátní barcode v warehouse_locations: ${dupLocations.length === 0 ? 'OK (žádný)' : dupLocations.length + ' duplikátů'}`);
  if (dupLocations.length > 0) {
    console.table(dupLocations);
  }

  // --- 3. Prázdné stringy v barcode (měly by být NULL) ---
  const emptyMat = await prisma.$queryRaw`SELECT COUNT(*)::int AS pocet FROM materials WHERE barcode = ''`;
  const emptyLoc = await prisma.$queryRaw`SELECT COUNT(*)::int AS pocet FROM warehouse_locations WHERE barcode = ''`;
  console.log(`\n[3/4] Prázdný string '' v barcode:`);
  console.log(`        materials:           ${emptyMat[0].pocet}`);
  console.log(`        warehouse_locations: ${emptyLoc[0].pocet}`);

  // --- 4. Inventarizace (pro kontext) ---
  const counts = await prisma.$queryRaw`
    SELECT 'materials' AS tabulka, COUNT(*)::int AS zaznamu FROM materials
    UNION ALL SELECT 'warehouse_locations',  COUNT(*)::int FROM warehouse_locations
    UNION ALL SELECT 'warehouses',           COUNT(*)::int FROM warehouses
    UNION ALL SELECT 'inventory_movements',  COUNT(*)::int FROM inventory_movements
    UNION ALL SELECT 'inventories',          COUNT(*)::int FROM inventories
    ORDER BY tabulka
  `;
  console.log(`\n[4/4] Počty záznamů v existujících tabulkách:`);
  console.table(counts);

  // --- Verdikt ---
  console.log('\n' + '='.repeat(70));
  const blocked = dupMaterials.length > 0 || dupLocations.length > 0;
  if (blocked) {
    console.log('VERDIKT: NUTNÝ CLEANUP — migrace by selhala na UNIQUE constraintu.');
    console.log('         Pošli tento výstup Coworku, dá ti přesný cleanup SQL.');
  } else if (emptyMat[0].pocet > 0 || emptyLoc[0].pocet > 0) {
    console.log('VERDIKT: MENŠÍ CLEANUP (prázdné stringy → NULL), migrace by ale prošla.');
  } else {
    console.log('VERDIKT: OK — můžeme rovnou do migrace.');
  }
  console.log('='.repeat(70));
}

main()
  .catch(e => {
    console.error('\nCHYBA při kontrole:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
