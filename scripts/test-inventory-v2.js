// HolyOS — Test Sklad 2.0 | Inventory v2 (lock + finish-v2)
//
// Scénář:
//   1. Seed: 100 ks na locA, 50 ks na locB
//   2. Vytvoř inventuru s 2 položkami:
//       - A: expected=100, actual=95  (difference = 5, chybí)
//       - B: expected=50,  actual=52  (difference = -2, přebývá)
//   3. lock-locations → ověř locked_for_inventory=true
//   4. finish-v2 → ověř:
//       - vygenerované 2 adjust pohyby
//       - Stock A = 95, Stock B = 52
//       - Material.current_stock = 147
//       - Inventory.status = completed
//       - locked_for_inventory = false (uvolněno)
//   5. finish-v2 znovu → error "uzavřená"

const { PrismaClient } = require('@prisma/client');
const { lockLocations, unlockLocations, finishInventoryWithAdjust } = require('../services/warehouse/inventory-v2.service');
const { createMove } = require('../services/warehouse/moves.service');

const prisma = new PrismaClient();

const TEST_BARCODE = 'TEST-SKLAD2-MAT-001';
const TEST_INV_NAME_PREFIX = 'TEST-SKLAD2 Inventura';
const UUID = {
  seed_a: '00000000-0000-4000-8000-000000000030',
  seed_b: '00000000-0000-4000-8000-000000000031',
};

function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'} — ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function reset(material_id) {
  // Smaž TEST inventury (cascade smaže items)
  await prisma.inventory.deleteMany({ where: { name: { startsWith: TEST_INV_NAME_PREFIX } } });
  // Smaž pohyby + stock + reset current_stock
  await prisma.inventoryMovement.deleteMany({ where: { material_id } });
  await prisma.stock.deleteMany({ where: { material_id } });
  await prisma.material.update({ where: { id: material_id }, data: { current_stock: 0 } });
}

async function main() {
  console.log('='.repeat(70));
  console.log('Test Sklad 2.0 — inventory v2 (lock + finish-v2)');
  console.log('='.repeat(70));

  const material = await prisma.material.upsert({
    where: { barcode: TEST_BARCODE },
    update: {},
    create: {
      code: 'TEST-SKLAD2-001', name: 'TEST materiál sklad 2.0',
      barcode: TEST_BARCODE, unit: 'ks', sector: 'vyroba', status: 'active',
    },
  });
  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  const [locA, locB] = await prisma.warehouseLocation.findMany({
    where: { warehouse_id: warehouse.id }, orderBy: { id: 'asc' }, take: 2,
  });
  console.log(`Material: ${material.id}  Sklad: ${warehouse.id}  locA: ${locA.id}  locB: ${locB.id}`);

  await reset(material.id);
  console.log('Reset: TEST data smazána.');

  // Seed: 100 na A, 50 na B
  await createMove({ client_uuid: UUID.seed_a, type: 'receipt', material_id: material.id, warehouse_id: warehouse.id, to_location_id: locA.id, quantity: 100 });
  await createMove({ client_uuid: UUID.seed_b, type: 'receipt', material_id: material.id, warehouse_id: warehouse.id, to_location_id: locB.id, quantity: 50 });
  console.log('Seed: 100 ks na locA, 50 ks na locB.');

  // Vytvoř inventuru v2 s 2 items
  const inv = await prisma.inventory.create({
    data: {
      warehouse_id: warehouse.id,
      name: `${TEST_INV_NAME_PREFIX} ${new Date().toISOString()}`,
      status: 'in_progress',
      started_at: new Date(),
    },
  });
  await prisma.inventoryItem.createMany({
    data: [
      {
        inventory_id: inv.id, material_id: material.id, location_id: locA.id,
        expected_qty: 100, actual_qty: 95, difference: 5, // chybí 5
      },
      {
        inventory_id: inv.id, material_id: material.id, location_id: locB.id,
        expected_qty: 50, actual_qty: 52, difference: -2, // přebývá 2
      },
    ],
  });
  console.log(`Inventura: id=${inv.id}, 2 items (A: exp=100/act=95, B: exp=50/act=52)`);

  // Lock
  console.log('\n[Lock] Zamkni lokace');
  const lockRes = await lockLocations(inv.id);
  ok(lockRes.locked_count === 2, `zamčeno 2 lokace (${lockRes.locked_count})`);

  const locAAfterLock = await prisma.warehouseLocation.findUnique({ where: { id: locA.id } });
  const locBAfterLock = await prisma.warehouseLocation.findUnique({ where: { id: locB.id } });
  ok(locAAfterLock.locked_for_inventory === true, 'locA.locked_for_inventory = true');
  ok(locBAfterLock.locked_for_inventory === true, 'locB.locked_for_inventory = true');

  // Finish v2
  console.log('\n[Finish-v2] Vygeneruj adjust pohyby + uzavři');
  const finishRes = await finishInventoryWithAdjust(inv.id, null);
  ok(finishRes.adjustments_count === 2, `vygenerováno 2 adjust pohybů (${finishRes.adjustments_count})`);
  ok(finishRes.inventory.status === 'completed', `inventura completed`);
  ok(finishRes.inventory.completed_at != null, `completed_at nastaveno`);

  // Stock stav
  const stockA = await prisma.stock.findUnique({ where: { material_id_location_id: { material_id: material.id, location_id: locA.id } } });
  const stockB = await prisma.stock.findUnique({ where: { material_id_location_id: { material_id: material.id, location_id: locB.id } } });
  ok(Number(stockA.quantity) === 95, `Stock A = 95 (je ${stockA.quantity})`);
  ok(Number(stockB.quantity) === 52, `Stock B = 52 (je ${stockB.quantity})`);

  // current_stock = 100+50-5+2 = 147
  const mat = await prisma.material.findUnique({ where: { id: material.id } });
  ok(Number(mat.current_stock) === 147, `current_stock = 147 (je ${mat.current_stock})`);

  // Lokace odemčené
  const locAAfterFinish = await prisma.warehouseLocation.findUnique({ where: { id: locA.id } });
  const locBAfterFinish = await prisma.warehouseLocation.findUnique({ where: { id: locB.id } });
  ok(locAAfterFinish.locked_for_inventory === false, 'locA odemčena po finish');
  ok(locBAfterFinish.locked_for_inventory === false, 'locB odemčena po finish');

  // Adjust pohyby jsou v DB
  const adjustMoves = await prisma.inventoryMovement.findMany({
    where: { material_id: material.id, type: 'inventory_adjust' },
    orderBy: { id: 'asc' },
  });
  ok(adjustMoves.length === 2, `v DB jsou 2 inventory_adjust pohyby`);
  ok(Number(adjustMoves[0].quantity) === -5, `pohyb pro A: quantity = -5 (chybí)`);
  ok(Number(adjustMoves[1].quantity) === 2, `pohyb pro B: quantity = +2 (přebývá)`);
  ok(adjustMoves.every(m => m.reference_type === 'inventory' && m.reference_id === inv.id), 'pohyby mají reference_type=inventory');

  // Znovu finish → error
  console.log('\n[Finish-v2 resend] po dokončení vyvolat znovu');
  let err = null;
  try { await finishInventoryWithAdjust(inv.id, null); } catch (e) { err = e; }
  ok(err && err.message.includes('uzavřená'), 'resend finish-v2 → error "uzavřená"');

  console.log('\n' + '='.repeat(70));
  console.log(process.exitCode ? 'NĚKTERÉ TESTY SELHALY.' : 'Všechny kontroly prošly.');
  console.log('='.repeat(70));
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
