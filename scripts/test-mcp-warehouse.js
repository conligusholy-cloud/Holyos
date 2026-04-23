// HolyOS — Test MCP warehouse tools (Sklad 2.0 rozšíření)
//
// Volá přímo exekutor `executeWarehouseTool` tak, jak to dělá in-process orchestrator.
// Tisk (print_label) je v testu vynechán — zkus ho v AI chatu nebo scripts/test-print.js.
//
// Spuštění: node scripts/test-mcp-warehouse.js

const { PrismaClient } = require('@prisma/client');
const { getWarehouseTools, executeWarehouseTool } = require('../mcp-servers/warehouse-server');
const crypto = require('crypto');

const prisma = new PrismaClient();
let stats = { passed: 0, failed: 0 };

function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'} — ${msg}`);
  if (cond) stats.passed++; else stats.failed++;
}

function jsonPreview(obj, max = 300) {
  const s = JSON.stringify(obj);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

async function main() {
  console.log('='.repeat(70));
  console.log('MCP warehouse tools — Sklad 2.0');
  console.log('='.repeat(70));

  // 1. Enumerace toolů
  const tools = getWarehouseTools();
  console.log(`\n[Enum] Celkem ${tools.length} tools:`);
  for (const t of tools) console.log(`  • ${t.name.padEnd(24)} — ${t.description.split('.')[0]}`);

  const NEW_TOOLS = ['search_materials', 'lookup_material_by_qr', 'lookup_location_by_qr',
                     'create_move', 'list_batches', 'list_documents', 'print_label'];
  for (const name of NEW_TOOLS) {
    ok(tools.some(t => t.name === name), `tool ${name} je registrovaný`);
  }

  // 2. search_materials
  console.log('\n[search_materials]');
  {
    const r = await executeWarehouseTool('search_materials', { query: 'TEST-SKLAD2' }, prisma);
    ok(r.count >= 1, `našel TEST materiál (count=${r.count})`);
    ok(r.materials.some(m => m.barcode === 'TEST-SKLAD2-MAT-001'), `obsahuje náš barcode`);
  }
  {
    const r = await executeWarehouseTool('search_materials', { query: 'NEEXISTUJE-NIKDE-XYZ' }, prisma);
    ok(r.count === 0, `neexistující query → 0 výsledků`);
  }

  // 3. lookup_material_by_qr
  console.log('\n[lookup_material_by_qr]');
  {
    const r = await executeWarehouseTool('lookup_material_by_qr', { qr_code: 'TEST-SKLAD2-MAT-001' }, prisma);
    ok(r.found === true, `found=true`);
    ok(r.material.barcode === 'TEST-SKLAD2-MAT-001', `vrácený material má správný barcode`);
    ok(Array.isArray(r.stock_by_location), `obsahuje stock_by_location`);
    ok(Array.isArray(r.last_movements), `obsahuje last_movements`);
  }
  {
    const r = await executeWarehouseTool('lookup_material_by_qr', { qr_code: 'NEEXISTUJE' }, prisma);
    ok(r.found === false, `nenalezený → found=false`);
  }

  // 4. lookup_location_by_qr
  console.log('\n[lookup_location_by_qr]');
  // V DB nemusí být žádná lokace s barcode — ověříme aspoň negativní případ
  {
    const r = await executeWarehouseTool('lookup_location_by_qr', { qr_code: 'UNKNOWN-LOC' }, prisma);
    ok(r.found === false, `neznámý QR → found=false`);
  }
  // Pozitivní případ: nastavíme jedné lokaci barcode a zkusíme lookup
  const loc = await prisma.warehouseLocation.findFirst({ where: { warehouse_id: 1 }, orderBy: { id: 'asc' } });
  const testLocBarcode = `LOC-TEST-${loc.id}`;
  await prisma.warehouseLocation.update({ where: { id: loc.id }, data: { barcode: testLocBarcode } });
  {
    const r = await executeWarehouseTool('lookup_location_by_qr', { qr_code: testLocBarcode }, prisma);
    ok(r.found === true, `známá lokace → found=true`);
    ok(r.location.id === loc.id, `vrácená lokace id shodný`);
    ok(Array.isArray(r.materials), `obsahuje seznam materiálů`);
  }

  // 5. create_move
  console.log('\n[create_move]');
  const material = await prisma.material.findUnique({ where: { barcode: 'TEST-SKLAD2-MAT-001' } });
  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  const [locA] = await prisma.warehouseLocation.findMany({ where: { warehouse_id: warehouse.id }, take: 1, orderBy: { id: 'asc' } });

  const clientUuid = crypto.randomUUID();
  {
    const r = await executeWarehouseTool('create_move', {
      type: 'receipt',
      material_id: material.id,
      warehouse_id: warehouse.id,
      to_location_id: locA.id,
      quantity: 10,
      client_uuid: clientUuid,
      note: 'MCP test receipt',
    }, prisma);
    ok(r.move_id && r.type === 'receipt', `receipt přes MCP OK, move_id=${r.move_id}`);
    ok(r.deduped === false, `první call → deduped=false`);
    ok(Number(r.quantity) === 10, `quantity = 10`);
  }
  // Resend stejné UUID → dedup
  {
    const r = await executeWarehouseTool('create_move', {
      type: 'receipt',
      material_id: material.id,
      warehouse_id: warehouse.id,
      to_location_id: locA.id,
      quantity: 10,
      client_uuid: clientUuid,
    }, prisma);
    ok(r.deduped === true, `resend stejné UUID → deduped=true`);
  }

  // 6. list_batches
  console.log('\n[list_batches]');
  {
    const r = await executeWarehouseTool('list_batches', { limit: 5 }, prisma);
    ok(typeof r.count === 'number', `count je číslo (${r.count})`);
    ok(Array.isArray(r.batches), `batches je pole`);
    console.log(`  Preview: ${jsonPreview(r.batches.slice(0, 2))}`);
  }

  // 7. list_documents
  console.log('\n[list_documents]');
  {
    const r = await executeWarehouseTool('list_documents', { limit: 5 }, prisma);
    ok(typeof r.count === 'number', `count je číslo (${r.count})`);
    ok(Array.isArray(r.documents), `documents je pole`);
    console.log(`  Preview: ${jsonPreview(r.documents.slice(0, 2))}`);
  }

  // print_label vynecháváme — tiskne fyzicky a už jsme ho otestovali přes scripts/test-print.js

  // Cleanup: vrátit původní barcode lokace (byl null)
  await prisma.warehouseLocation.update({ where: { id: loc.id }, data: { barcode: null } });

  console.log('\n' + '='.repeat(70));
  console.log(`Passed: ${stats.passed}  Failed: ${stats.failed}`);
  console.log('='.repeat(70));
  if (stats.failed > 0) process.exit(1);
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
