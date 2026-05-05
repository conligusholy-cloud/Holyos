// Diagnostika konkrétního mismatch páru: porovná Factorify StockMove s HolyOS
// Spuštění: node scripts/debug-mismatch.js <material_factorify_id> <stock_factorify_id>

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const factorify = require('../services/factorify/client.service');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

async function main() {
  const matFid = process.argv[2] || '605';
  const stockFid = process.argv[3] || '21';

  console.log(`\n🔍 Mismatch analýza: material=${matFid}, stock=${stockFid}\n`);

  // 1) Factorify StockItem
  const fyItems = await factorify.query('StockItem', { limit: 100 });
  // Filtr na klientovi
  const matchingFy = fyItems.filter(i =>
    String(i?.goods?.id) === matFid && String(i?.stock?.id) === stockFid
  );
  console.log(`Factorify StockItem (sample 100): ${matchingFy.length} match`);
  for (const i of matchingFy) {
    console.log(`  id=${i.id} qty=${i.quantity} position=${i.position?.label || '-'} batch=${i.batch?.id || '-'}`);
  }

  // 2) HolyOS InventoryMovement pro tento pár
  const material = await prisma.material.findFirst({ where: { factorify_id: matFid }, select: { id: true, code: true, name: true } });
  const warehouse = await prisma.warehouse.findFirst({ where: { factorify_id: stockFid }, select: { id: true, name: true } });
  if (!material) { console.log(`\n❌ Material ${matFid} nenalezen`); return; }
  if (!warehouse) { console.log(`\n❌ Warehouse ${stockFid} nenalezen`); return; }
  console.log(`\nMaterial: ${material.code} (${material.name})`);
  console.log(`Warehouse: ${warehouse.name}`);

  const moves = await prisma.inventoryMovement.findMany({
    where: { material_id: material.id, warehouse_id: warehouse.id },
    select: {
      type: true, quantity: true, factorify_state: true,
      factorify_moved_at: true, factorify_id: true,
    },
    orderBy: { factorify_moved_at: 'asc' },
  });

  console.log(`\nHolyOS InventoryMovement: ${moves.length} pohybů`);
  let sum = 0;
  for (const m of moves) {
    const q = Number(m.quantity);
    sum += q;
    const sign = q > 0 ? '+' : '';
    console.log(`  fy_id=${m.factorify_id?.padEnd(7)} ${m.factorify_moved_at?.toISOString().slice(0, 10)} type=${m.type.padEnd(20)} state=${(m.factorify_state || '-').padEnd(10)} qty=${sign}${q.toFixed(0)}  → sum=${sum.toFixed(0)}`);
  }
  console.log(`\n📊 HolyOS sum: ${sum}`);
  console.log(`📊 Factorify sum (z 100 sample): ${matchingFy.reduce((s, i) => s + Number(i.quantity || 0), 0)}`);

  // 3) Pro 605-21 stáhnout VŠECHNY StockItem (nejen 100) a najít všechny záznamy
  console.log(`\n🔎 Stahuji všechny StockItem pro tento pár (paginace)…`);
  let offset = 0;
  let allMatchingFy = [];
  while (true) {
    const page = await factorify.query('StockItem', { limit: 5000, offset });
    if (page.length === 0) break;
    const matches = page.filter(i =>
      String(i?.goods?.id) === matFid && String(i?.stock?.id) === stockFid
    );
    allMatchingFy.push(...matches);
    if (page.length < 5000) break;
    offset += 5000;
  }
  console.log(`  Nalezeno ${allMatchingFy.length} StockItem records pro pár`);
  let totalFy = 0;
  for (const i of allMatchingFy) {
    totalFy += Number(i.quantity || 0);
    console.log(`  id=${i.id} qty=${i.quantity} position=${i.position?.label || '-'} batch=${i.batch?.id || '-'}`);
  }
  console.log(`  Factorify total: ${totalFy}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
