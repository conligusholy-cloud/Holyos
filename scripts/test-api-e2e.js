// HolyOS — Sklad 2.0 | End-to-end test REST API přes HTTP
//
// Ověřuje, že:
//   - routes jsou mountnuté (print + warehouse v2)
//   - requireAuth middleware funguje (JWT)
//   - Zod validace vrací správné stavové kódy
//   - resolvePersonIdForUser správně mapuje User → Person
//   - transakce skrze HTTP fungují stejně jako přes service vrstvu
//
// PŘEDPOKLAD: server běží na localhost (PORT z .env, default 3000)
// Spuštění: node scripts/test-api-e2e.js
//
// Tisk v tomto testu je SUPPRESSED (withTestLabel=false) — netiskne papír.

const { PrismaClient } = require('@prisma/client');
const { generateToken } = require('../middleware/auth');
const crypto = require('crypto');

const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

let token = null;
let stats = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    console.log(`  OK — ${msg}`);
    stats.passed++;
  } else {
    console.log(`  FAIL — ${msg}`);
    stats.failed++;
  }
}

async function req(method, path, body = null, extraHeaders = {}) {
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders };
  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try { data = await res.json(); } catch {}
  }
  return { status: res.status, data };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Sklad 2.0 — E2E API test přes HTTP');
  console.log(`Server: ${BASE}`);
  console.log('='.repeat(70));

  // 0. Server dostupný?
  try {
    await fetch(`${BASE}/api/print/printers`, { method: 'HEAD' });
  } catch (e) {
    console.error(`\nServer na ${BASE} neodpovídá. Spusť nejdřív: npm run dev`);
    process.exit(1);
  }

  // 1. Získej JWT tokena admin usera přes generateToken helper
  const user = await prisma.user.findFirst({
    where: { OR: [{ role: 'admin' }, { is_super_admin: true }] },
  });
  if (!user) {
    console.error('V DB není žádný admin user.');
    process.exit(1);
  }
  token = generateToken(user);
  console.log(`\nAuth: User "${user.username}" (id=${user.id}), token vygenerován`);

  // 2. Připrav TEST materiál + resetuj
  const material = await prisma.material.upsert({
    where: { barcode: 'TEST-SKLAD2-MAT-001' },
    update: {},
    create: {
      code: 'TEST-SKLAD2-001', name: 'TEST materiál sklad 2.0',
      barcode: 'TEST-SKLAD2-MAT-001', unit: 'ks', sector: 'vyroba', status: 'active',
    },
  });
  const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
  const [locA, locB] = await prisma.warehouseLocation.findMany({
    where: { warehouse_id: warehouse.id }, orderBy: { id: 'asc' }, take: 2,
  });
  await prisma.inventoryMovement.deleteMany({ where: { material_id: material.id } });
  await prisma.stock.deleteMany({ where: { material_id: material.id } });
  await prisma.material.update({ where: { id: material.id }, data: { current_stock: 0 } });
  await prisma.batch.deleteMany({ where: { note: { startsWith: 'E2E-TEST' } } });
  await prisma.warehouseDocument.deleteMany({ where: { reference: { startsWith: 'E2E-TEST' } } });
  console.log(`Test kontext: mat=${material.id}, wh=${warehouse.id}, locA=${locA.id}, locB=${locB.id}`);

  // =========================================================================
  // PRINT SUBSYSTEM
  // =========================================================================
  console.log('\n[PRINT]');

  // 3. GET /api/print/printers
  {
    const r = await req('GET', '/api/print/printers');
    ok(r.status === 200, `GET /api/print/printers → 200 (je ${r.status})`);
    ok(Array.isArray(r.data) && r.data.length >= 2, `vrací ≥ 2 tiskárny (je ${r.data?.length})`);
  }

  // 4. GET /api/print/printers/1
  {
    const r = await req('GET', '/api/print/printers/1');
    ok(r.status === 200 && r.data.id === 1, `GET /api/print/printers/1 → 200 + id=1`);
    ok(r.data.ip_address === '90.183.16.242', `IP adresa je 90.183.16.242`);
  }

  // 5. POST /api/print/printers/1/test (BEZ fyzického tisku)
  {
    const r = await req('POST', '/api/print/printers/1/test', { withTestLabel: false });
    ok(r.status === 200 && r.data.ping_ok === true, `test-printer ping OK (ping_ok=${r.data?.ping_ok})`);
  }

  // 6. GET /api/print/templates
  {
    const r = await req('GET', '/api/print/templates');
    ok(r.status === 200 && r.data.length >= 3, `GET /api/print/templates → 200 + ≥ 3 šablony`);
    ok(r.data.some(t => t.code === 'item_label'), `šablona item_label existuje`);
    ok(r.data.some(t => Array.isArray(t.placeholders)), `šablony mají pole placeholders`);
  }

  // 7. POST /api/print — zvaliduj, ale s malou etiketou na Rychnov (bude ale tisknout)
  // → pro E2E bez fyzického tisku to přeskočíme, místo toho uděláme validaci:
  // POST bez povinného 'template' → 400
  {
    const r = await req('POST', '/api/print', { data: {} });
    ok(r.status === 400, `POST /api/print bez 'template' → 400 (je ${r.status})`);
  }

  // =========================================================================
  // WAREHOUSE v2 — MOVES
  // =========================================================================
  console.log('\n[MOVES]');

  // 8. POST bez client_uuid — validace spustí jen pokud je invalid UUID
  {
    const r = await req('POST', '/api/wh/moves', {
      type: 'receipt', material_id: material.id, warehouse_id: warehouse.id,
      to_location_id: locA.id, quantity: 100,
      client_uuid: 'NE-VALIDNI-UUID',
    });
    ok(r.status === 400, `POST /api/wh/moves s invalid UUID → 400`);
  }

  // 9. POST receipt 100 ks
  const uuid1 = crypto.randomUUID();
  {
    const r = await req('POST', '/api/wh/moves', {
      type: 'receipt', material_id: material.id, warehouse_id: warehouse.id,
      to_location_id: locA.id, quantity: 100, client_uuid: uuid1,
    });
    ok(r.status === 201, `POST receipt 100 → 201 (je ${r.status})`);
    ok(r.data.type === 'receipt' && Number(r.data.quantity) === 100, `response má správný type + quantity`);
    ok(r.data._deduped === false, `_deduped = false`);
  }

  // 10. POST stejný client_uuid → 200 + _deduped=true
  {
    const r = await req('POST', '/api/wh/moves', {
      type: 'receipt', material_id: material.id, warehouse_id: warehouse.id,
      to_location_id: locA.id, quantity: 100, client_uuid: uuid1,
    });
    ok(r.status === 200, `POST resend stejné UUID → 200 (dedup)`);
    ok(r.data._deduped === true, `_deduped = true`);
  }

  // 11. POST transfer bez from+to → 400
  {
    const r = await req('POST', '/api/wh/moves', {
      type: 'transfer', material_id: material.id, warehouse_id: warehouse.id,
      quantity: 10, client_uuid: crypto.randomUUID(),
    });
    ok(r.status === 400, `POST transfer bez from+to → 400`);
  }

  // 12. GET /api/wh/moves?material_id=...
  {
    const r = await req('GET', `/api/wh/moves?material_id=${material.id}`);
    ok(r.status === 200 && Array.isArray(r.data), `GET /api/wh/moves → 200 + array`);
    ok(r.data.length >= 1, `obsahuje náš receipt`);
  }

  // 13. GET /api/wh/items/by-qr/:qr
  {
    const r = await req('GET', '/api/wh/items/by-qr/TEST-SKLAD2-MAT-001');
    ok(r.status === 200 && r.data.id === material.id, `GET items/by-qr → 200 + correct material`);
    ok(Array.isArray(r.data.stock_by_location), `response má stock_by_location`);
    ok(r.data.stock_by_location.some(s => Number(s.quantity) === 100), `stock má 100 ks na A`);
  }

  // 14. GET /api/wh/items/by-qr neznámý → 404
  {
    const r = await req('GET', '/api/wh/items/by-qr/NEEXISTUJE-XYZ');
    ok(r.status === 404, `GET by-qr neexistuje → 404`);
  }

  // =========================================================================
  // DOCUMENTS
  // =========================================================================
  console.log('\n[DOCUMENTS]');

  let docId = null;
  // 15. POST /api/wh/documents
  {
    const r = await req('POST', '/api/wh/documents', {
      type: 'receipt_doc',
      reference: 'E2E-TEST-' + Date.now(),
      note: 'E2E test dokument',
    });
    ok(r.status === 201, `POST /api/wh/documents → 201`);
    ok(/^PR-\d{4}-\d{5}$/.test(r.data.number), `číslo má tvar PR-YYYY-NNNNN (${r.data?.number})`);
    docId = r.data.id;
  }

  // 16. PATCH /documents/:id/complete
  {
    const r = await req('PATCH', `/api/wh/documents/${docId}/complete`);
    ok(r.status === 200 && r.data.status === 'completed', `PATCH complete → status=completed`);
  }

  // 17. PATCH complete znovu → 200 (vrátí stejný)
  {
    const r = await req('PATCH', `/api/wh/documents/${docId}/complete`);
    ok(r.status === 200 && r.data.status === 'completed', `PATCH complete 2× → idempotent`);
  }

  // =========================================================================
  // BATCHES
  // =========================================================================
  console.log('\n[BATCHES]');

  let batchId = null, firstItemId = null;
  // 18. POST /api/wh/batches
  {
    const r = await req('POST', '/api/wh/batches', {
      sector: 'eshop', note: 'E2E-TEST-batch',
      items: [
        { material_id: material.id, quantity: 20, from_location_id: locA.id, sort_order: 0 },
        { material_id: material.id, quantity: 10, from_location_id: locA.id, sort_order: 1 },
      ],
    });
    ok(r.status === 201, `POST /api/wh/batches → 201`);
    ok(/^BAT-\d{4}-\d{4}$/.test(r.data.number), `batch number ${r.data?.number}`);
    ok(r.data.items.length === 2, `batch má 2 items`);
    batchId = r.data.id;
    firstItemId = r.data.items[0].id;
  }

  // 19. POST /batches/:id/pick
  {
    const r = await req('POST', `/api/wh/batches/${batchId}/pick`, {
      batch_item_id: firstItemId,
      picked_quantity: 20,
      client_uuid: crypto.randomUUID(),
    }, { 'X-Device-Id': 'E2E-TESTER' });
    ok(r.status === 200, `POST /batches/:id/pick → 200`);
    ok(r.data.item.status === 'picked', `item status = picked`);
  }

  // 20. GET /batches/:id
  {
    const r = await req('GET', `/api/wh/batches/${batchId}`);
    ok(r.status === 200 && r.data.status === 'picking', `GET batch detail → status=picking`);
    ok(r.data.items[0].status === 'picked', `item #1 je picked`);

    // Person resolver kontrola — očekávání záleží na tom, jestli má User profil Person
    const person = await prisma.person.findFirst({ where: { user_id: user.id }, select: { id: true } });
    if (person) {
      ok(r.data.items[0].picker && r.data.items[0].picker.id === person.id,
         `picker nastaven a je to správná Person (id=${person.id})`);
    } else {
      ok(r.data.items[0].picker === null,
         `picker = null (user '${user.username}' nemá Person; resolver vrátil null korektně)`);
    }
  }

  // =========================================================================
  // AUTH
  // =========================================================================
  console.log('\n[AUTH]');

  // 21. bez tokenu → 401
  {
    const res = await fetch(`${BASE}/api/print/printers`);
    ok(res.status === 401, `GET bez tokenu → 401 (je ${res.status})`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Passed: ${stats.passed}  Failed: ${stats.failed}`);
  console.log('='.repeat(70));
  if (stats.failed > 0) process.exit(1);
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
