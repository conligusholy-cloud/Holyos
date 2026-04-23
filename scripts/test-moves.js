// HolyOS — Test Sklad 2.0 | Moves + Stock transakce + idempotence
//
// Projde scénář:
//   1. Vytvoří TEST materiál (upsert podle barcode)
//   2. Najde 2 lokace ve skladu warehouse_id=1
//   3. Resetuje pohyby + stock pro TEST materiál
//   4. POHYB #1: receipt 100 ks na loc A  → Stock A = 100
//   5. POHYB #2: receipt 50 ks na loc A   → Stock A = 150
//   6. POHYB #3: transfer 30 ks A→B        → Stock A = 120, Stock B = 30
//   7. POHYB #4: stejný client_uuid jako #3 → dedup, Stock beze změny
//   8. Kontrola Material.current_stock (celková)
//
// Spuštění: node scripts/test-moves.js

const { PrismaClient } = require('@prisma/client');
const { createMove } = require('../services/warehouse/moves.service');

const prisma = new PrismaClient();

const TEST_BARCODE = 'TEST-SKLAD2-MAT-001';
const UUID = {
  r1: '00000000-0000-4000-8000-000000000001',
  r2: '00000000-0000-4000-8000-000000000002',
  t1: '00000000-0000-4000-8000-000000000003',
  t1_dup: '00000000-0000-4000-8000-000000000003', // stejný jako t1 = dedup test
};

function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'} — ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  console.log('='.repeat(70));
  console.log('Test Sklad 2.0 — moves + stock + idempotence');
  console.log('='.repeat(70));

  // 1. TEST materiál
  const material = await prisma.material.upsert({
    where: { barcode: TEST_BARCODE },
    update: {},
    create: {
      code: 'TEST-SKLAD2-001',
      name: 'TEST materiál sklad 2.0',
      barcode: TEST_BARCODE,
      unit: 'ks',
      sector: 'vyroba',
      status: 'active',
    },
  });
  console.log(`\nTEST materiál: id=${material.id} code=${material.code} barcode=${material.barcode}`);

  // 2. Sklad + 2 lokace
  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  if (!warehouse) throw new Error('Žádný aktivní sklad');
  const locations = await prisma.warehouseLocation.findMany({
    where: { warehouse_id: warehouse.id },
    take: 2,
    orderBy: { id: 'asc' },
  });
  if (locations.length < 2) throw new Error(`Sklad id=${warehouse.id} musí mít ≥ 2 lokace`);
  const [locA, locB] = locations;
  console.log(`Sklad: id=${warehouse.id} name="${warehouse.name}"`);
  console.log(`Lokace A: id=${locA.id} label="${locA.label}"`);
  console.log(`Lokace B: id=${locB.id} label="${locB.label}"`);

  // 3. Reset (smazat předchozí test data)
  const delMoves = await prisma.inventoryMovement.deleteMany({ where: { material_id: material.id } });
  const delStock = await prisma.stock.deleteMany({ where: { material_id: material.id } });
  await prisma.material.update({ where: { id: material.id }, data: { current_stock: 0 } });
  console.log(`\nReset: smazáno ${delMoves.count} pohybů, ${delStock.count} stock řádků.`);

  // 4. Receipt 100 ks na A
  console.log('\n[4] Receipt 100 ks na A');
  const r1 = await createMove({
    client_uuid: UUID.r1,
    type: 'receipt',
    material_id: material.id,
    warehouse_id: warehouse.id,
    to_location_id: locA.id,
    quantity: 100,
  });
  ok(!r1.deduped, 'první receipt nebyl dedup');
  ok(r1.move.type === 'receipt', 'typ = receipt');

  // 5. Receipt 50 ks na A
  console.log('\n[5] Receipt 50 ks na A');
  await createMove({
    client_uuid: UUID.r2,
    type: 'receipt',
    material_id: material.id,
    warehouse_id: warehouse.id,
    to_location_id: locA.id,
    quantity: 50,
  });
  const stockAfter2 = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: locA.id, lot_id: null },
  });
  ok(Number(stockAfter2.quantity) === 150, `Stock A = 150 (je ${stockAfter2.quantity})`);

  // 6. Transfer 30 ks A → B
  console.log('\n[6] Transfer 30 ks A → B');
  await createMove({
    client_uuid: UUID.t1,
    type: 'transfer',
    material_id: material.id,
    warehouse_id: warehouse.id,
    from_location_id: locA.id,
    to_location_id: locB.id,
    quantity: 30,
  });
  const stockAAfter3 = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: locA.id, lot_id: null },
  });
  const stockBAfter3 = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: locB.id, lot_id: null },
  });
  ok(Number(stockAAfter3.quantity) === 120, `Stock A = 120 (je ${stockAAfter3.quantity})`);
  ok(Number(stockBAfter3.quantity) === 30, `Stock B = 30 (je ${stockBAfter3.quantity})`);

  // 7. Idempotence — stejný client_uuid jako #6
  console.log('\n[7] Resend transfer se stejným client_uuid (dedup test)');
  const r4 = await createMove({
    client_uuid: UUID.t1_dup,
    type: 'transfer',
    material_id: material.id,
    warehouse_id: warehouse.id,
    from_location_id: locA.id,
    to_location_id: locB.id,
    quantity: 30,
  });
  ok(r4.deduped === true, 'druhý send byl dedup (deduped=true)');
  ok(r4.move.id === (await prisma.inventoryMovement.findUnique({ where: { client_uuid: UUID.t1 } })).id,
     'vrácen byl původní move');

  const stockAFinal = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: locA.id, lot_id: null },
  });
  const stockBFinal = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: locB.id, lot_id: null },
  });
  ok(Number(stockAFinal.quantity) === 120, `Stock A po dedup = 120 (je ${stockAFinal.quantity})`);
  ok(Number(stockBFinal.quantity) === 30, `Stock B po dedup = 30 (je ${stockBFinal.quantity})`);

  // 8. Material.current_stock (celková suma)
  console.log('\n[8] Material.current_stock (celková, backward-compat)');
  const mat = await prisma.material.findUnique({ where: { id: material.id } });
  ok(Number(mat.current_stock) === 150, `current_stock = 150 (je ${mat.current_stock})`);
  // 150 = 100 + 50 (transfer se ruší: -30+30=0)

  // Počet pohybů
  const movesCount = await prisma.inventoryMovement.count({ where: { material_id: material.id } });
  ok(movesCount === 3, `v DB jsou 3 pohyby (je ${movesCount}, čtvrtý byl dedup)`);

  console.log('\n' + '='.repeat(70));
  if (process.exitCode) {
    console.log('NĚKTERÉ TESTY SELHALY.');
  } else {
    console.log('Všechny kontroly prošly.');
  }
  console.log('='.repeat(70));
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
