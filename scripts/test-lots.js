// HolyOS — Test Sklad 2.0 | Šarže (MaterialLot) end-to-end
//
// Scénář:
//   1. TEST materiál s expirable=true a shelf_life=12 month
//   2. Reset (smaže stock, lots, moves pro tento materiál)
//   3. Přijmi lot-A 10 ks (expires za 60 dní) na lokaci X
//   4. Přijmi lot-B 5 ks (expires za 30 dní) na lokaci X
//   5. Ověř Stock triplet: 2 řádky pro stejnou [mat, loc] s různými lot_id
//   6. listFifoCandidates — lot-B má být první (dřívější expirace)
//   7. Pick přes FIFO: simuluj dávku s požadavkem 3 ks → vybere lot-B
//   8. Guard expired: PATCH lot-B status → expired, zkus issue → fail
//   9. sweepExpiredLots manuálně
//  10. Cleanup
//
// Spuštění: node scripts/test-lots.js  (idempotent)

const { PrismaClient } = require('@prisma/client');
const lotsService = require('../services/warehouse/lots.service');
const { createMove } = require('../services/warehouse/moves.service');

const prisma = new PrismaClient();

const TEST_MATERIAL_CODE = 'TEST-LOT-MAT-001';

function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'} — ${msg}`);
  if (!cond) process.exitCode = 1;
}

function daysFromNow(d) {
  const r = new Date();
  r.setDate(r.getDate() + d);
  return r;
}

async function main() {
  console.log('='.repeat(70));
  console.log('Test Sklad 2.0 — šarže (MaterialLot) + FIFO');
  console.log('='.repeat(70));

  const material = await prisma.material.upsert({
    where: { code: TEST_MATERIAL_CODE },
    update: {
      expirable: true,
      distinguish_batches: true,
      shelf_life: '12',
      shelf_life_unit: 'month',
    },
    create: {
      code: TEST_MATERIAL_CODE,
      name: 'TEST lot materiál',
      unit: 'kg',
      sector: 'pradelna',
      status: 'active',
      expirable: true,
      distinguish_batches: true,
      shelf_life: '12',
      shelf_life_unit: 'month',
    },
  });
  console.log(`\nTEST materiál: id=${material.id} code=${material.code}`);

  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  if (!warehouse) throw new Error('Žádný aktivní sklad');
  const location = await prisma.warehouseLocation.findFirst({
    where: { warehouse_id: warehouse.id },
    orderBy: { id: 'asc' },
  });
  if (!location) throw new Error('Sklad bez lokace');

  // Reset
  await prisma.stock.deleteMany({ where: { material_id: material.id } });
  await prisma.materialLot.deleteMany({ where: { material_id: material.id } });
  await prisma.inventoryMovement.deleteMany({ where: { material_id: material.id } });
  await prisma.material.update({ where: { id: material.id }, data: { current_stock: 0 } });
  console.log('Reset OK');

  // [3] lot-A 10 ks, expiruje za 60 dní
  console.log('\n[3] Receive lot-A 10 ks (expires +60d)');
  const lotA = await lotsService.receiveLotWithMove({
    material_id: material.id,
    warehouse_id: warehouse.id,
    location_id: location.id,
    quantity: 10,
    lot_code: 'LOT-TEST-A',
    expires_at: daysFromNow(60),
    note: 'Test lot A',
  });
  ok(lotA.lot && lotA.lot.status === 'in_stock', 'lot-A in_stock');
  ok(Number(lotA.stock.quantity) === 10, `lot-A stock = 10 (je ${lotA.stock.quantity})`);

  // [4] lot-B 5 ks, expiruje za 30 dní (bližší → FIFO kandidát)
  console.log('\n[4] Receive lot-B 5 ks (expires +30d)');
  const lotB = await lotsService.receiveLotWithMove({
    material_id: material.id,
    warehouse_id: warehouse.id,
    location_id: location.id,
    quantity: 5,
    lot_code: 'LOT-TEST-B',
    expires_at: daysFromNow(30),
    note: 'Test lot B',
  });
  ok(lotB.lot && lotB.lot.status === 'in_stock', 'lot-B in_stock');

  // [5] Stock triplet — 2 řádky
  const stockRows = await prisma.stock.findMany({
    where: { material_id: material.id, location_id: location.id },
    orderBy: { lot_id: 'asc' },
  });
  ok(stockRows.length >= 2, `Stock má ≥ 2 řádky pro různé lot_id (má ${stockRows.length})`);
  const lotStockA = stockRows.find((s) => s.lot_id === lotA.lot.id);
  const lotStockB = stockRows.find((s) => s.lot_id === lotB.lot.id);
  ok(lotStockA && Number(lotStockA.quantity) === 10, 'lot-A stock = 10');
  ok(lotStockB && Number(lotStockB.quantity) === 5, 'lot-B stock = 5');

  // Material.current_stock = 15 (součet přes všechny lots)
  const matAfter = await prisma.material.findUnique({ where: { id: material.id } });
  ok(Number(matAfter.current_stock) === 15, `Material.current_stock = 15 (je ${matAfter.current_stock})`);

  // [6] listFifoCandidates — lot-B má být první (dřívější expirace)
  console.log('\n[6] FIFO candidates — lot-B první');
  const candidates = await lotsService.listFifoCandidates({
    material_id: material.id,
    location_id: location.id,
  });
  ok(candidates.length >= 2, `nalezeny ≥ 2 kandidáti (${candidates.length})`);
  ok(candidates[0].lot_id === lotB.lot.id, `první kandidát je lot-B (je lot_id=${candidates[0].lot_id})`);

  // [7] Pick 3 ks přes createMove s lot_id=lotB — simuluje FIFO pick
  console.log('\n[7] Issue 3 ks z lot-B (FIFO pick)');
  const pickMove = await createMove({
    type: 'issue',
    material_id: material.id,
    warehouse_id: warehouse.id,
    location_id: location.id,
    lot_id: lotB.lot.id,
    quantity: 3,
    reference_type: 'test',
    reference_id: 1,
  });
  ok(pickMove.move && pickMove.move.type === 'issue', 'issue move vznikl');

  const lotBStockAfter = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: location.id, lot_id: lotB.lot.id },
  });
  ok(Number(lotBStockAfter.quantity) === 2, `lot-B stock po issue = 2 (je ${lotBStockAfter.quantity})`);

  // [7b] Auto-FIFO: issue 2 ks bez lot_id — backend má vybrat lot-B (bližší expirace)
  console.log('\n[7b] Auto-FIFO issue 2 ks bez lot_id (očekává lot-B)');
  await createMove({
    type: 'issue',
    material_id: material.id,
    warehouse_id: warehouse.id,
    location_id: location.id,
    quantity: 2,
    note: 'Auto-FIFO smoke',
  });
  const lotBStockFinal = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: location.id, lot_id: lotB.lot.id },
  });
  ok(Number(lotBStockFinal?.quantity ?? -1) === 0, `lot-B stock po auto-FIFO = 0 (je ${lotBStockFinal?.quantity ?? 'missing'})`);
  const lotAStockStill = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: location.id, lot_id: lotA.lot.id },
  });
  ok(Number(lotAStockStill?.quantity ?? -1) === 10, `lot-A stock netčen = 10 (je ${lotAStockStill?.quantity})`);

  // [7c] Auto-FIFO — žádná single šarže nemá 15 ks
  console.log('\n[7c] Auto-FIFO — žádná single šarže nemá 15 ks');
  let fifoOverErr = null;
  try {
    await createMove({
      type: 'issue',
      material_id: material.id,
      warehouse_id: warehouse.id,
      location_id: location.id,
      quantity: 15,
    });
  } catch (e) { fifoOverErr = e; }
  ok(fifoOverErr && fifoOverErr.message.includes('šaržovaný'), `auto-FIFO odmítl overflow (${fifoOverErr?.message?.slice(0, 100)})`);

  // [8] Guard expired — markni lot-B jako expired, zkus pohyb → fail
  console.log('\n[8] Guard expired lot');
  await lotsService.changeLotStatus(lotB.lot.id, 'expired', 'test expired');
  let guardErr = null;
  try {
    await createMove({
      type: 'issue',
      material_id: material.id,
      warehouse_id: warehouse.id,
      location_id: location.id,
      lot_id: lotB.lot.id,
      quantity: 1,
    });
  } catch (e) { guardErr = e; }
  ok(guardErr && guardErr.message.includes("ve stavu 'expired'"), `guard odmítl pohyb na expired lot (${guardErr?.message})`);

  // [9] sweepExpiredLots
  console.log('\n[9] sweepExpiredLots');
  // Vytvoř další lot, který už je po expiraci (expires včera)
  const lotExpired = await prisma.materialLot.create({
    data: {
      material_id: material.id,
      lot_code: 'LOT-TEST-EXPIRED',
      status: 'in_stock',
      expires_at: daysFromNow(-1),
    },
  });
  const sweepRes = await lotsService.sweepExpiredLots();
  ok(sweepRes.marked >= 1, `sweep označil ≥ 1 šarži (marked=${sweepRes.marked})`);
  const lotExpiredAfter = await prisma.materialLot.findUnique({ where: { id: lotExpired.id } });
  ok(lotExpiredAfter.status === 'expired', `lot-expired status = expired (je ${lotExpiredAfter.status})`);

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
