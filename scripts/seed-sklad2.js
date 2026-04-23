// HolyOS — Sklad 2.0 | Seed default ZPL šablon + tiskáren z Factorify
// + smoke test nové struktury.
//
// Idempotentní: lze pouštět opakovaně, upsert nic nerozbije.
// Spuštění: node scripts/seed-sklad2.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// 3 default ZPL šablony etiket
// ---------------------------------------------------------------------------
const LABEL_TEMPLATES = [
  {
    code: 'item_label',
    name: 'Etiketa položky (QR + název + SKU)',
    language: 'ZPL',
    width_mm: 60,
    height_mm: 20,
    body: [
      '^XA',
      '^FO20,20^BQN,2,3^FDMA,{{barcode}}^FS',
      '^FO160,25^ADN,18,10^FD{{name}}^FS',
      '^FO160,65^ADN,12,6^FDSKU: {{code}}^FS',
      '^FO160,95^ADN,12,6^FD{{unit}}^FS',
      '^XZ',
    ].join('\n'),
    description: 'Standardní etiketa pro materiál: QR kód vlevo, název + SKU + jednotka vpravo.',
    is_active: true,
  },
  {
    code: 'location_label',
    name: 'Etiketa lokace (QR + kód + sklad)',
    language: 'ZPL',
    width_mm: 60,
    height_mm: 20,
    body: [
      '^XA',
      '^FO20,20^BQN,2,3^FDMA,{{barcode}}^FS',
      '^FO160,25^ADN,24,14^FD{{label}}^FS',
      '^FO160,70^ADN,12,6^FD{{warehouse_name}}^FS',
      '^XZ',
    ].join('\n'),
    description: 'Etiketa pro regál/pozici: QR kód vlevo, label + název skladu vpravo.',
    is_active: true,
  },
  {
    code: 'document_summary',
    name: 'Souhrn skladového dokumentu',
    language: 'ZPL',
    width_mm: 60,
    height_mm: 20,
    body: [
      '^XA',
      '^FO20,15^ADN,16,8^FD{{type_label}}^FS',
      '^FO20,45^ADN,24,12^FD{{number}}^FS',
      '^FO20,85^ADN,12,6^FDPartner: {{partner_name}}^FS',
      '^FO20,115^ADN,12,6^FDDatum: {{date}}^FS',
      '^XZ',
    ].join('\n'),
    description: 'Hlavička dodacího listu / výdejky — typ, číslo, partner, datum.',
    is_active: true,
  },
];

// ---------------------------------------------------------------------------
// 2 tiskárny TSC TC200 (přeneseno z Factorify 1:1)
// ---------------------------------------------------------------------------
const PRINTERS = [
  {
    name: 'Tiskárna Rychnov',
    model: 'TSC_TC200',
    connection_type: 'lan',
    ip_address: '90.183.16.242',
    port: 55985,
    language: 'ZPL',
    label_width_mm: 60,
    label_height_mm: 20,
    dpi: 203,
    priority: 100,
    is_active: true,
    encoding: 'UTF-8',
  },
  {
    name: 'Tiskárna RK CNC',
    model: 'TSC_TC200',
    connection_type: 'lan',
    ip_address: '90.183.16.242',
    port: 55986,
    language: 'ZPL',
    label_width_mm: 60,
    label_height_mm: 20,
    dpi: 203,
    priority: 90,
    is_active: true,
    encoding: 'UTF-8',
  },
];

async function main() {
  console.log('='.repeat(70));
  console.log('HolyOS — Sklad 2.0 | Seed + smoke test');
  console.log('='.repeat(70));

  // -------------------------------------------------------------------------
  // Seed label_templates (upsert podle code)
  // -------------------------------------------------------------------------
  console.log('\n[1/3] Label templates');
  for (const t of LABEL_TEMPLATES) {
    const r = await prisma.labelTemplate.upsert({
      where: { code: t.code },
      update: t,
      create: t,
    });
    console.log(`   ${r.code.padEnd(20)} id=${r.id}`);
  }

  // -------------------------------------------------------------------------
  // Seed printers (upsert podle name — name není unique v DB, tak to ručně)
  // -------------------------------------------------------------------------
  console.log('\n[2/3] Printers');
  for (const p of PRINTERS) {
    const existing = await prisma.printer.findFirst({ where: { name: p.name } });
    if (existing) {
      const r = await prisma.printer.update({ where: { id: existing.id }, data: p });
      console.log(`   ${r.name.padEnd(22)} id=${r.id}  (aktualizováno)`);
    } else {
      const r = await prisma.printer.create({ data: p });
      console.log(`   ${r.name.padEnd(22)} id=${r.id}  (nově vytvořeno)`);
    }
  }

  // -------------------------------------------------------------------------
  // Smoke test — ověř, že všechny nové modely fungují přes Prisma klient
  // -------------------------------------------------------------------------
  console.log('\n[3/3] Smoke test nové struktury');
  const checks = [
    ['stock',              () => prisma.stock.count()],
    ['warehouse_documents',() => prisma.warehouseDocument.count()],
    ['batches',            () => prisma.batch.count()],
    ['batch_items',        () => prisma.batchItem.count()],
    ['printers',           () => prisma.printer.count()],
    ['label_templates',    () => prisma.labelTemplate.count()],
    ['print_jobs',         () => prisma.printJob.count()],
  ];
  for (const [name, fn] of checks) {
    try {
      const n = await fn();
      console.log(`   ${name.padEnd(22)} ${String(n).padStart(4)} řádků  OK`);
    } catch (e) {
      console.log(`   ${name.padEnd(22)} CHYBA: ${e.message}`);
    }
  }

  // Ověř, že nové sloupce na inventory_movements se čtou
  try {
    const probe = await prisma.inventoryMovement.findMany({
      take: 1,
      select: {
        id: true,
        client_uuid: true,
        device_id: true,
        document_id: true,
        from_location_id: true,
        to_location_id: true,
      },
    });
    console.log(`   inventory_movements    nové sloupce čitelné  OK  (vzorek: ${probe.length} řádků)`);
  } catch (e) {
    console.log(`   inventory_movements    CHYBA: ${e.message}`);
  }

  // Ověř, že materials.sector a warehouse_locations.type jsou tam
  const matSample = await prisma.material.findFirst({ select: { id: true, sector: true, barcode: true } });
  const locSample = await prisma.warehouseLocation.findFirst({ select: { id: true, type: true, locked_for_inventory: true } });
  console.log(`   materials.sector       čtení OK  (vzorek material_id=${matSample?.id}, sector=${matSample?.sector ?? 'NULL'})`);
  console.log(`   warehouse_locations.type čtení OK (vzorek location_id=${locSample?.id}, type='${locSample?.type}', locked=${locSample?.locked_for_inventory})`);

  console.log('\n' + '='.repeat(70));
  console.log('HOTOVO — Fáze 1 (schéma + seed) je kompletní.');
  console.log('='.repeat(70));
  console.log('\nDalší krok:');
  console.log('  • přiřadit tiskárnám location_id přes HolyOS web (až bude UI)');
  console.log('  • spustit Fázi 2: implementace routes/warehouse-v2.routes.js + ZPL driver');
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
