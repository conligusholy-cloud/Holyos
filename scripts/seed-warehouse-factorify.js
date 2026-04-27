// HolyOS — migrace skladu "SKLAD - A - RK" z Factorify do HolyOS.
//
// Natvrdo přiřazuje Factorify ID:
//   Warehouse id=1  "SKLAD - A - RK"   (80 pozic)
//   Warehouse id=7  "Sklad Vrtačka"    (prázdný)
//
// Flagy:
//   --wipe-vrtacka   DESTRUKTIVNĚ smaže testovací data Vrtačky před přečíslováním
//
// Spuštění:
//   $env:DATABASE_URL = "postgresql://..."
//   node scripts/seed-warehouse-factorify.js --wipe-vrtacka

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ARGS = process.argv.slice(2);
const WIPE_VRTACKA = ARGS.includes('--wipe-vrtacka');

const RK_WH = { id: 1, name: 'SKLAD - A - RK', code: 'RK', type: 'main' };
const VRTACKA_WH = { id: 7, name: 'Sklad Vrtačka', code: 'VRT', type: 'main' };

const RK_POSITIONS = [
  'A01A',
  'A03A', 'A03B', 'A03C', 'A03D', 'A03E', 'A03F',
  'A04A', 'A04B', 'A04C', 'A04D', 'A04E', 'A04F',
  'A05A', 'A05B', 'A05C', 'A05D', 'A05E', 'A05F',
  'A06A', 'A06B', 'A06C', 'A06D', 'A06E', 'A06F',
  'A07A', 'A07B', 'A07C', 'A07D', 'A07E', 'A07F',
  'A08A', 'A08B', 'A08C', 'A08D', 'A08E', 'A08F',
  'A09A', 'A09B', 'A09C', 'A09D', 'A09E', 'A09F',
  'A10A', 'A10B', 'A10C', 'A10D', 'A10E', 'A10F',
  'A11A', 'A11B', 'A11C', 'A11D', 'A11E',
  'A12A', 'A12B', 'A12C', 'A12D', 'A12E',
  'A13A', 'A13B', 'A13C', 'A13D', 'A13E', 'A13F', 'A13G',
  'A14A', 'A15A',
  'A16A', 'A16B', 'A16C', 'A16D', 'A16E', 'A16F',
  'A17A', 'A17B',
  'A18A', 'A19A',
  'A20A', 'A20B',
];

function parseLabel(label) {
  const m = label.match(/^([A-Z]+)(\d+)([A-Z]+)$/i);
  if (!m) return { section: null, rack: null, position: label };
  return { section: m[1], rack: m[2], position: m[3] };
}

async function countDependencies(warehouseId) {
  const [locs, stock, movesA, movesB, movesC, printers, batchItems, invs] = await Promise.all([
    prisma.warehouseLocation.count({ where: { warehouse_id: warehouseId } }),
    prisma.stock.count({ where: { location: { warehouse_id: warehouseId } } }),
    prisma.inventoryMovement.count({ where: { warehouse_id: warehouseId } }),
    prisma.inventoryMovement.count({ where: { from_location: { warehouse_id: warehouseId } } }),
    prisma.inventoryMovement.count({ where: { to_location: { warehouse_id: warehouseId } } }),
    prisma.printer.count({ where: { location: { warehouse_id: warehouseId } } }).catch(() => 0),
    prisma.batchItem.count({ where: { from_location: { warehouse_id: warehouseId } } }).catch(() => 0),
    prisma.inventory.count({ where: { warehouse_id: warehouseId } }).catch(() => 0),
  ]);
  return {
    locations: locs, stockRows: stock, movements: movesA + movesB + movesC,
    printers, batchItems, inventories: invs,
    hasData: locs + stock + movesA + movesB + movesC + printers + batchItems + invs > 0,
  };
}

async function wipeWarehouse(warehouseId) {
  console.log(`   MAŽU warehouse_id=${warehouseId} …`);

  // 1. batch_items (FK na warehouse_locations)
  const bi = await prisma.batchItem.deleteMany({
    where: { from_location: { warehouse_id: warehouseId } },
  }).catch(() => ({ count: 0 }));
  console.log(`      batch_items:         ${bi.count}`);

  // 2. stock
  const st = await prisma.stock.deleteMany({
    where: { location: { warehouse_id: warehouseId } },
  });
  console.log(`      stock:               ${st.count}`);

  // 3. serial_numbers
  const sn = await prisma.serialNumber.deleteMany({
    where: { location: { warehouse_id: warehouseId } },
  }).catch(() => ({ count: 0 }));
  console.log(`      serial_numbers:      ${sn.count}`);

  // 4. inventory_movements
  const mv = await prisma.inventoryMovement.deleteMany({
    where: {
      OR: [
        { warehouse_id: warehouseId },
        { location: { warehouse_id: warehouseId } },
        { from_location: { warehouse_id: warehouseId } },
        { to_location: { warehouse_id: warehouseId } },
      ],
    },
  });
  console.log(`      inventory_movements: ${mv.count}`);

  // 5. inventory_items — nejdřív podle location, pak podle inventory
  const iiLoc = await prisma.inventoryItem.deleteMany({
    where: { location: { warehouse_id: warehouseId } },
  }).catch(() => ({ count: 0 }));
  const iiInv = await prisma.inventoryItem.deleteMany({
    where: { inventory: { warehouse_id: warehouseId } },
  }).catch(() => ({ count: 0 }));
  console.log(`      inventory_items:     ${iiLoc.count + iiInv.count}`);

  // 6. inventories (po smazání items)
  const inv = await prisma.inventory.deleteMany({
    where: { warehouse_id: warehouseId },
  }).catch(() => ({ count: 0 }));
  console.log(`      inventories:         ${inv.count}`);

  // 7. stock_rules
  const sr = await prisma.stockRule.deleteMany({
    where: { warehouse_id: warehouseId },
  }).catch(() => ({ count: 0 }));
  console.log(`      stock_rules:         ${sr.count}`);

  // 8. warehouse_documents
  const wd = await prisma.warehouseDocument.deleteMany({
    where: { warehouse_id: warehouseId },
  }).catch(() => ({ count: 0 }));
  console.log(`      warehouse_documents: ${wd.count}`);

  // 9. batches
  const ba = await prisma.batch.deleteMany({
    where: { warehouse_id: warehouseId },
  }).catch(() => ({ count: 0 }));
  console.log(`      batches:             ${ba.count}`);

  // 10. Uncouple pracoviště
  const wInLoc = await prisma.workstation.updateMany({
    where: { input_location: { warehouse_id: warehouseId } },
    data: { input_location_id: null },
  }).catch(() => ({ count: 0 }));
  const wOutLoc = await prisma.workstation.updateMany({
    where: { output_location: { warehouse_id: warehouseId } },
    data: { output_location_id: null },
  }).catch(() => ({ count: 0 }));
  const wInWh = await prisma.workstation.updateMany({
    where: { input_warehouse_id: warehouseId },
    data: { input_warehouse_id: null },
  }).catch(() => ({ count: 0 }));
  const wOutWh = await prisma.workstation.updateMany({
    where: { output_warehouse_id: warehouseId },
    data: { output_warehouse_id: null },
  }).catch(() => ({ count: 0 }));
  console.log(`      workstations:        loc(${wInLoc.count}/${wOutLoc.count}) wh(${wInWh.count}/${wOutWh.count})`);

  // 11. Uncouple tiskárny
  const pr = await prisma.printer.updateMany({
    where: { location: { warehouse_id: warehouseId } },
    data: { location_id: null },
  }).catch(() => ({ count: 0 }));
  console.log(`      printers odpojeno:   ${pr.count}`);

  // 12. warehouse_locations
  const loc = await prisma.warehouseLocation.deleteMany({
    where: { warehouse_id: warehouseId },
  });
  console.log(`      warehouse_locations: ${loc.count}`);

  // 13. warehouse
  await prisma.warehouse.delete({ where: { id: warehouseId } });
  console.log(`      warehouse id=${warehouseId}: smazán`);
}

async function setSequence(table) {
  await prisma.$executeRawUnsafe(
    `SELECT setval('${table}_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`,
  );
}

async function main() {
  const line = '='.repeat(72);
  console.log(line);
  console.log('HolyOS — Migrace skladu z Factorify (natvrdo ID)');
  if (WIPE_VRTACKA) console.log('!! Režim: --wipe-vrtacka (destruktivní)');
  console.log(line);

  console.log('\n[1/4] Sklad vrtačka → id=7');
  const vrtackas = await prisma.warehouse.findMany({
    where: {
      OR: [
        { name: { contains: 'vrtačka', mode: 'insensitive' } },
        { name: { contains: 'vrtacka', mode: 'insensitive' } },
      ],
    },
  });

  if (vrtackas.length === 0) {
    console.log('   (žádná vrtačka)');
  } else if (vrtackas.length > 1) {
    console.log(`   Více vrtaček (${vrtackas.length}). Stop.`);
    process.exit(1);
  } else {
    const current = vrtackas[0];
    console.log(`   nalezen id=${current.id} "${current.name}"`);

    if (current.id === VRTACKA_WH.id) {
      await prisma.warehouse.update({
        where: { id: current.id },
        data: { name: VRTACKA_WH.name, code: VRTACKA_WH.code },
      });
      console.log(`   OK, už na id=${VRTACKA_WH.id}`);
    } else {
      const deps = await countDependencies(current.id);
      console.log(`   závislosti: pozice=${deps.locations}, stock=${deps.stockRows}, pohyby=${deps.movements}, tiskárny=${deps.printers}, batchItems=${deps.batchItems}, inventury=${deps.inventories}`);

      if (deps.hasData && !WIPE_VRTACKA) {
        console.log('   Pusť s --wipe-vrtacka');
        process.exit(1);
      }

      if (deps.hasData) await wipeWarehouse(current.id);
      else await prisma.warehouse.delete({ where: { id: current.id } });

      await prisma.warehouse.create({
        data: {
          id: VRTACKA_WH.id, name: VRTACKA_WH.name, code: VRTACKA_WH.code,
          type: VRTACKA_WH.type, active: true,
        },
      });
      console.log(`   OK Vrtačka na id=${VRTACKA_WH.id}`);
    }
  }

  console.log('\n[2/4] SKLAD - A - RK → id=1');
  const wh1 = await prisma.warehouse.findUnique({ where: { id: RK_WH.id } });
  if (wh1) {
    if (wh1.name === RK_WH.name) {
      console.log(`   už existuje`);
    } else {
      const deps = await countDependencies(wh1.id);
      if (deps.hasData && !WIPE_VRTACKA) {
        console.log(`   id=1 drží "${wh1.name}" s daty. Stop.`);
        process.exit(1);
      }
      if (deps.hasData) await wipeWarehouse(wh1.id);
      else await prisma.warehouse.delete({ where: { id: wh1.id } });
      await prisma.warehouse.create({
        data: { id: RK_WH.id, name: RK_WH.name, code: RK_WH.code, type: RK_WH.type, active: true },
      });
    }
  } else {
    await prisma.warehouse.create({
      data: { id: RK_WH.id, name: RK_WH.name, code: RK_WH.code, type: RK_WH.type, active: true },
    });
    console.log(`   OK vytvořen id=${RK_WH.id}`);
  }

  console.log(`\n[3/4] Pozice (${RK_POSITIONS.length})`);
  let created = 0, updated = 0, skipped = 0;
  for (const label of RK_POSITIONS) {
    const { section, rack, position } = parseLabel(label);
    const barcode = `sto-${RK_WH.id}-${label}`;
    const byLabel = await prisma.warehouseLocation.findUnique({ where: { label } });
    if (byLabel && byLabel.warehouse_id !== RK_WH.id) {
      console.log(`   ${label}: jinde, přeskočeno`);
      skipped++;
      continue;
    }
    if (byLabel) {
      await prisma.warehouseLocation.update({
        where: { id: byLabel.id },
        data: { barcode, section, rack, position, type: 'position' },
      });
      updated++;
    } else {
      await prisma.warehouseLocation.create({
        data: { warehouse_id: RK_WH.id, label, barcode, section, rack, position, type: 'position' },
      });
      created++;
    }
  }
  console.log(`   vytvořeno=${created}, aktualizováno=${updated}, přeskočeno=${skipped}`);

  console.log('\n[4/4] Sequences');
  try {
    await setSequence('warehouses');
    await setSequence('warehouse_locations');
    console.log('   OK');
  } catch (e) {
    console.log(`   !! ${e.message}`);
  }

  console.log('\n' + line);
  console.log('HOTOVO');
  console.log(line);
  console.log(`\n  id=1  SKLAD - A - RK  (${RK_POSITIONS.length} pozic)`);
  console.log(`  id=7  Sklad Vrtačka   (prázdný)\n`);
}

main()
  .catch((e) => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
