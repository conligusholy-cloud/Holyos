// =============================================================================
// HolyOS — Rychlý dump Stage + Operations z Factorify (dávkový)
// Goods už jsou naimportované (2831 materials, 891 products)
// Spuštění: node scripts/dump-factorify-fast.js
// =============================================================================

require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';

// ─── HTTP helper ──────────────────────────────────────────────────────────

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
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

function s(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      const inner = v.label || v.name || v.referenceName;
      return typeof inner === 'string' ? inner : String(inner || '');
    }
  }
  return null;
}

function n(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !isNaN(v)) return Number(v);
  }
  return null;
}

function trim(val, max) { return val && val.length > max ? val.substring(0, max) : val; }

// ─── MAIN ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  FACTORIFY → PostgreSQL — Stage + Operations');
  console.log('═══════════════════════════════════════════\n');

  // ── 1. Doplnit chybějící Goods (zbylých ~200) ──
  console.log('📦 Kontrola chybějících Goods...');
  const existingCodes = new Set((await prisma.material.findMany({ select: { code: true } })).map(m => m.code));
  const goods = await queryFactorify('Goods');
  const missing = goods.filter(g => {
    const code = trim(s(g, 'code', 'Code', 'referenceName') || `FY-${n(g, 'id', 'ID')}`, 50);
    return !existingCodes.has(code);
  });
  console.log(`   → ${missing.length} chybějících z ${goods.length} celkem`);

  if (missing.length > 0) {
    const BATCH = 50;
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const data = batch.map(g => {
        const fid = String(n(g, 'id', 'ID', 'Id') || '');
        const code = trim(s(g, 'code', 'Code', 'referenceName') || `FY-${fid}`, 50);
        const name = trim(s(g, 'name', 'Name', 'label') || code, 255);
        const t = (s(g, 'type') || '').toLowerCase();
        const type = t.includes('výrobek') || t.includes('product') ? 'product' :
                     t.includes('polotovar') ? 'semi_product' : 'material';
        return {
          code, name, type, status: 'active', factorify_id: trim(fid, 100),
          unit: trim(s(g, 'unit', 'Unit') || 'ks', 20),
        };
      }).filter(d => d.code);

      try {
        const result = await prisma.material.createMany({ data, skipDuplicates: true });
        process.stdout.write(`   → Dávka ${Math.floor(i/BATCH)+1}: ${result.count} přidáno\n`);
      } catch (e) {
        console.error(`   ⚠ Dávka chyba: ${e.message.substring(0, 100)}`);
      }
    }
  }

  // ── 2. Stage → Workstations ──
  console.log('\n🏭 Stahuju Stage (pracoviště)...');
  const stages = await queryFactorify('Stage');
  console.log(`   → Nalezeno ${stages.length} záznamů`);

  const existingWs = await prisma.workstation.findMany();
  const existingWsIds = new Set(existingWs.map(w => w.factorify_id));

  const newWorkstations = stages
    .map(st => ({
      name: trim(s(st, 'label', 'name', 'Name', 'title') || `Stage-${n(st, 'id', 'ID')}`, 255),
      code: trim(s(st, 'code', 'Code', 'referenceName'), 50),
      factorify_id: n(st, 'id', 'ID', 'Id'),
    }))
    .filter(w => w.factorify_id && !existingWsIds.has(w.factorify_id));

  if (newWorkstations.length > 0) {
    const result = await prisma.workstation.createMany({ data: newWorkstations, skipDuplicates: true });
    console.log(`   ✅ ${result.count} nových pracovišť uloženo`);
  } else {
    console.log(`   ✅ Všechna pracoviště již existují`);
  }

  // ── 3. Operations → ProductOperations ──
  console.log('\n⚙️  Stahuju operace...');
  const entityNames = ['WorkOperation', 'Operation', 'ProductionOperation'];
  let operations = [];
  let usedEntity = '';

  for (const eName of entityNames) {
    try {
      const result = await queryFactorify(eName);
      if (result.length > 0) { operations = result; usedEntity = eName; break; }
    } catch (e) { /* skip */ }
  }

  if (operations.length === 0) {
    console.log('   ⚠ Žádné operace nenalezeny');
  } else {
    console.log(`   → Nalezeno ${operations.length} z entity "${usedEntity}"`);

    // Mapování pro FK
    const wsAll = await prisma.workstation.findMany();
    const wsMap = new Map(wsAll.map(w => [w.factorify_id, w.id]));
    const prodAll = await prisma.product.findMany();
    const prodMap = new Map(prodAll.map(p => [p.factorify_id, p.id]));

    // Existující operace
    const existingOps = await prisma.productOperation.count();
    if (existingOps > 0) {
      console.log(`   → Již existuje ${existingOps} operací, přeskakuji`);
    } else {
      const opData = [];
      for (const op of operations) {
        const itemId = n(op, 'itemId', 'ItemId', 'goodsId', 'GoodsId', 'productId');
        const productId = itemId ? prodMap.get(itemId) : null;
        if (!productId) continue;

        let stageId = n(op, 'stageId', 'StageId');
        if (!stageId && op.stage) stageId = n(op.stage, 'id', 'ID');
        const workstationId = stageId ? wsMap.get(stageId) : null;

        const duration = n(op, 'duration', 'Duration', 'time', 'Time', 'operationTime') || 60;
        const durationUnit = duration > 3600 ? 'HOUR' : (duration > 120 ? 'MINUTE' : 'SECOND');
        const durationNorm = durationUnit === 'HOUR' ? Math.round(duration / 3600) :
                             durationUnit === 'MINUTE' ? Math.round(duration / 60) : duration;

        opData.push({
          product_id: productId,
          workstation_id: workstationId,
          step_number: n(op, 'order', 'Order', 'sequence', 'Sequence') || 1,
          name: trim(s(op, 'label', 'name', 'Name', 'operationName') || 'Operace', 255),
          phase: trim(s(op, 'phase', 'Phase'), 255),
          duration: durationNorm,
          duration_unit: durationUnit,
          preparation_time: n(op, 'preparationTime', 'PreparationTime') || 0,
        });
      }

      if (opData.length > 0) {
        const BATCH = 100;
        let totalCreated = 0;
        for (let i = 0; i < opData.length; i += BATCH) {
          const batch = opData.slice(i, i + BATCH);
          const result = await prisma.productOperation.createMany({ data: batch, skipDuplicates: true });
          totalCreated += result.count;
        }
        console.log(`   ✅ ${totalCreated} operací uloženo`);
      } else {
        console.log('   ⚠ Žádné operace s vazbou na existující produkty');
      }
    }
  }

  // ── Statistika ──
  const [mat, prod, ws, ops] = await Promise.all([
    prisma.material.count(),
    prisma.product.count(),
    prisma.workstation.count(),
    prisma.productOperation.count(),
  ]);

  console.log('\n═══════════════════════════════════════════');
  console.log('  HOTOVO — Stav databáze:');
  console.log(`  📦 Materials:        ${mat}`);
  console.log(`  🏭 Products:         ${prod}`);
  console.log(`  🔧 Workstations:     ${ws}`);
  console.log(`  ⚙️  Operations:       ${ops}`);
  console.log('═══════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
