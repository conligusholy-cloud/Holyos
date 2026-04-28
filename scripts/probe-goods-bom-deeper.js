// HolyOS — Hlubší probe: zjisti, jak Factorify naplní billOfMaterialItems pro Goods #2942.
// Spuštění: node scripts/probe-goods-bom-deeper.js
require('dotenv').config();
const https = require('https');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const TARGET = 2942;

function call(path, body, method, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : '';
    const headers = {
      'Accept': 'application/json',
      'Cookie': `securityToken=${TOKEN}`,
      'X-AccountingUnit': '1',
      ...(extraHeaders || {}),
    };
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''),
      method: method || (postData ? 'POST' : 'GET'), headers,
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

function summarize(data) {
  if (!data) return '(empty)';
  let obj;
  try { obj = JSON.parse(data); } catch { return `RAW (${data.length} chars): ${data.substring(0, 300)}`; }
  // Najdi 'billOfMaterialItems' kdekoli ve struktuře
  let found = null;
  function walk(o, path) {
    if (!o || typeof o !== 'object' || found) return;
    if (Array.isArray(o)) { o.slice(0, 3).forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const k of Object.keys(o)) {
      if (k === 'billOfMaterialItems') {
        found = { path: `${path}.${k}`, value: o[k] };
        return;
      }
      walk(o[k], `${path}.${k}`);
    }
  }
  walk(obj, 'root');
  if (!found) return `OK (${data.length} chars), no billOfMaterialItems anywhere`;
  if (Array.isArray(found.value)) {
    return `✅ FOUND ${found.path} = Array[${found.value.length}]` +
      (found.value.length > 0 ? `\n   sample: ${JSON.stringify(found.value[0]).substring(0, 800)}` : ' (empty)');
  }
  return `FOUND ${found.path} = ${typeof found.value}: ${JSON.stringify(found.value).substring(0, 200)}`;
}

(async () => {
  const cases = [
    // Zkus bez X-FySerialization
    { label: 'GET /api/goods/2942 (no FySerialization)', path: `/api/goods/${TARGET}`, hdr: {} },
    // Různé hodnoty X-FySerialization
    { label: 'GET /api/goods/2942 (FySerialization: full)', path: `/api/goods/${TARGET}`, hdr: { 'X-FySerialization': 'full' } },
    { label: 'GET /api/goods/2942 (FySerialization: default)', path: `/api/goods/${TARGET}`, hdr: { 'X-FySerialization': 'default' } },
    { label: 'GET /api/goods/2942 (FySerialization: complete)', path: `/api/goods/${TARGET}`, hdr: { 'X-FySerialization': 'complete' } },
    { label: 'GET /api/goods/2942 (FySerialization: deep)', path: `/api/goods/${TARGET}`, hdr: { 'X-FySerialization': 'deep' } },
    // Specifické sub-endpointy
    { label: 'GET /api/goods/2942/bom', path: `/api/goods/${TARGET}/bom`, hdr: {} },
    { label: 'GET /api/goods/2942/billOfMaterialItems', path: `/api/goods/${TARGET}/billOfMaterialItems`, hdr: {} },
    { label: 'GET /api/goods/2942/billOfMaterials', path: `/api/goods/${TARGET}/billOfMaterials`, hdr: {} },
    { label: 'GET /api/goods/2942/composition', path: `/api/goods/${TARGET}/composition`, hdr: {} },
    { label: 'GET /api/goods/2942/structure', path: `/api/goods/${TARGET}/structure`, hdr: {} },
    // Query
    { label: 'POST /api/query/BillOfMaterialItem', path: `/api/query/BillOfMaterialItem`, body: {}, hdr: { 'X-FySerialization': 'ui2' } },
    { label: 'POST /api/query/BillOfMaterial', path: `/api/query/BillOfMaterial`, body: {}, hdr: { 'X-FySerialization': 'ui2' } },
    { label: 'POST /api/query/BomItem (ui2)', path: `/api/query/BomItem`, body: {}, hdr: { 'X-FySerialization': 'ui2' } },
    // Goods + include parameter
    { label: 'GET /api/goods/2942?include=billOfMaterialItems', path: `/api/goods/${TARGET}?include=billOfMaterialItems`, hdr: { 'X-FySerialization': 'ui2' } },
    { label: 'GET /api/goods/2942?expand=billOfMaterialItems', path: `/api/goods/${TARGET}?expand=billOfMaterialItems`, hdr: { 'X-FySerialization': 'ui2' } },
    // Možná je to pod ImportedBomItem nebo BomGoodsItem
    { label: 'POST /api/query/ImportedBom', path: `/api/query/ImportedBom`, body: {}, hdr: { 'X-FySerialization': 'ui2' } },
    { label: 'POST /api/query/ImportedBomGoods', path: `/api/query/ImportedBomGoods`, body: {}, hdr: { 'X-FySerialization': 'ui2' } },
    { label: 'POST /api/query/Bom', path: `/api/query/Bom`, body: {}, hdr: {} },
  ];

  for (const c of cases) {
    try {
      const r = await call(c.path, c.body, c.body ? 'POST' : 'GET', c.hdr);
      console.log(`\n${c.label}`);
      console.log(`  HTTP ${r.status}`);
      if (r.status === 200) console.log(`  ${summarize(r.body)}`);
      else if (r.status === 404) console.log('  (404 — nenalezeno)');
      else console.log(`  ${r.body.substring(0, 200)}`);
    } catch (e) {
      console.log(`\n${c.label}\n  ! ${e.message}`);
    }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
