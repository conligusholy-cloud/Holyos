// HolyOS — Test Sklad 2.0 | Sériová čísla end-to-end
//
// Scénář:
//   1. Vytvoří/upsertuje TEST materiál s save_sn_first_scan=true, sn_mask='^SNTEST-\\d{3}$'
//   2. Najde warehouse + lokaci
//   3. Reset: smaže staré SN, moves, stock pro tento materiál
//   4. Bulk receipt 3 S/N → ověří Stock, current_stock, 3× SerialNumber(in_stock)
//   5. Kolize: zkusí přijmout SNTEST-001 znovu → 409 error
//   6. Mask: zkusí přijmout SN-XXX (neodpovídá masce) → 409 error
//   7. Issue jednoho S/N → status=issued, issue move vznikl
//   8. Scrap jednoho S/N → status=scrapped
//   9. Return toho issued → status=returned, location_id nastaveno
//
// Spuštění: node scripts/test-serials.js
// Idempotent — lze spustit opakovaně.

const { PrismaClient } = require('@prisma/client');
const snService = require('../services/warehouse/serial-numbers.service');

const prisma = new PrismaClient();

const TEST_MATERIAL_CODE = 'TEST-SN-MAT-001';

function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'} — ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  console.log('='.repeat(70));
  console.log('Test Sklad 2.0 — sériová čísla (SN)');
  console.log('='.repeat(70));

  // 1. TEST materiál s save_sn_first_scan + sn_mask
  const material = await prisma.material.upsert({
    where: { code: TEST_MATERIAL_CODE },
    update: {
      save_sn_first_scan: true,
      sn_mask: '^SNTEST-\\d{3}$',
    },
    create: {
      code: TEST_MATERIAL_CODE,
      name: 'TEST SN materiál',
      unit: 'ks',
      sector: 'servis',
      status: 'active',
      save_sn_first_scan: true,
      sn_mask: '^SNTEST-\\d{3}$',
    },
  });
  console.log(`\nTEST materiál: id=${material.id} code=${material.code}`);

  // 2. Warehouse + lokace
  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  if (!warehouse) throw new Error('Žádný aktivní sklad');
  const location = await prisma.warehouseLocation.findFirst({ where: { warehouse_id: warehouse.id }, orderBy: { id: 'asc' } });
  if (!location) throw new Error('Sklad bez lokace');

  // 3. Reset — idempotence
  await prisma.serialNumber.deleteMany({ where: { material_id: material.id } });
  await prisma.inventoryMovement.deleteMany({ where: { material_id: material.id } });
  await prisma.stock.deleteMany({ where: { material_id: material.id } });
  await prisma.material.update({ where: { id: material.id }, data: { current_stock: 0 } });
  console.log(`Reset OK`);

  // 4. Bulk receipt 3 S/N
  console.log('\n[4] Bulk receipt 3 S/N (SNTEST-001..003)');
  const bulkResult = await snService.createBulkReceiptWithSerials({
    material_id: material.id,
    warehouse_id: warehouse.id,
    location_id: location.id,
    serials: ['SNTEST-001', 'SNTEST-002', 'SNTEST-003'],
    note: 'Test bulk',
  });
  ok(bulkResult.move && bulkResult.move.id, 'receipt move vytvořen');
  ok(bulkResult.serials.length === 3, 'vzniklo 3× SerialNumber');
  ok(bulkResult.serials.every((s) => s.status === 'in_stock'), 'všechny in_stock');

  const matAfter = await prisma.material.findUnique({ where: { id: material.id } });
  ok(Number(matAfter.current_stock) === 3, `Material.current_stock = 3 (je ${matAfter.current_stock})`);

  const stock = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: location.id, lot_id: null },
  });
  ok(stock && Number(stock.quantity) === 3, `Stock na lokaci #${location.id} = 3 (je ${stock?.quantity})`);

  // 5. Kolize: opakovaný bulk receipt stejného S/N
  console.log('\n[5] Kolize — duplicate S/N');
  let collisionErr = null;
  try {
    await snService.createBulkReceiptWithSerials({
      material_id: material.id,
      warehouse_id: warehouse.id,
      location_id: location.id,
      serials: ['SNTEST-001'],
    });
  } catch (e) { collisionErr = e; }
  ok(collisionErr && collisionErr.message.includes('už existují'), `kolize vyvolala chybu (${collisionErr?.message})`);

  // 6. Mask: zkusit SN-XXX neodpovídající masce
  console.log('\n[6] Mask validation');
  let maskErr = null;
  try {
    await snService.createBulkReceiptWithSerials({
      material_id: material.id,
      warehouse_id: warehouse.id,
      location_id: location.id,
      serials: ['SN-XXX'],
    });
  } catch (e) { maskErr = e; }
  ok(maskErr && maskErr.message.includes('masce'), `maska vyvolala chybu (${maskErr?.message})`);

  // 7. Issue první S/N
  console.log('\n[7] Issue SNTEST-001');
  const sn001 = bulkResult.serials.find((s) => s.serial_number === 'SNTEST-001');
  const issueRes = await snService.issueSerial({
    id: sn001.id,
    warehouse_id: warehouse.id,
    reference_type: 'service_case',
    reference_id: 999,
    note: 'Test issue',
  });
  ok(issueRes.serial.status === 'issued', 'status=issued');
  ok(issueRes.move && issueRes.move.type === 'issue', 'issue pohyb vznikl');

  const matAfterIssue = await prisma.material.findUnique({ where: { id: material.id } });
  ok(Number(matAfterIssue.current_stock) === 2, `current_stock po issue = 2 (je ${matAfterIssue.current_stock})`);

  // 8. Scrap druhého
  console.log('\n[8] Scrap SNTEST-002');
  const sn002 = bulkResult.serials.find((s) => s.serial_number === 'SNTEST-002');
  const scrapRes = await snService.scrapSerial({ id: sn002.id, note: 'Test scrap' });
  ok(scrapRes.status === 'scrapped', 'status=scrapped');

  // 9. Return toho issued
  console.log('\n[9] Return SNTEST-001 na jinou lokaci');
  const retRes = await snService.returnSerial({
    id: sn001.id,
    location_id: location.id,
    note: 'Test return',
  });
  ok(retRes.status === 'returned', 'status=returned');
  ok(retRes.location_id === location.id, 'location_id nastaveno');

  console.log('\n' + '='.repeat(70));
  console.log(process.exitCode ? '✘ NĚCO SELHALO' : '✓ VŠE OK');
  console.log('='.repeat(70));
}

main()
  .catch((err) => {
    console.error('\n✘ Test selhal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
