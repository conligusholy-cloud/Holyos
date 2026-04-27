// =============================================================================
// HolyOS — Sync Material polí z Factorify (lead_time, ceny, dávkové parametry)
// =============================================================================
//
// Doplňuje data, která neexistují v initial dumpu (dump-factorify-fast.js).
// Pro každý Material s factorify_id se hledá odpovídající Goods entity z Factorify
// a aktualizují se pole:
//   - lead_time_days
//   - unit_price, weighted_avg_price
//   - batch_size_min, batch_size_max, batch_size_default
//   - reorder_quantity
//
// Skript je idempotentní — opakovaný běh aktualizuje hodnoty na nejnovější.
//
// Použití:
//   node scripts/sync-material-fields.js          # sync vše
//   node scripts/sync-material-fields.js --dry    # jen ukáž, neaktualizuj
//   node scripts/sync-material-fields.js --limit=50  # jen prvních 50 (pro testy)

require('dotenv').config({ override: true });
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';

const DRY_RUN = process.argv.includes('--dry');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

if (!TOKEN) {
  console.error('CHYBA: chybí FACTORIFY_TOKEN v .env');
  process.exit(1);
}

// ─── Factorify HTTP helper ──────────────────────────────────────────────────
function queryFactorify(entityName, body = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/query/${entityName}`, BASE_URL);
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'Cookie': `securityToken=${TOKEN}`, 'X-AccountingUnit': '1',
        'X-FySerialization': 'ui2', 'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          let rows = parsed;
          if (parsed.rows) rows = parsed.rows;
          else if (parsed.items) rows = parsed.items;
          else if (!Array.isArray(parsed)) {
            for (const key of Object.keys(parsed)) {
              if (Array.isArray(parsed[key])) { rows = parsed[key]; break; }
            }
          }
          if (!Array.isArray(rows)) rows = [];
          resolve(rows);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

// ─── Helpery — defensivní extrakce hodnot z Factorify objektů ───────────────
function pickNum(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'number' && !isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(',', '.'));
      if (!isNaN(n)) return n;
    }
    if (typeof v === 'object' && v.value != null) {
      const n = Number(v.value);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

function pickStr(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      const inner = v.label || v.name || v.referenceName;
      if (typeof inner === 'string') return inner;
    }
  }
  return null;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HolyOS — Sync Material polí z Factorify');
  if (DRY_RUN) console.log('  *** DRY RUN — žádné změny v DB ***');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📦 Stahuju Goods z Factorify...');
  const goods = await queryFactorify('Goods');
  console.log(`   → Nalezeno ${goods.length} záznamů\n`);

  // Index podle factorify ID jako STRING (Material.factorify_id je String)
  const goodsById = new Map();
  for (const g of goods) {
    const fid = pickStr(g, 'id', 'ID', 'Id') || (g.id != null ? String(g.id) : null);
    if (fid) goodsById.set(fid, g);
  }

  // Diagnostika klíčů — vypiš sample pole prvního záznamu (pomoc při ladění)
  if (goods[0]) {
    console.log('🔍 Sample Goods record (interesting fields only):');
    const interesting = [
      'id', 'code', 'name', 'unit', 'minimalBatchSize', 'maximalBatchSize',
      'commonBatchSize', 'processingInMultiples', 'priority', 'dailyTarget',
      'forecastsPct', 'dispatchReserveDays', 'releaseBeforeDispatchDays',
      'supplier', 'stockQuantity', 'orderWeight',
    ];
    const sample = {};
    for (const k of interesting) if (goods[0][k] !== undefined) sample[k] = goods[0][k];
    console.log(JSON.stringify(sample, null, 2));
    console.log('');
  }

  console.log('📋 Načítám Materials s factorify_id z DB...');
  const materials = await prisma.material.findMany({
    where: { factorify_id: { not: null } },
    select: {
      id: true, code: true, name: true, factorify_id: true,
      lead_time_days: true, unit_price: true, weighted_avg_price: true,
      batch_size_min: true, batch_size_max: true, batch_size_default: true,
      reorder_quantity: true, supplier_id: true,
    },
    take: LIMIT || undefined,
  });
  console.log(`   → ${materials.length} Materials\n`);

  // ── Supplier mapping — name-based (Company nemá factorify_id) ──────────
  // Vyber unique suppliers ze všech relevantních Goods záznamů.
  console.log('🏢 Mapuji suppliers (name-based match na Company)...');
  const wantedFids = new Set(materials.map(m => m.factorify_id));
  const uniqueSuppliers = new Map(); // factorify_supplier_id → name
  for (const g of goods) {
    const fid = pickStr(g, 'id', 'ID', 'Id') || (g.id != null ? String(g.id) : null);
    if (!wantedFids.has(fid)) continue;
    const arr = Array.isArray(g.supplier) ? g.supplier : (g.supplier ? [g.supplier] : []);
    for (const sup of arr) {
      const sId = sup?.id;
      const sName = sup?.name || sup?.referenceName;
      if (sId && sName) uniqueSuppliers.set(sId, sName);
    }
  }
  console.log(`   → ${uniqueSuppliers.size} unique dodavatelů z Factorify`);

  // Najdi v DB Company podle name (case-insensitive) — 1 batch query místo per-row findFirst.
  const allCompanies = await prisma.company.findMany({ select: { id: true, name: true } });
  const normMap = new Map(); // normalized name → company_id
  for (const c of allCompanies) {
    if (c.name) normMap.set(c.name.trim().toLowerCase(), c.id);
  }

  const supplierMap = new Map(); // factorify_supplier_id → company_id
  let suppliersExisting = 0;
  let suppliersCreated = 0;
  for (const [sId, sName] of uniqueSuppliers) {
    const norm = sName.trim().toLowerCase();
    const existingId = normMap.get(norm);
    if (existingId) {
      supplierMap.set(sId, existingId);
      suppliersExisting++;
    } else if (!DRY_RUN) {
      const created = await prisma.company.create({
        data: { name: sName, type: 'supplier', active: true },
        select: { id: true },
      });
      supplierMap.set(sId, created.id);
      normMap.set(norm, created.id); // pro případné další stejné jméno v této session
      suppliersCreated++;
    } else {
      suppliersCreated++; // dry-run counter
    }
  }
  console.log(`   → ${suppliersExisting} existujících Companies, ${suppliersCreated} ${DRY_RUN ? 'k vytvoření' : 'vytvořeno'}\n`);

  // ── Statistika coverage ──
  // POZN: Factorify Goods entity neobsahuje leadTime ani unitPrice — ty jsou
  // v jiných entitách (Supplier×Goods, PriceList). Synchronizujeme jen pole,
  // která Goods skutečně má.
  const coverage = {
    total: materials.length,
    matched: 0,
    unmatched: 0,
    fields: {
      batch_size_default: 0, batch_size_min: 0, batch_size_max: 0,
      processed_in_multiples: 0, priority: 0, daily_target: 0,
      forecast_pct: 0, expedition_reserve_days: 0, release_before_dispatch_days: 0,
      supplier_id: 0,
    },
    updated: 0,
  };

  const updates = [];

  for (const m of materials) {
    const g = goodsById.get(m.factorify_id);
    if (!g) { coverage.unmatched++; continue; }
    coverage.matched++;

    // Skutečné Factorify klíče (zjištěno z dump 2026-04-27)
    const bsMin     = pickNum(g, 'minimalBatchSize');
    const bsMax     = pickNum(g, 'maximalBatchSize');
    const bsDef     = pickNum(g, 'commonBatchSize');
    const procMul   = pickNum(g, 'processingInMultiples');
    const prio      = pickNum(g, 'priority');
    const dailyTgt  = pickNum(g, 'dailyTarget');
    const forecast  = pickNum(g, 'forecastsPct');
    const dispRes   = pickNum(g, 'dispatchReserveDays');
    const relBeforeD = pickNum(g, 'releaseBeforeDispatchDays');

    // Supplier — vezmi PRVNÍHO dodavatele z pole, namapuj na náš Company.id
    let supplierId = null;
    const supArr = Array.isArray(g.supplier) ? g.supplier : (g.supplier ? [g.supplier] : []);
    if (supArr.length > 0 && supArr[0]?.id != null) {
      supplierId = supplierMap.get(supArr[0].id) || null;
    }

    if (bsMin    != null) coverage.fields.batch_size_min++;
    if (bsMax    != null) coverage.fields.batch_size_max++;
    if (bsDef    != null) coverage.fields.batch_size_default++;
    if (procMul  != null) coverage.fields.processed_in_multiples++;
    if (prio     != null) coverage.fields.priority++;
    if (dailyTgt != null) coverage.fields.daily_target++;
    if (forecast != null) coverage.fields.forecast_pct++;
    if (dispRes  != null) coverage.fields.expedition_reserve_days++;
    if (relBeforeD != null) coverage.fields.release_before_dispatch_days++;
    if (supplierId != null) coverage.fields.supplier_id++;

    const data = {};
    if (bsMin    != null) data.batch_size_min              = bsMin;
    if (bsMax    != null) data.batch_size_max              = bsMax;
    if (bsDef    != null) data.batch_size_default          = bsDef;
    if (procMul  != null) data.processed_in_multiples      = procMul;
    if (prio     != null) data.priority                    = Math.round(prio); // schema: Int?
    if (dailyTgt != null) data.daily_target                = dailyTgt;
    if (forecast != null) data.forecast_pct                = forecast;
    if (dispRes  != null) data.expedition_reserve_days     = dispRes;
    if (relBeforeD != null) data.release_before_dispatch_days = relBeforeD;
    if (supplierId != null && m.supplier_id !== supplierId) data.supplier_id = supplierId;

    if (Object.keys(data).length > 0) {
      updates.push({ id: m.id, data });
    }
  }

  console.log('📊 Coverage:');
  console.log(`   Match podle factorify_id:   ${coverage.matched} / ${coverage.total}  (${(coverage.matched / coverage.total * 100).toFixed(1)} %)`);
  console.log(`   Bez match:                  ${coverage.unmatched}`);
  console.log(`   Pole, která Factorify má:`);
  for (const [k, v] of Object.entries(coverage.fields)) {
    console.log(`     - ${k.padEnd(22)} ${v}`);
  }
  console.log(`   Updates připravené:         ${updates.length}\n`);

  if (DRY_RUN) {
    console.log('⏸️  DRY RUN — žádné změny v DB. Sample updates:');
    updates.slice(0, 5).forEach(u => console.log('   ', u));
    await prisma.$disconnect();
    return;
  }

  if (updates.length === 0) {
    console.log('   Nic k aktualizaci — žádný Material nemá v Factorify rozšířená pole.');
    await prisma.$disconnect();
    return;
  }

  console.log('💾 Aktualizuji DB...');
  let done = 0;
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map(u => prisma.material.update({ where: { id: u.id }, data: u.data })),
    );
    done += chunk.length;
    if (done % 200 === 0 || done === updates.length) {
      console.log(`   ${done} / ${updates.length}`);
    }
  }
  coverage.updated = done;

  console.log(`\n✅ Hotovo — aktualizováno ${coverage.updated} Materials.`);
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('❌', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
