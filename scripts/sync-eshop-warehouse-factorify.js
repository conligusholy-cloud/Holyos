// =============================================================================
// HolyOS — Sync skladu "Eshop" z Factorify (StockItem → HolyOS Warehouse/Stock)
// =============================================================================
// Cíl: srovnat stav zásob a pozice skladu Eshop podle Factorify (snapshot).
//   1) stáhne Factorify StockItem, vyfiltruje řádky skladu "Eshop"
//   2) v HolyOS zajistí sklad Eshop + jeho pozice (WarehouseLocation)
//   3) nastaví Stock (material × pozice) na množství z Factorify
//
// NEpřehrává skladové pohyby (StockMove) — dělá cílový snapshot, takže se
// nemíchá s vlastními pohyby HolyOS a stav sedí 1:1 s Factorify.
//
// Spuštění (v kořeni projektu, .env s FACTORIFY_TOKEN + DATABASE_URL):
//   node scripts/sync-eshop-warehouse-factorify.js                 # DRY-RUN (nic nezapíše)
//   node scripts/sync-eshop-warehouse-factorify.js --apply         # zapíše do DB
//   node scripts/sync-eshop-warehouse-factorify.js --apply --prune # navíc vynuluje Eshop zásoby, které v Factorify nejsou
//   node scripts/sync-eshop-warehouse-factorify.js --warehouse="Eshop"
// =============================================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const factorify = require('../services/factorify/client.service');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const PRUNE = ARGS.includes('--prune');
const WH_ARG = ARGS.find(a => a.startsWith('--warehouse='));
const WAREHOUSE_NAME = WH_ARG ? WH_ARG.substring('--warehouse='.length).replace(/^"|"$/g, '') : 'Eshop';
const PAGE_SIZE = 5000;

const line = '='.repeat(72);

// Factorify pole mohou přijít jako skalár nebo objekt — vytáhni čitelnou hodnotu.
function refName(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.name || v.label || v.code || (v.id != null ? String(v.id) : null);
  return String(v);
}
function refCode(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.code || v.name || (v.id != null ? String(v.id) : null);
  return String(v);
}
function round3(n) { return Math.round(Number(n) * 1000) / 1000; }

async function fetchEshopStockItems() {
  const rows = [];
  let offset = 0;
  const target = WAREHOUSE_NAME.trim().toLowerCase();
  while (true) {
    const page = await factorify.query('StockItem', { limit: PAGE_SIZE, offset }, { timeoutMs: 5 * 60_000 });
    if (!page.length) break;
    for (const r of page) {
      const whName = refName(r.stock);
      if (whName && whName.trim().toLowerCase() === target) rows.push(r);
    }
    process.stdout.write(`\r  StockItem: staženo ${offset + page.length}, Eshop dosud ${rows.length}   `);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  process.stdout.write('\n');
  return rows;
}

async function ensureWarehouse() {
  let wh = await prisma.warehouse.findFirst({
    where: { name: { equals: WAREHOUSE_NAME, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (wh) return wh;
  if (!APPLY) { console.log(`  [dry-run] sklad "${WAREHOUSE_NAME}" neexistuje → byl by vytvořen`); return { id: -1, name: WAREHOUSE_NAME }; }
  wh = await prisma.warehouse.create({
    data: { name: WAREHOUSE_NAME, code: 'ESHOP', type: 'main', active: true },
    select: { id: true, name: true },
  });
  console.log(`  Vytvořen sklad "${wh.name}" (id=${wh.id})`);
  return wh;
}

async function ensureLocation(whId, label, cache) {
  if (cache.has(label)) return cache.get(label);
  const barcode = `sto-${whId}-${label}`;
  const existing = await prisma.warehouseLocation.findUnique({ where: { label }, select: { id: true, warehouse_id: true } });
  if (existing && existing.warehouse_id !== whId) {
    console.log(`  ⚠ pozice "${label}" patří jinému skladu (wh=${existing.warehouse_id}) — přeskočeno`);
    cache.set(label, null);
    return null;
  }
  if (existing) { cache.set(label, existing.id); return existing.id; }
  if (!APPLY) { cache.set(label, -1); return -1; }
  const created = await prisma.warehouseLocation.create({
    data: { warehouse_id: whId, label, barcode, type: 'position' },
    select: { id: true },
  });
  cache.set(label, created.id);
  return created.id;
}

async function setStock(materialId, locationId, quantity) {
  if (!APPLY) return;
  const existing = await prisma.stock.findFirst({ where: { material_id: materialId, location_id: locationId, lot_id: null }, select: { id: true } });
  if (existing) await prisma.stock.update({ where: { id: existing.id }, data: { quantity } });
  else await prisma.stock.create({ data: { material_id: materialId, location_id: locationId, lot_id: null, quantity } });
}

async function main() {
  const cfg = factorify.getConfig();
  console.log(line);
  console.log('HolyOS — Sync skladu Eshop z Factorify (StockItem snapshot)');
  console.log(`  Factorify: ${cfg.baseUrl}  (AU=${cfg.accountingUnit}, token=${cfg.tokenPreview})`);
  console.log(`  Sklad:     "${WAREHOUSE_NAME}"`);
  console.log(`  Režim:     ${APPLY ? 'APPLY (zapisuje do DB)' : 'DRY-RUN (nic nezapíše)'}${PRUNE ? ' + PRUNE' : ''}`);
  console.log(line);
  if (!cfg.tokenSet) { console.error('❌ FACTORIFY_TOKEN není v .env'); process.exit(1); }

  console.log('\n[1/4] Stahuji StockItem z Factorify…');
  const items = await fetchEshopStockItems();
  console.log(`  Nalezeno ${items.length} položek na skladu "${WAREHOUSE_NAME}".`);
  if (!items.length) { console.log('  Nic k synchronizaci. Konec.'); return; }

  console.log('\n[2/4] Sklad + materiály');
  const wh = await ensureWarehouse();
  const materials = await prisma.material.findMany({ select: { id: true, code: true } });
  const matByCode = new Map(materials.map(m => [String(m.code).toUpperCase(), m.id]));
  console.log(`  Sklad id=${wh.id}, materiálů v HolyOS: ${matByCode.size}`);

  console.log('\n[3/4] Pozice + zásoby');
  const locCache = new Map();
  let posCreated = 0, stockSet = 0, unmatched = 0, skipped = 0, totalQty = 0;
  const seen = new Set(); // "materialId:locationId" pro prune
  const unmatchedCodes = [];

  for (const it of items) {
    const code = refCode(it.goods);
    const qty = round3(it.quantity != null ? it.quantity : 0);
    let label = refName(it.position);
    if (!label) label = 'ESHOP-BEZ-POZICE';
    label = String(label).trim();

    const materialId = code ? matByCode.get(String(code).toUpperCase()) : null;
    if (!materialId) { unmatched++; if (unmatchedCodes.length < 25) unmatchedCodes.push(code || '(bez kódu)'); continue; }

    const locId = await ensureLocation(wh.id, label, locCache);
    if (locId === null) { skipped++; continue; }
    if (locId === -1 && !APPLY) posCreated++; // dry-run odhad

    await setStock(materialId, locId, qty);
    if (APPLY && locId > 0) seen.add(`${materialId}:${locId}`);
    stockSet++; totalQty += qty;
  }
  // Spočítej reálně vytvořené pozice (v APPLY jsou v cache >0, ale nevíme kolik bylo nových;
  // pro přehled stačí počet unikátních labelů).
  const uniqueLabels = new Set(items.map(it => String(refName(it.position) || 'ESHOP-BEZ-POZICE').trim()));
  console.log(`  Unikátních pozic: ${uniqueLabels.size}`);
  console.log(`  Zásoby nastaveny (řádků): ${stockSet}, celkem kusů: ${round3(totalQty)}`);
  if (unmatched) console.log(`  ⚠ Nespárováno s materiálem (kód chybí v HolyOS): ${unmatched}\n     ${unmatchedCodes.join(', ')}${unmatched > unmatchedCodes.length ? ' …' : ''}`);
  if (skipped) console.log(`  ⚠ Přeskočené pozice (label jinde): ${skipped}`);

  console.log('\n[4/4] Prune');
  if (PRUNE && APPLY && wh.id > 0) {
    const existing = await prisma.stock.findMany({
      where: { location: { warehouse_id: wh.id } },
      select: { id: true, material_id: true, location_id: true, quantity: true },
    });
    let zeroed = 0;
    for (const s of existing) {
      if (!seen.has(`${s.material_id}:${s.location_id}`) && Number(s.quantity) !== 0) {
        await prisma.stock.update({ where: { id: s.id }, data: { quantity: 0 } });
        zeroed++;
      }
    }
    console.log(`  Vynulováno zásob mimo Factorify snapshot: ${zeroed}`);
  } else {
    console.log(PRUNE ? '  (prune jen v APPLY režimu)' : '  (bez --prune — přebytečné zásoby ponechány)');
  }

  console.log('\n' + line);
  console.log(APPLY ? 'HOTOVO — zapsáno do DB.' : 'HOTOVO — DRY-RUN (nic se nezapsalo). Spusť s --apply pro zápis.');
  console.log(line);
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
