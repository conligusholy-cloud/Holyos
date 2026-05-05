// =============================================================================
// HolyOS — Reconciliation Factorify ↔ HolyOS po migraci
// =============================================================================
// Porovná aktuální stav skladu:
//   - HolyOS: vypočítá z InventoryMovement (sum per material × warehouse,
//             knnamenko podle type: receipt = +qty, issue/pick = -qty,
//             transfer = +qty na to_location, -qty z from_location)
//   - Factorify: stáhne StockItem entitu paginovaně (po 5000 záznamů)
//
// Output:
//   data/factorify-recon/_summary.md          (markdown report)
//   data/factorify-recon/mismatches.csv       (rozdíly per material × warehouse)
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const factorify = require('../services/factorify/client.service');

const prisma = new PrismaClient({ log: ['warn', 'error'] });
const OUT_DIR = path.join(__dirname, '..', 'data', 'factorify-recon');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Threshold — kvantitativní rozdíl menší než tohle ignorujeme (rounding).
const TOLERANCE = 0.01;

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  HolyOS — Factorify reconciliation');
  console.log('═══════════════════════════════════════════');

  // ─── 1) Stáhnout aktuální stav z Factorify (StockItem) ──────────────────
  console.log('\n📥 Stahuji aktuální stav z Factorify (StockItem)…');
  const factorifyStock = new Map(); // key: `${goodsId}-${stockId}` → quantity
  let offset = 0, totalDownloaded = 0;
  const PAGE = 5000;
  const start = Date.now();

  while (true) {
    const page = await factorify.query('StockItem', {
      limit: PAGE,
      offset,
    }, { timeoutMs: 5 * 60_000 });
    if (page.length === 0) break;
    totalDownloaded += page.length;

    for (const r of page) {
      const goodsId = r?.goods?.id != null ? String(r.goods.id) : null;
      const stockId = r?.stock?.id != null ? String(r.stock.id) : null;
      if (!goodsId || !stockId) continue;
      const qty = Number(r?.quantity || 0);
      const key = `${goodsId}-${stockId}`;
      factorifyStock.set(key, (factorifyStock.get(key) || 0) + qty);
    }
    process.stdout.write(`\r  offset=${offset} · ${totalDownloaded} downloaded · ${factorifyStock.size} unikátních (material × stock)   `);

    if (page.length < PAGE) break;
    offset += PAGE;
  }
  process.stdout.write('\n');
  console.log(`  ⓘ Staženo ${totalDownloaded} StockItem za ${((Date.now() - start) / 1000).toFixed(0)}s`);

  // ─── 2) Vypočítat aktuální stav v HolyOS z InventoryMovement ────────────
  console.log('\n🧮 Počítám aktuální stav v HolyOS (sum InventoryMovement)…');

  // Mapa: materialFid + warehouseFid → HolyOS quantity
  // Vyčíslení: receipt → +, issue/pick → -, adjustment → +, transfer → 0 net (zatím nemodel.)
  // Pozn.: transfer ovlivňuje location, ne sklad jako celek. Pro inter-warehouse transfer
  // by bylo nutné rozlišit src/dst warehouse — ale Factorify StockMove vázán pouze na
  // jeden Stock, nelze rozumně rozlišit. Pro jistotu zahrneme jen receipt+issue+adjust+pick.

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      factorify_id: { not: null },
      material: { factorify_id: { not: null } },
      warehouse: { factorify_id: { not: null } },
    },
    select: {
      type: true,
      quantity: true,
      material: { select: { factorify_id: true } },
      warehouse: { select: { factorify_id: true } },
    },
  });
  console.log(`  Načteno ${movements.length} pohybů z HolyOS`);

  // Faktorify quantity je SIGNED (ověřeno scripts/debug-stockmove-sign.js):
  //   RECEIVE → +qty,  ISSUE/CONSUMED → -qty,  TRANSFER → -qty na src + +qty na dst,
  //   CANCELLED → vytvoří anti-záznam, sum = 0
  // Importujeme raw quantity beze změny — stačí sečíst.
  const holyosStock = new Map();
  for (const m of movements) {
    const matFid = m.material?.factorify_id;
    const whFid = m.warehouse?.factorify_id;
    if (!matFid || !whFid) continue;
    const key = `${matFid}-${whFid}`;
    const qty = Number(m.quantity) || 0;
    holyosStock.set(key, (holyosStock.get(key) || 0) + qty);
  }

  // ─── 3) Porovnání ───────────────────────────────────────────────────────
  console.log('\n🔍 Porovnávám…');

  const allKeys = new Set([...factorifyStock.keys(), ...holyosStock.keys()]);
  const mismatches = [];
  const onlyFactorify = [];
  const onlyHolyos = [];
  let matches = 0;

  for (const key of allKeys) {
    const fy = factorifyStock.get(key);
    const ho = holyosStock.get(key);
    if (fy == null) {
      onlyHolyos.push({ key, holyos: ho });
    } else if (ho == null) {
      onlyFactorify.push({ key, factorify: fy });
    } else {
      const diff = Math.abs(fy - ho);
      if (diff < TOLERANCE) matches++;
      else mismatches.push({ key, factorify: fy, holyos: ho, diff: ho - fy });
    }
  }

  // ─── 4) Report ──────────────────────────────────────────────────────────
  const summary = [
    `# Factorify ↔ HolyOS Reconciliation`,
    ``,
    `**Datum:** ${new Date().toISOString()}`,
    ``,
    `## Souhrn`,
    ``,
    `- Factorify StockItem unikátních párů (material × stock): **${factorifyStock.size}**`,
    `- HolyOS InventoryMovement sum (material × warehouse): **${holyosStock.size}**`,
    `- ✅ Shodné (do ${TOLERANCE} ks): **${matches}**`,
    `- ⚠ Rozdíly: **${mismatches.length}**`,
    `- 🔵 Jen ve Factorify (HolyOS chybí): **${onlyFactorify.length}**`,
    `- 🟣 Jen v HolyOS (Factorify má 0 / nemá záznam): **${onlyHolyos.length}**`,
    ``,
  ];

  if (mismatches.length > 0) {
    summary.push(`## Top 30 největších rozdílů`);
    summary.push(``);
    summary.push(`| Material × Stock (Factorify ID) | Factorify | HolyOS | Rozdíl |`);
    summary.push(`|--|--:|--:|--:|`);
    mismatches
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 30)
      .forEach(m => {
        summary.push(`| ${m.key} | ${m.factorify.toFixed(2)} | ${m.holyos.toFixed(2)} | ${m.diff > 0 ? '+' : ''}${m.diff.toFixed(2)} |`);
      });
    summary.push(``);
  }

  if (onlyFactorify.length > 0) {
    summary.push(`## Jen ve Factorify (HolyOS chybí — ${onlyFactorify.length})`);
    summary.push(``);
    summary.push(`Top 20 podle množství:`);
    summary.push(``);
    summary.push(`| Material × Stock | Quantity |`);
    summary.push(`|--|--:|`);
    onlyFactorify
      .sort((a, b) => Math.abs(b.factorify) - Math.abs(a.factorify))
      .slice(0, 20)
      .forEach(m => summary.push(`| ${m.key} | ${m.factorify.toFixed(2)} |`));
    summary.push(``);
  }

  fs.writeFileSync(path.join(OUT_DIR, '_summary.md'), summary.join('\n'));

  // CSV pro analýzu v Excelu
  const csv = ['material_factorify_id;stock_factorify_id;factorify_qty;holyos_qty;diff'];
  for (const m of mismatches) {
    const [mat, st] = m.key.split('-');
    csv.push(`${mat};${st};${m.factorify.toFixed(2)};${m.holyos.toFixed(2)};${m.diff.toFixed(2)}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'mismatches.csv'), csv.join('\n'));

  console.log('\n═══════════════════════════════════════════');
  console.log(`  ✅ Shodné:        ${matches}`);
  console.log(`  ⚠ Rozdíly:       ${mismatches.length}`);
  console.log(`  🔵 Jen Factorify: ${onlyFactorify.length}`);
  console.log(`  🟣 Jen HolyOS:    ${onlyHolyos.length}`);
  console.log(`  📄 ${path.join(OUT_DIR, '_summary.md')}`);
  console.log(`  📊 ${path.join(OUT_DIR, 'mismatches.csv')}`);
  console.log('═══════════════════════════════════════════');
}

main()
  .catch(e => { console.error('Fatální chyba:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
