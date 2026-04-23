// HolyOS — JSON záloha skladových tabulek před migrací Sklad 2.0.
// Nenahrazuje pg_dump pro celou DB, ale chrání nás přesně pro tuhle migraci:
// zachytí stav tabulek, kterých se migrace dotýká.
//
// Spuštění: node scripts/backup-sklad2.js

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `sklad2-pre-migration-${ts}.json`);

  console.log('Zálohuji skladové tabulky...');

  const data = {
    meta: {
      created_at: new Date().toISOString(),
      purpose: 'Pre-migration backup for sklad-2-pwa-tisk',
      schema_version: 'pre-sklad-2',
    },
    warehouses:          await prisma.warehouse.findMany(),
    warehouse_locations: await prisma.warehouseLocation.findMany(),
    materials:           await prisma.material.findMany(),
    stock_rules:         await prisma.stockRule.findMany(),
    inventories:         await prisma.inventory.findMany(),
    inventory_items:     await prisma.inventoryItem.findMany(),
    inventory_movements: await prisma.inventoryMovement.findMany(),
  };

  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));

  const size = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log('\nZáloha vytvořena:');
  console.log(`  Soubor:  ${outFile}`);
  console.log(`  Velikost: ${size} KB`);
  console.log('\nPočty řádků:');
  for (const [k, v] of Object.entries(data)) {
    if (k === 'meta') continue;
    console.log(`  ${k.padEnd(22)} ${Array.isArray(v) ? v.length : '?'}`);
  }
  console.log('\nHotovo. Pokud by migrace selhala, zálohu pošli Coworku —');
  console.log('obnovení půjde přes script/restore-sklad2.js (napíšu, kdyby bylo potřeba).');
}

main()
  .catch(e => {
    console.error('\nCHYBA při záloze:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
