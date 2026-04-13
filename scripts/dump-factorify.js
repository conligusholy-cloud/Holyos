// =============================================================================
// HolyOS — Jednorázový dump dat z Factorify do PostgreSQL
// Spuštění: node scripts/dump-factorify.js
// =============================================================================

require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Konfigurace ──────────────────────────────────────────────────────────

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';

if (!TOKEN) {
  console.error('❌ FACTORIFY_TOKEN není nastaven v .env');
  process.exit(1);
}

console.log(`\n🔗 Factorify: ${BASE_URL}`);
console.log(`🔑 Token: ${TOKEN.substring(0, 10)}...`);

// ─── HTTP helper ──────────────────────────────────────────────────────────

function queryFactorify(entityName, body = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/query/${entityName}`, BASE_URL);
    const postData = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': '1',
        'X-FySerialization': 'ui2',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed).substring(0, 200)}`));
            return;
          }
          // Flexibilní extrakce pole záznamů
          let rows = parsed;
          if (parsed.rows) rows = parsed.rows;
          else if (parsed.items) rows = parsed.items;
          else if (parsed.records) rows = parsed.records;
          else if (parsed.data) rows = parsed.data;
          else if (!Array.isArray(parsed)) {
            // Najdi první pole v odpovědi
            for (const key of Object.keys(parsed)) {
              if (Array.isArray(parsed[key])) { rows = parsed[key]; break; }
            }
          }
          if (!Array.isArray(rows)) rows = [rows];
          resolve(rows);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getStr(obj, ...keys) {
  for (const k of keys) {
    const val = obj[k];
    if (val === null || val === undefined) continue;
    let result;
    if (typeof val === 'string') result = val;
    else if (typeof val === 'number' || typeof val === 'boolean') result = String(val);
    else if (typeof val === 'object') {
      const inner = val.label || val.name || val.referenceName;
      if (typeof inner === 'string') result = inner;
      else if (inner !== null && inner !== undefined) result = String(inner);
      else result = JSON.stringify(val);
    } else {
      result = String(val);
    }
    return result;
  }
  return null;
}

// Ořez stringu na max délku (pro VarChar sloupce)
function trimStr(val, maxLen) {
  if (!val) return val;
  return val.length > maxLen ? val.substring(0, maxLen) : val;
}

function getNum(obj, ...keys) {
  for (const k of keys) {
    const val = obj[k];
    if (val !== null && val !== undefined && !isNaN(val)) return Number(val);
  }
  return null;
}

function getBool(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== null && obj[k] !== undefined) return !!obj[k];
  }
  return false;
}

function getInt(obj, ...keys) {
  const n = getNum(obj, ...keys);
  return n !== null ? Math.round(n) : null;
}

// ─── TYPE MAPPING ─────────────────────────────────────────────────────────

function mapGoodsType(raw) {
  const t = (getStr(raw, 'type') || '').toLowerCase();
  if (t.includes('výrobek') || t.includes('vyrobek') || t.includes('product')) return 'product';
  if (t.includes('materiál') || t.includes('material')) return 'material';
  if (t.includes('polotovar') || t.includes('semi')) return 'semi_product';
  if (t.includes('zboží') || t.includes('zbozi') || t.includes('goods')) return 'goods';
  return 'material';
}

function mapStatus(raw) {
  const s = (getStr(raw, 'state', 'status') || '').toLowerCase();
  if (s.includes('aktiv') || s.includes('active')) return 'active';
  if (s.includes('nov') || s.includes('new')) return 'new';
  if (s.includes('archiv')) return 'archived';
  return 'active';
}

// ─── DUMP: Goods → Materials + Products ──────────────────────────────────

async function dumpGoods() {
  console.log('\n📦 Stahuju Goods z Factorify...');
  const goods = await queryFactorify('Goods');
  console.log(`   → Nalezeno ${goods.length} záznamů`);

  let materialCount = 0;
  let productCount = 0;

  for (const g of goods) {
    const factorifyId = String(getNum(g, 'id', 'ID', 'Id') || '');
    if (!factorifyId) continue;

    const code = getStr(g, 'code', 'Code', 'referenceName', 'ReferenceName') || `FY-${factorifyId}`;
    const name = getStr(g, 'name', 'Name', 'label', 'Label') || code;
    const type = mapGoodsType(g);
    const status = mapStatus(g);

    // Sestavit data pro upsert (s ořezem na max délku VarChar sloupců)
    const matData = {
      name: trimStr(name, 255),
      type: trimStr(type, 50),
      status: trimStr(status, 20),
      factorify_id: trimStr(factorifyId, 100),
      unit: trimStr(getStr(g, 'unit', 'Unit') || 'ks', 20),
      barcode: trimStr(getStr(g, 'barcode', 'Barcode'), 100),
      weight: getNum(g, 'CAD_Hmotnost', 'weight', 'Weight'),
      dimension: trimStr(getStr(g, 'CAD_Rozmer', 'dimension', 'Dimension'), 255),
      color: trimStr(getStr(g, 'colorHex', 'ColorHex'), 7),
      secondary_color: trimStr(getStr(g, 'secondaryColorHex', 'SecondaryColorHex'), 7),
      min_stock: getNum(g, 'minimalStock', 'MinimalStock'),
      max_stock: getNum(g, 'maximalStock', 'MaximalStock'),
      batch_size_min: getNum(g, 'minimalBatchSize', 'MinimalBatchSize'),
      batch_size_max: getNum(g, 'maximalBatchSize', 'MaximalBatchSize'),
      batch_size_default: getNum(g, 'commonBatchSize', 'CommonBatchSize'),
      processed_in_multiples: getNum(g, 'processingInMultiples', 'ProcessingInMultiples'),
      expedition_reserve_days: getNum(g, 'dispatchReserveDays', 'DispatchReserveDays'),
      delivery_tolerance_pct: getNum(g, 'underdeliveryTolerancePct', 'UnderdeliveryTolerancePct'),
      priority: getInt(g, 'priority', 'Priority'),
      daily_target: getNum(g, 'dailyTarget', 'DailyTarget'),
      plan_orders: getBool(g, 'planOrders', 'PlanOrders'),
      non_stock: getBool(g, 'nonStock', 'NonStock'),
      distinguish_batches: getBool(g, 'distinguishBatches', 'DistinguishBatches'),
      interchangeable_batches: getBool(g, 'interchangeableBatches', 'InterchangeableBatches'),
      mandatory_scan: getBool(g, 'mandatoryScan', 'MandatoryScan'),
      exact_consumption: getBool(g, 'exactConsumption', 'ExactConsumption'),
      expirable: getBool(g, 'perishable', 'Perishable'),
      shelf_life: trimStr(getStr(g, 'shelfLife', 'ShelfLife'), 20),
      shelf_life_unit: trimStr(getStr(g, 'shelfLifeUnit', 'ShelfLifeUnit'), 20),
      classification: trimStr(getStr(g, 'CAD_skupina', 'classification', 'Classification'), 50),
      norm: trimStr(getStr(g, 'CAD_norma', 'norm'), 100),
      family: trimStr(getStr(g, 'family', 'Family'), 100),
      material_group: trimStr(getStr(g, 'materialGroup', 'MaterialGroup'), 100),
      material_ref: trimStr(getStr(g, 'CAD_Materiál', 'CAD_Material'), 100),
      semi_product_ref: trimStr(getStr(g, 'CAD_Polotovar'), 100),
      route: trimStr(getStr(g, 'CAD_PATH', 'CAD_Path'), 100),
      revision_number: trimStr(getStr(g, 'CAD_cislo_revize'), 50),
      order_number: trimStr(getStr(g, 'CAD_cislo_zakazky'), 100),
      position: trimStr(getStr(g, 'CAD_pozice'), 100),
      drawn_by: trimStr(getStr(g, 'CAD_kreslil'), 100),
      toolbox_name: trimStr(getStr(g, 'CAD_Název'), 255),
      photo_url: getStr(g, 'photoUrl', 'PhotoUrl'),
    };

    // Uložit do Materials
    try {
      await prisma.material.upsert({
        where: { code: trimStr(code, 50) },
        update: matData,
        create: { code: trimStr(code, 50), ...matData },
      });
      materialCount++;
    } catch (e) {
      console.error(`   ⚠ Material ${code}: ${e.message}`);
    }

    // Pokud je to výrobek, uložit taky do Products
    if (type === 'product' || type === 'semi_product') {
      try {
        const existingProduct = await prisma.product.findFirst({ where: { factorify_id: parseInt(factorifyId) || 0 } });
        if (!existingProduct) {
          await prisma.product.create({
            data: {
              code: trimStr(code, 50),
              name: trimStr(name, 255),
              type: type === 'semi_product' ? 'semi-product' : 'product',
              factorify_id: parseInt(factorifyId) || null,
            },
          });
          productCount++;
        }
      } catch (e) {
        console.error(`   ⚠ Product ${code}: ${e.message}`);
      }
    }
  }

  console.log(`   ✅ Materials: ${materialCount} uloženo`);
  console.log(`   ✅ Products: ${productCount} uloženo`);
}

// ─── DUMP: Stage → Workstations ──────────────────────────────────────────

async function dumpStages() {
  console.log('\n🏭 Stahuju Stage (pracoviště) z Factorify...');
  const stages = await queryFactorify('Stage');
  console.log(`   → Nalezeno ${stages.length} záznamů`);

  let count = 0;
  for (const s of stages) {
    const factorifyId = getInt(s, 'id', 'ID', 'Id');
    if (!factorifyId) continue;

    const name = getStr(s, 'label', 'name', 'Name', 'title', 'Title') || `Stage-${factorifyId}`;
    const code = getStr(s, 'code', 'Code', 'referenceName', 'ReferenceName');
    const isActive = !getBool(s, 'archived', 'Archived');

    try {
      const existing = await prisma.workstation.findFirst({ where: { factorify_id: factorifyId } });
      if (existing) {
        await prisma.workstation.update({
          where: { id: existing.id },
          data: { name, code },
        });
      } else {
        await prisma.workstation.create({
          data: { name, code, factorify_id: factorifyId },
        });
      }
      count++;
    } catch (e) {
      console.error(`   ⚠ Stage ${name}: ${e.message}`);
    }
  }

  console.log(`   ✅ Workstations: ${count} uloženo`);
}

// ─── DUMP: Operations → ProductOperations ────────────────────────────────

async function dumpOperations() {
  console.log('\n⚙️  Stahuju operace z Factorify...');

  // Zkusit různé entity názvy
  const entityNames = ['WorkOperation', 'Operation', 'ProductionOperation', 'TechnologicalRoute', 'Route'];
  let operations = [];
  let usedEntity = '';

  for (const eName of entityNames) {
    try {
      const result = await queryFactorify(eName);
      if (result.length > 0) {
        operations = result;
        usedEntity = eName;
        break;
      }
    } catch (e) {
      // Entita neexistuje, zkusíme další
    }
  }

  if (operations.length === 0) {
    console.log('   ⚠ Žádné operace nenalezeny (žádná z entit nevrátila data)');
    return;
  }

  console.log(`   → Nalezeno ${operations.length} záznamů z entity "${usedEntity}"`);

  // Načíst workstations pro mapování
  const workstations = await prisma.workstation.findMany();
  const wsMap = new Map();
  for (const ws of workstations) {
    if (ws.factorify_id) wsMap.set(ws.factorify_id, ws.id);
  }

  // Načíst products pro mapování
  const products = await prisma.product.findMany();
  const prodMap = new Map();
  for (const p of products) {
    if (p.factorify_id) prodMap.set(p.factorify_id, p.id);
  }

  let count = 0;
  for (const op of operations) {
    // Identifikace produktu
    const itemId = getInt(op, 'itemId', 'ItemId', 'goodsId', 'GoodsId', 'productId', 'ProductId');
    const productId = itemId ? prodMap.get(itemId) : null;
    if (!productId) continue; // Bez vazby na produkt nemá smysl

    // Identifikace pracoviště
    let stageId = getInt(op, 'stageId', 'StageId');
    if (!stageId && op.stage) {
      stageId = getInt(op.stage, 'id', 'ID', 'Id');
    }
    const workstationId = stageId ? wsMap.get(stageId) : null;

    const name = getStr(op, 'label', 'name', 'Name', 'operationName', 'OperationName') || 'Operace';
    const stepNumber = getInt(op, 'order', 'Order', 'sequence', 'Sequence', 'operationOrder', 'OperationOrder') || 1;
    const duration = getInt(op, 'duration', 'Duration', 'time', 'Time', 'operationTime', 'cycleTime') || 60;
    const durationUnit = duration > 3600 ? 'HOUR' : (duration > 120 ? 'MINUTE' : 'SECOND');
    const durationNorm = durationUnit === 'HOUR' ? Math.round(duration / 3600) :
                         durationUnit === 'MINUTE' ? Math.round(duration / 60) : duration;
    const phase = getStr(op, 'phase', 'Phase');
    const prepTime = getInt(op, 'preparationTime', 'PreparationTime', 'setupTime') || 0;

    try {
      await prisma.productOperation.create({
        data: {
          product_id: productId,
          workstation_id: workstationId,
          step_number: stepNumber,
          name,
          phase,
          duration: durationNorm,
          duration_unit: durationUnit,
          preparation_time: prepTime,
        },
      });
      count++;
    } catch (e) {
      console.error(`   ⚠ Operation ${name}: ${e.message}`);
    }
  }

  console.log(`   ✅ ProductOperations: ${count} uloženo`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  FACTORIFY → PostgreSQL — jednorázový dump');
  console.log('═══════════════════════════════════════════');

  try {
    await dumpGoods();
    await dumpStages();
    await dumpOperations();

    // Statistika
    const [materials, products, workstations, operations] = await Promise.all([
      prisma.material.count(),
      prisma.product.count(),
      prisma.workstation.count(),
      prisma.productOperation.count(),
    ]);

    console.log('\n═══════════════════════════════════════════');
    console.log('  HOTOVO — Stav databáze:');
    console.log(`  📦 Materials:        ${materials}`);
    console.log(`  🏭 Products:         ${products}`);
    console.log(`  🔧 Workstations:     ${workstations}`);
    console.log(`  ⚙️  Operations:       ${operations}`);
    console.log('═══════════════════════════════════════════\n');
  } catch (e) {
    console.error('\n❌ Fatální chyba:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
