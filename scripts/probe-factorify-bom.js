// HolyOS — Probe: zjisti, jak Factorify exposuje sestavu zboží (BOM tree) pro Goods #2942
// Spuštění: node scripts/probe-factorify-bom.js
// Pozn.: Tento skript je jednorázový pomocník pro objev Factorify entity, neukládá nic do DB.

require('dotenv').config();
const https = require('https');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const TARGET_GOODS_ID = 2942; // BS-M-4520 Prádlomat - V Akceptory

function call(path, body = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''), method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': '1',
        'X-FySerialization': 'ui2',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

function preview(text, n = 800) {
  if (!text) return '(empty)';
  if (text.length <= n) return text;
  return text.substring(0, n) + `... (+${text.length - n} chars)`;
}

(async () => {
  console.log(`Base: ${BASE_URL}, target Goods id=${TARGET_GOODS_ID}\n`);

  // 1) Try plain /api/query/<Entity> for various candidate entity names
  const candidateEntities = [
    'GoodsItem', 'GoodsAssembly', 'GoodsComposition', 'GoodsRecipe',
    'BillOfMaterials', 'Bom', 'BomItem', 'GoodsBom',
    'GoodsStructure', 'StructureItem', 'CompositionItem',
    'ProductStructure', 'ProductionRecipe', 'Recipe', 'RecipeItem',
    'GoodsIngredient', 'Ingredient', 'StructureGoods', 'GoodsStructureItem',
    'AssemblyItem', 'BoMRow', 'PartList', 'PartListItem',
  ];

  for (const ent of candidateEntities) {
    try {
      const r = await call(`/api/query/${ent}`, {});
      if (r.status === 200) {
        console.log(`✅ /api/query/${ent} → 200`);
        console.log(`   ${preview(r.body, 400)}\n`);
      } else if (r.status === 404) {
        // silent — entity neexistuje
      } else {
        console.log(`?  /api/query/${ent} → ${r.status} — ${preview(r.body, 150)}`);
      }
    } catch (e) {
      console.log(`!  /api/query/${ent} → ${e.message}`);
    }
  }

  // 2) Get the goods detail itself, see if it embeds composition
  console.log('\n--- Goods #' + TARGET_GOODS_ID + ' detail probe ---');
  const detailPaths = [
    `/api/query/Goods`,
    `/api/goods/${TARGET_GOODS_ID}`,
    `/api/goods/${TARGET_GOODS_ID}/composition`,
    `/api/goods/${TARGET_GOODS_ID}/structure`,
    `/api/goods/${TARGET_GOODS_ID}/bom`,
    `/api/composition/Goods/${TARGET_GOODS_ID}`,
  ];
  for (const p of detailPaths) {
    try {
      const isQuery = p.includes('/api/query/');
      const r = await call(p, isQuery ? { id: TARGET_GOODS_ID } : null, isQuery ? 'POST' : 'GET');
      if (r.status === 200) {
        console.log(`✅ ${p} → 200`);
        console.log(`   ${preview(r.body, 1200)}\n`);
      } else if (r.status === 404) {
        // skip
      } else {
        console.log(`?  ${p} → ${r.status} — ${preview(r.body, 150)}`);
      }
    } catch (e) {
      console.log(`!  ${p} → ${e.message}`);
    }
  }

  // 3) Try query with filter on Goods id (most common Factorify pattern)
  console.log('\n--- Filtered Goods query ---');
  for (const filter of [
    { id: TARGET_GOODS_ID },
    { ID: TARGET_GOODS_ID },
    { filter: { id: TARGET_GOODS_ID } },
    { filters: [{ field: 'id', value: TARGET_GOODS_ID }] },
  ]) {
    try {
      const r = await call('/api/query/Goods', filter);
      console.log(`Goods filter=${JSON.stringify(filter).substring(0, 80)} → ${r.status} (${(r.body || '').length} chars)`);
      if (r.status === 200 && (r.body || '').length < 4000) {
        console.log(`   ${preview(r.body, 2000)}`);
      }
    } catch (e) {
      console.log(`!  ${e.message}`);
    }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
