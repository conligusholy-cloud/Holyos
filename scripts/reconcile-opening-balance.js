// =============================================================================
// HolyOS — Reconciliation: dorovnání aktuálního stavu na Factorify StockItem
// =============================================================================
// Pro každý pár (material × warehouse) kde HolyOS sum InventoryMovement
// ≠ Factorify StockItem aktuální stav, vytvoří jeden korekční pohyb
// type='inventory_adjust' s rozdílem.
//
// Po doběhnutí: HolyOS aktuální stav = Factorify aktuální stav (100% shoda).
// Idempotence: factorify_id = `RECON-${matFid}-${stockFid}-${YYYYMMDD}`.
// Skript lze spustit opakovaně — pokud se mezitím v Factorify něco změnilo,
// vytvoří se nové RECON pohyby s aktuálním datem.
//
// Flagy:
//   --dry-run    jen reportuje, nezapisuje
//   --tolerance  ignoruj rozdíly menší než N (default 0.01)
// =============================================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const factorify = require('../services/factorify/client.service');

const prisma = new PrismaClient({ log: ['warn', 'error'] });
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TOLERANCE = parseFloat(args.find(a => a.startsWith('--tolerance='))?.split('=')[1] || '0.01');

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  HolyOS — Opening balance reconciliation');
  console.log('═══════════════════════════════════════════');
  console.log(`  Mode:      ${DRY_RUN ? 'DRY-RUN (nepíšeme)' : 'LIVE'}`);
  console.log(`  Tolerance: ${TOLERANCE}`);
  console.log('───────────────────────────────────────────\n');

  // ─── 1) Stáhnout Factorify StockItem ────────────────────────────────────
  console.log('📥 Stahuji Factorify StockItem…');
  const factorifyStock = new Map();
  let offset = 0;
  while (true) {
    const page = await factorify.query('StockItem', { limit: 5000, offset }, { timeoutMs: 5 * 60_000 });
    if (page.length === 0) break;
    for (const r of page) {
      const goodsId = r?.goods?.id != null ? String(r.goods.id) : null;
      const stockId = r?.stock?.id != null ? String(r.stock.id) : null;
      if (!goodsId || !stockId) continue;
      const key = `${goodsId}-${stockId}`;
      factorifyStock.set(key, (factorifyStock.get(key) || 0) + Number(r?.quantity || 0));
    }
    process.stdout.write(`\r  offset=${offset} · ${factorifyStock.size} unikátních párů  `);
    if (page.length < 5000) break;
    offset += 5000;
  }
  process.stdout.write('\n');
  console.log(`  ⓘ ${factorifyStock.size} unikátních (material × warehouse) párů\n`);

  // ─── 2) Vypočítat HolyOS sum ────────────────────────────────────────────
  console.log('🧮 Počítám HolyOS sum z InventoryMovement…');
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      factorify_id: { not: null },
      material: { factorify_id: { not: null } },
      warehouse: { factorify_id: { not: null } },
    },
    select: {
      quantity: true,
      material: { select: { id: true, factorify_id: true } },
      warehouse: { select: { id: true, factorify_id: true } },
    },
  });
  const holyosStock = new Map();
  const idLookup = new Map(); // key → { material_id, warehouse_id }
  for (const m of movements) {
    const matFid = m.material?.factorify_id;
    const whFid = m.warehouse?.factorify_id;
    if (!matFid || !whFid) continue;
    const key = `${matFid}-${whFid}`;
    holyosStock.set(key, (holyosStock.get(key) || 0) + Number(m.quantity || 0));
    if (!idLookup.has(key)) idLookup.set(key, { material_id: m.material.id, warehouse_id: m.warehouse.id });
  }
  console.log(`  ⓘ ${holyosStock.size} unikátních párů s pohyby v HolyOS\n`);

  // ─── 3) Pro chybějící páry (jen Factorify) potřebujeme HolyOS lookups ──
  console.log('🔗 Předehřívám lookup material/warehouse pro chybějící páry…');
  const allKeys = new Set([...factorifyStock.keys(), ...holyosStock.keys()]);
  const missingMatFids = new Set();
  const missingWhFids = new Set();
  for (const key of allKeys) {
    if (!idLookup.has(key)) {
      const [mat, wh] = key.split('-');
      missingMatFids.add(mat);
      missingWhFids.add(wh);
    }
  }
  if (missingMatFids.size > 0 || missingWhFids.size > 0) {
    const [mats, whs] = await Promise.all([
      prisma.material.findMany({
        where: { factorify_id: { in: [...missingMatFids] } },
        select: { id: true, factorify_id: true },
      }),
      prisma.warehouse.findMany({
        where: { factorify_id: { in: [...missingWhFids] } },
        select: { id: true, factorify_id: true },
      }),
    ]);
    const matMap = new Map(mats.map(m => [m.factorify_id, m.id]));
    const whMap = new Map(whs.map(w => [w.factorify_id, w.id]));
    for (const key of allKeys) {
      if (idLookup.has(key)) continue;
      const [matFid, whFid] = key.split('-');
      const material_id = matMap.get(matFid);
      const warehouse_id = whMap.get(whFid);
      if (material_id && warehouse_id) idLookup.set(key, { material_id, warehouse_id });
    }
  }
  console.log(`  ⓘ Lookup naplněn pro ${idLookup.size} z ${allKeys.size} párů`);

  // ─── 4) Připravit korekční pohyby ───────────────────────────────────────
  const today = new Date();
  const stamp = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const adjustments = [];
  let skipMissingLookup = 0;
  let skipBelowTolerance = 0;

  for (const key of allKeys) {
    const factorifyQty = factorifyStock.get(key) ?? 0;
    const holyosQty = holyosStock.get(key) ?? 0;
    const diff = factorifyQty - holyosQty;
    if (Math.abs(diff) < TOLERANCE) { skipBelowTolerance++; continue; }
    const ids = idLookup.get(key);
    if (!ids) { skipMissingLookup++; continue; }
    const [matFid, whFid] = key.split('-');
    adjustments.push({
      material_id: ids.material_id,
      warehouse_id: ids.warehouse_id,
      type: 'inventory_adjust',
      quantity: diff,
      reference_type: 'reconciliation',
      note: `Factorify reconciliation ${today.toISOString().slice(0, 10)}: dorovnání opening balance`,
      factorify_id: `RECON-${matFid}-${whFid}-${stamp}`,
      factorify_state: 'RECON',
      factorify_moved_at: today,
      created_at: today,
    });
  }

  console.log(`\n📋 Korekce k vytvoření: ${adjustments.length}`);
  console.log(`  ⓘ Skip (rozdíl < tolerance ${TOLERANCE}): ${skipBelowTolerance}`);
  if (skipMissingLookup > 0) console.log(`  ⚠ Skip (chybí Material/Warehouse v HolyOS): ${skipMissingLookup}`);

  // Top 10 největších adjustmentů pro náhled
  const topByAbs = adjustments
    .map(a => ({ ...a }))
    .sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity))
    .slice(0, 10);
  console.log('\nTop 10 největších korekcí:');
  for (const a of topByAbs) {
    const sign = a.quantity > 0 ? '+' : '';
    console.log(`  mat=${a.material_id} wh=${a.warehouse_id} qty=${sign}${a.quantity.toFixed(0)} (${a.factorify_id})`);
  }

  if (DRY_RUN) {
    console.log('\n🔵 DRY-RUN — nezapisujeme.');
    return;
  }

  // ─── 5) Batch insert ────────────────────────────────────────────────────
  console.log(`\n💾 Zapisuji ${adjustments.length} adjustmentů…`);
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < adjustments.length; i += BATCH) {
    const slice = adjustments.slice(i, i + BATCH);
    try {
      const r = await prisma.inventoryMovement.createMany({ data: slice, skipDuplicates: true });
      inserted += r.count;
      process.stdout.write(`\r  ${inserted}/${adjustments.length} insertnuto…  `);
    } catch (e) {
      console.error(`\n  ❌ batch ${i}: ${e.message}`);
    }
  }
  process.stdout.write('\n');
  console.log(`  ✅ ${inserted} insertnuto · ${adjustments.length - inserted} skipnuto (duplicate)`);

  console.log('\n═══════════════════════════════════════════');
  console.log('  Spusť `node scripts/verify-factorify-import.js` pro finální verifikaci.');
  console.log('═══════════════════════════════════════════');
}

main()
  .catch(e => { console.error('Fatální chyba:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
