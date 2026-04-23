// HolyOS — Seed demo dat pro Sklad 2.0 testování.
//
// Idempotentní (upsert podle code / lot_code / serial_number).
// Spustit: node scripts/seed-sklad-demo.js
//
// Vytvoří:
//   DEMO-MAT-BASIC  — běžný materiál, 50 ks na lokaci
//   DEMO-MAT-SN     — save_sn_first_scan (servis), 5 S/N, 1 vydaný
//   DEMO-MAT-EXP    — expirable, 2 šarže (jedna +60d, druhá +10d pro widget)
//   DEMO-MAT-BATCH  — distinguish_batches (výrobní šarže), 1 šarže
//   + 1 otevřená dávka s 3 položkami
//   + 1 rozpracovaná inventura

const { PrismaClient } = require('@prisma/client');
const snService = require('../services/warehouse/serial-numbers.service');
const lotsService = require('../services/warehouse/lots.service');
const { createMove } = require('../services/warehouse/moves.service');
const { createBatch } = require('../services/warehouse/batches.service');

const prisma = new PrismaClient();

function daysFromNow(d) {
  const r = new Date();
  r.setDate(r.getDate() + d);
  return r;
}

async function resetForMaterial(materialId) {
  // Reset všech závislých dat, aby seed byl skutečně idempotent.
  await prisma.serialNumber.deleteMany({ where: { material_id: materialId } });
  await prisma.stock.deleteMany({ where: { material_id: materialId } });
  await prisma.materialLot.deleteMany({ where: { material_id: materialId } });
  await prisma.inventoryMovement.deleteMany({ where: { material_id: materialId } });
  await prisma.material.update({ where: { id: materialId }, data: { current_stock: 0 } });
}

async function main() {
  console.log('='.repeat(70));
  console.log('HolyOS Sklad 2.0 — seed demo dat');
  console.log('='.repeat(70));

  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  if (!warehouse) throw new Error('Potřebuju aspoň jeden aktivní sklad');
  const locations = await prisma.warehouseLocation.findMany({
    where: { warehouse_id: warehouse.id },
    orderBy: { id: 'asc' },
    take: 3,
  });
  if (locations.length < 1) throw new Error(`Sklad ${warehouse.id} nemá lokace`);
  const [locA, locB = locA, locC = locA] = locations;
  console.log(`\nSklad: id=${warehouse.id} "${warehouse.name}"`);
  console.log(`Lokace: A=${locA.label}, B=${locB.label}, C=${locC.label}`);

  // ---------------------------------------------------------------------------
  // DEMO-MAT-BASIC — běžný
  // ---------------------------------------------------------------------------
  console.log('\n[1] DEMO-MAT-BASIC — běžný materiál');
  const basic = await prisma.material.upsert({
    where: { code: 'DEMO-MAT-BASIC' },
    update: {},
    create: {
      code: 'DEMO-MAT-BASIC',
      name: 'DEMO — šroub M8×40',
      unit: 'ks',
      sector: 'vyroba',
      status: 'active',
      unit_price: 2.5,
      min_stock: 10,
    },
  });
  await resetForMaterial(basic.id);
  await createMove({
    type: 'receipt',
    material_id: basic.id,
    warehouse_id: warehouse.id,
    to_location_id: locA.id,
    quantity: 50,
    unit_price: 2.5,
    note: 'Demo seed',
  });
  console.log(`   ✓ 50 ks na lokaci ${locA.label}`);

  // ---------------------------------------------------------------------------
  // DEMO-MAT-SN — servisní, sériová čísla
  // ---------------------------------------------------------------------------
  console.log('\n[2] DEMO-MAT-SN — servisní s S/N');
  const snMat = await prisma.material.upsert({
    where: { code: 'DEMO-MAT-SN' },
    update: {
      save_sn_first_scan: true,
      sn_mask: '^DEMO-SN-\\d{3}$',
    },
    create: {
      code: 'DEMO-MAT-SN',
      name: 'DEMO — servisní modul',
      unit: 'ks',
      sector: 'servis',
      status: 'active',
      unit_price: 1200,
      save_sn_first_scan: true,
      sn_mask: '^DEMO-SN-\\d{3}$',
    },
  });
  await resetForMaterial(snMat.id);
  const snBulk = await snService.createBulkReceiptWithSerials({
    material_id: snMat.id,
    warehouse_id: warehouse.id,
    location_id: locB.id,
    serials: ['DEMO-SN-001', 'DEMO-SN-002', 'DEMO-SN-003', 'DEMO-SN-004', 'DEMO-SN-005'],
    unit_price: 1200,
    note: 'Demo seed',
  });
  console.log(`   ✓ 5 S/N přijato`);
  // 1 vydaný pro ukázku status flow
  await snService.issueSerial({
    id: snBulk.serials[0].id,
    warehouse_id: warehouse.id,
    reference_type: 'service_case',
    reference_id: 100,
    note: 'Demo servisní zakázka #100',
  });
  console.log(`   ✓ DEMO-SN-001 vydáno na servisní zakázku #100`);

  // ---------------------------------------------------------------------------
  // DEMO-MAT-EXP — expirable, šarže, FIFO/widget demo
  // ---------------------------------------------------------------------------
  console.log('\n[3] DEMO-MAT-EXP — expirable materiál (prádelna)');
  const expMat = await prisma.material.upsert({
    where: { code: 'DEMO-MAT-EXP' },
    update: {
      expirable: true,
      distinguish_batches: true,
      shelf_life: '12',
      shelf_life_unit: 'month',
    },
    create: {
      code: 'DEMO-MAT-EXP',
      name: 'DEMO — prací prostředek',
      unit: 'l',
      sector: 'pradelna',
      status: 'active',
      expirable: true,
      distinguish_batches: true,
      shelf_life: '12',
      shelf_life_unit: 'month',
      unit_price: 45,
    },
  });
  await resetForMaterial(expMat.id);
  await lotsService.receiveLotWithMove({
    material_id: expMat.id,
    warehouse_id: warehouse.id,
    location_id: locA.id,
    quantity: 20,
    lot_code: 'DEMO-LOT-2026-A',
    expires_at: daysFromNow(60),
    note: 'Demo seed',
  });
  // Druhá šarže blíž expirace — zobrazí se v dashboard widgetu
  await lotsService.receiveLotWithMove({
    material_id: expMat.id,
    warehouse_id: warehouse.id,
    location_id: locA.id,
    quantity: 8,
    lot_code: 'DEMO-LOT-2026-B',
    expires_at: daysFromNow(10),
    note: 'Demo seed — brzy expiruje',
  });
  console.log(`   ✓ 2 šarže: A (+60d) 20 l, B (+10d) 8 l`);

  // ---------------------------------------------------------------------------
  // DEMO-MAT-BATCH — distinguish_batches (výrobní šarže, ne expirace)
  // ---------------------------------------------------------------------------
  console.log('\n[4] DEMO-MAT-BATCH — distinguish_batches');
  const batchMat = await prisma.material.upsert({
    where: { code: 'DEMO-MAT-BATCH' },
    update: {
      distinguish_batches: true,
    },
    create: {
      code: 'DEMO-MAT-BATCH',
      name: 'DEMO — polotovar FX',
      unit: 'ks',
      sector: 'vyroba',
      status: 'active',
      distinguish_batches: true,
      unit_price: 80,
    },
  });
  await resetForMaterial(batchMat.id);
  await lotsService.receiveLotWithMove({
    material_id: batchMat.id,
    warehouse_id: warehouse.id,
    location_id: locB.id,
    quantity: 15,
    lot_code: 'DEMO-BATCH-A',
    note: 'Výrobní šarže, bez expirace',
  });
  console.log(`   ✓ 1 šarže 15 ks`);

  // ---------------------------------------------------------------------------
  // Dávka — 3 položky (základní, šaržovaná, sériová)
  // ---------------------------------------------------------------------------
  console.log('\n[5] Dávka (pickovací list)');
  // Nejprve smaž existující demo dávku
  const existingBatches = await prisma.batch.findMany({
    where: { number: { startsWith: 'BAT-DEMO-' } },
  });
  for (const b of existingBatches) {
    await prisma.batchItem.deleteMany({ where: { batch_id: b.id } });
    await prisma.batch.delete({ where: { id: b.id } });
  }
  const demoBatch = await createBatch({
    sector: 'vyroba',
    note: 'DEMO dávka pro zakázku #123',
    items: [
      { material_id: basic.id, from_location_id: locA.id, quantity: 5 },
      { material_id: expMat.id, from_location_id: locA.id, quantity: 3 },
      { material_id: batchMat.id, from_location_id: locB.id, quantity: 2 },
    ],
  });
  // Přejmenuj na DEMO číslo pro odlišení
  await prisma.batch.update({
    where: { id: demoBatch.id },
    data: { number: 'BAT-DEMO-' + String(demoBatch.id).padStart(4, '0') },
  });
  console.log(`   ✓ Dávka BAT-DEMO-${String(demoBatch.id).padStart(4, '0')} (3 položky, open)`);

  // ---------------------------------------------------------------------------
  // Inventura — rozpracovaná
  // ---------------------------------------------------------------------------
  console.log('\n[6] Inventura');
  const existingInv = await prisma.inventory.findFirst({
    where: { name: 'DEMO inventura Q2' },
  });
  if (existingInv) {
    await prisma.inventoryItem.deleteMany({ where: { inventory_id: existingInv.id } });
    await prisma.inventory.delete({ where: { id: existingInv.id } });
  }
  const inv = await prisma.inventory.create({
    data: {
      name: 'DEMO inventura Q2',
      warehouse_id: warehouse.id,
      status: 'in_progress',
      started_at: new Date(),
      items: {
        create: [
          { material_id: basic.id, location_id: locA.id, expected_qty: 50 },
          { material_id: expMat.id, location_id: locA.id, expected_qty: 28 },
          { material_id: batchMat.id, location_id: locB.id, expected_qty: 15 },
        ],
      },
    },
  });
  console.log(`   ✓ Inventura "${inv.name}" — 3 položky k spočítání`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log('HOTOVO — demo data připravena.');
  console.log('='.repeat(70));
  console.log('');
  console.log('Materiály:');
  console.log(`   DEMO-MAT-BASIC   (id=${basic.id})   50 ks`);
  console.log(`   DEMO-MAT-SN      (id=${snMat.id})   5 S/N (1 vydaný)`);
  console.log(`   DEMO-MAT-EXP     (id=${expMat.id})  28 l ve 2 šaržích`);
  console.log(`   DEMO-MAT-BATCH   (id=${batchMat.id}) 15 ks v 1 šarži`);
  console.log('');
  console.log('Doporučené testování:');
  console.log('  1) Otevři modules/nakup-sklad/ → Přehled →');
  console.log('     vidíš widget „Blížící se expirace" (DEMO-LOT-2026-B) +');
  console.log('     widget „Sériová čísla" (4 skladem, 1 vydané)');
  console.log('  2) Detail DEMO-MAT-SN → tab 🔖 Sériová čísla → Přijmout / Vydat / Vyřadit');
  console.log('  3) Detail DEMO-MAT-EXP → tab 📦 Šarže → Přijmout šarži');
  console.log('  4) modules/davky/ → Detail BAT-DEMO-XXXX → Pick / Split přes šarže');
  console.log('  5) PWA (app.holyos.cz/pwa/) → Inventura → DEMO inventura Q2');
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n✘ Seed selhal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
