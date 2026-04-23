// HolyOS — Test Sklad 2.0 | Documents + Batches
//
// Scénář:
//  A. Documents: 3 vytvoření (2× receipt_doc, 1× issue_doc) → kontrola number řady
//     → complete prvního dokumentu → cancel druhého
//  B. Batches: vytvoří dávku s 3 items, picknu je postupně:
//     → item #1 plně (picked), item #2 částečně (short), item #3 nulou (skipped)
//     → po 3. picku by měl batch auto-přejít na 'done'
//
// Idempotence: skript lze pouštět opakovaně. Na začátku resetuje TEST data.

const { PrismaClient } = require('@prisma/client');
const { createDocument, completeDocument, cancelDocument } = require('../services/warehouse/documents.service');
const { createBatch, pickBatchItem } = require('../services/warehouse/batches.service');
const { createMove } = require('../services/warehouse/moves.service');

const prisma = new PrismaClient();

const TEST_BARCODE = 'TEST-SKLAD2-MAT-001';
const TEST_NOTE_PREFIX = 'TEST-SKLAD2';
const UUID = {
  seed_receipt: '00000000-0000-4000-8000-000000000010',
  pick1: '00000000-0000-4000-8000-000000000020',
  pick2: '00000000-0000-4000-8000-000000000021',
  pick3: '00000000-0000-4000-8000-000000000022',
};

function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'} — ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function reset(material_id) {
  // 1. Smaž TEST batches (podle note prefixu) — cascade smaže batch_items
  await prisma.batch.deleteMany({ where: { note: { startsWith: TEST_NOTE_PREFIX } } });
  // 2. Smaž TEST dokumenty (podle reference prefixu)
  await prisma.warehouseDocument.deleteMany({ where: { reference: { startsWith: TEST_NOTE_PREFIX } } });
  // 3. Smaž pohyby pro TEST materiál
  await prisma.inventoryMovement.deleteMany({ where: { material_id } });
  // 4. Smaž stock řádky pro TEST materiál
  await prisma.stock.deleteMany({ where: { material_id } });
  // 5. Reset current_stock
  await prisma.material.update({ where: { id: material_id }, data: { current_stock: 0 } });
}

async function main() {
  console.log('='.repeat(70));
  console.log('Test Sklad 2.0 — documents + batches');
  console.log('='.repeat(70));

  // Materiál a sklad z předchozího testu
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
  console.log(`Material: id=${material.id}  Sklad: id=${warehouse.id}  Lokace A: ${locA.id}  Lokace B: ${locB.id}`);

  await reset(material.id);
  console.log('Reset: TEST data smazána.');

  // Seed: 200 ks na lokaci A (abychom měli z čeho pickovat)
  await createMove({
    client_uuid: UUID.seed_receipt,
    type: 'receipt',
    material_id: material.id,
    warehouse_id: warehouse.id,
    to_location_id: locA.id,
    quantity: 200,
  });

  // =========================================================================
  // A. DOCUMENTS
  // =========================================================================
  console.log('\n[A] Documents');

  const d1 = await createDocument({ type: 'receipt_doc', reference: `${TEST_NOTE_PREFIX}-doc-1`, note: 'první příjemka' });
  ok(/^PR-\d{4}-\d{5}$/.test(d1.number), `d1 number má tvar PR-YYYY-NNNNN (${d1.number})`);
  ok(d1.status === 'draft', `d1 status = draft`);

  const d2 = await createDocument({ type: 'issue_doc', reference: `${TEST_NOTE_PREFIX}-doc-2`, note: 'výdejka' });
  ok(/^VY-\d{4}-\d{5}$/.test(d2.number), `d2 number má tvar VY-YYYY-NNNNN (${d2.number})`);

  const d3 = await createDocument({ type: 'receipt_doc', reference: `${TEST_NOTE_PREFIX}-doc-3`, note: 'druhá příjemka' });
  const seq1 = Number(d1.number.split('-')[2]);
  const seq3 = Number(d3.number.split('-')[2]);
  ok(seq3 === seq1 + 1, `d3 má další sekvenci po d1 (${d1.number} → ${d3.number})`);

  // complete d1
  const d1done = await completeDocument(d1.id);
  ok(d1done.status === 'completed' && d1done.completed_at, 'd1 po completeDocument má status completed + completed_at');

  // cancel d2
  const d2cancelled = await cancelDocument(d2.id);
  ok(d2cancelled.status === 'cancelled', 'd2 po cancelDocument má status cancelled');

  // complete cancelled → error
  let cancelError = null;
  try { await completeDocument(d2.id); } catch (e) { cancelError = e; }
  ok(cancelError && cancelError.message.includes('zrušen'), 'complete zrušeného → chyba "zrušen"');

  // =========================================================================
  // B. BATCHES
  // =========================================================================
  console.log('\n[B] Batches');

  const batch = await createBatch({
    sector: 'eshop',
    note: `${TEST_NOTE_PREFIX}-batch-1`,
    items: [
      { material_id: material.id, quantity: 50, from_location_id: locA.id, sort_order: 0 },
      { material_id: material.id, quantity: 40, from_location_id: locA.id, sort_order: 1 },
      { material_id: material.id, quantity: 10, from_location_id: locA.id, sort_order: 2 },
    ],
  });
  ok(/^BAT-\d{4}-\d{4}$/.test(batch.number), `batch number má tvar BAT-YYYY-NNNN (${batch.number})`);
  ok(batch.status === 'open', `batch status = open`);
  ok(batch.items.length === 3, `batch má 3 položky`);
  ok(batch.items.every(i => i.status === 'pending'), `všechny položky jsou pending`);

  // Pick #1 — plně (50 ks)
  console.log('  Pick #1 — 50/50 ks');
  const p1 = await pickBatchItem({
    batch_id: batch.id,
    batch_item_id: batch.items[0].id,
    picked_quantity: 50,
    client_uuid: UUID.pick1,
  });
  ok(p1.item.status === 'picked', `item #1 status = picked`);
  ok(p1.move_id !== null, `item #1 vytvořil pohyb`);

  const batchAfter1 = await prisma.batch.findUnique({ where: { id: batch.id } });
  ok(batchAfter1.status === 'picking', `batch po prvním picku = picking`);

  // Pick #2 — částečně (30/40)
  console.log('  Pick #2 — 30/40 ks (short)');
  const p2 = await pickBatchItem({
    batch_id: batch.id,
    batch_item_id: batch.items[1].id,
    picked_quantity: 30,
    client_uuid: UUID.pick2,
  });
  ok(p2.item.status === 'short', `item #2 status = short (30 < 40)`);

  // Pick #3 — nula (skipped)
  console.log('  Pick #3 — 0/10 ks (skipped)');
  const p3 = await pickBatchItem({
    batch_id: batch.id,
    batch_item_id: batch.items[2].id,
    picked_quantity: 0,
    client_uuid: UUID.pick3,
  });
  ok(p3.item.status === 'skipped', `item #3 status = skipped`);
  ok(p3.auto_completed === true, `batch auto-completed po posledním picku`);
  ok(p3.move_id === null, `item #3 nevytvořil pohyb (0 ks)`);

  const batchFinal = await prisma.batch.findUnique({ where: { id: batch.id } });
  ok(batchFinal.status === 'done' && batchFinal.completed_at, `batch status = done + completed_at`);

  // Stock A: 200 - 50 - 30 - 0 = 120
  const stockA = await prisma.stock.findFirst({
    where: { material_id: material.id, location_id: locA.id, lot_id: null },
  });
  ok(Number(stockA.quantity) === 120, `Stock A = 120 (je ${stockA.quantity})`);

  // Material.current_stock: 200 - 50 - 30 = 120
  const mat = await prisma.material.findUnique({ where: { id: material.id } });
  ok(Number(mat.current_stock) === 120, `current_stock = 120 (je ${mat.current_stock})`);

  // Pick idempotence — zopakuj pick #1 se stejným client_uuid → dedup
  console.log('  Pick #1 resend (stejný client_uuid)');
  // Batch je už v 'done', takže pick bude odmítnut. To je správně — test reassertu.
  let doneError = null;
  try {
    await pickBatchItem({
      batch_id: batch.id, batch_item_id: batch.items[0].id,
      picked_quantity: 50, client_uuid: UUID.pick1,
    });
  } catch (e) { doneError = e; }
  ok(doneError && doneError.message.includes('done'), 'pick po uzavření dávky → chyba "done"');

  console.log('\n' + '='.repeat(70));
  console.log(process.exitCode ? 'NĚKTERÉ TESTY SELHALY.' : 'Všechny kontroly prošly.');
  console.log('='.repeat(70));
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
