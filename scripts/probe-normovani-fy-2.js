// =============================================================================
// HolyOS — Probe #2 pro modul Normování
// =============================================================================
// Cíle:
//   1) Najít server-side filtr pro Batch (vyhnout se 94 MB pull každé volání)
//      a) GET /api/Batch/{id} — direct by-id (id == number?)
//      b) POST /api/query/Batch s různými body filtry (id, number, paging)
//   2) Stáhnout WorkflowOperation pro workflow.id 4448 a OVĚŘIT, že
//      billOfMaterialsItems je populované (per-batch) — to je hlavní zjištění.
//   3) Stáhnout ItemWorkflowOperation pro goods 3636 (BS-S-0381) jako
//      srovnávací dataset (template).
//
// Vstupy z probe #1:
//   Batch:    22965, goods.id 3636, workflow.id 4448, workflowOperation.id 5141
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const fy = require('../services/factorify/client.service');

const OUT_DIR = path.join(__dirname, '..', 'data', 'factorify-probe');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

const BATCH_ID = 22965;
const WORKFLOW_ID = 4448;          // Batch.workflow.id
const WORKFLOW_OPERATION_ID = 5141; // Batch.workflowOperation.id (current)
const GOODS_ID = 3636;              // Batch.goods.id

function dumpJson(name, data) {
  const p = path.join(OUT_DIR, `normovani-${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// Raw HTTPS — pro GET /api/<entity>/{id} (client.service má jen query/metadata)
function rawGet(urlPath) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, BASE_URL);
    const opts = {
      hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''),
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': ACCT,
        'X-FySerialization': 'ui2',
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, raw: text, length: text.length });
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

async function probeDirectBatch() {
  console.log('\n=== 1a) GET /api/Batch/{id} direct ===');
  const tries = [
    `/api/Batch/${BATCH_ID}`,
    `/api/batch/${BATCH_ID}`,
    `/api/Batch/22965`,
  ];
  for (const p of tries) {
    process.stdout.write(`  ${p.padEnd(36)} `);
    const r = await rawGet(p);
    if (r.status === 200 && r.body) {
      const id = r.body?.id ?? '?';
      const num = r.body?.number ?? '?';
      console.log(`✓ HTTP 200 (${r.length} chars) — id=${id} number=${num}`);
      dumpJson(`get-Batch-${BATCH_ID}`, r.body);
      return r.body;
    }
    console.log(`✗ HTTP ${r.status} ${(r.raw || r.error || '').slice(0, 100)}`);
  }
  return null;
}

async function probeBatchPagination() {
  console.log('\n=== 1b) POST /api/query/Batch s různými body filtry ===');
  const variants = [
    { label: 'id=22965', body: { id: BATCH_ID } },
    { label: 'number=22965', body: { number: BATCH_ID } },
    { label: 'number="22965"', body: { number: String(BATCH_ID) } },
    { label: 'limit=5', body: { limit: 5 } },
    { label: 'paging.limit=5', body: { paging: { limit: 5 } } },
    { label: 'paging.size=5', body: { paging: { size: 5 } } },
    { label: 'paging.count=5', body: { paging: { count: 5 } } },
    { label: 'where.id', body: { where: { id: BATCH_ID } } },
    { label: 'filter.id', body: { filter: { id: BATCH_ID } } },
    { label: 'ids=[22965]', body: { ids: [BATCH_ID] } },
  ];
  for (const v of variants) {
    process.stdout.write(`  ${v.label.padEnd(28)} `);
    try {
      const t0 = Date.now();
      const rows = await fy.query('Batch', v.body, { retries: 0, timeoutMs: 60000 });
      const elapsed = Date.now() - t0;
      const matched = rows.filter(r => Number(r.id) === BATCH_ID);
      const marker = rows.length === 1 ? '✅ FILTR funguje (1 row)'
                    : rows.length < 100 ? `✅ funguje (${rows.length} rows)`
                    : '◯ ignored (full list)';
      console.log(`${rows.length} rows, matched=${matched.length}, ${elapsed} ms ${marker}`);
    } catch (e) {
      console.log(`✗ ${String(e.message).split('\n')[0].slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

async function probeWorkflowOperationByEntity() {
  console.log('\n=== 2) WorkflowOperation pro workflow.id ' + WORKFLOW_ID + ' ===');
  // Zkusíme stáhnout všechny WO (může být velké) a klientsky vyfiltrovat
  try {
    const t0 = Date.now();
    const rows = await fy.query('WorkflowOperation', { limit: 5000 }, { timeoutMs: 120000, retries: 0 });
    console.log(`  ✓ celkem ${rows.length} WO za ${Date.now() - t0} ms`);
    const matched = rows.filter(r => Number(r?.workflowEntity?.id) === WORKFLOW_ID);
    console.log(`  → workflowEntity.id=${WORKFLOW_ID} matched: ${matched.length}`);
    if (matched.length > 0) {
      // Setřid podle position
      matched.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const summary = matched.map(o => ({
        id: o.id,
        position: o.position,
        operationName: o.operationName,
        bomItemCount: Array.isArray(o.billOfMaterialsItems) ? o.billOfMaterialsItems.length : (o.billOfMaterialsItems ? '<obj>' : null),
        bomItemsType: typeof o.billOfMaterialsItems,
      }));
      console.log('\n  Operace dávky 22965 (workflow 4448):');
      summary.forEach(s => console.log(`    [${s.position}] ${s.operationName} (id=${s.id}) — BOM=${s.bomItemCount} (${s.bomItemsType})`));
      dumpJson('workflowoperation-batch-22965', matched);
      // Vypiš první BOM item pro inspekci tvaru
      const withBom = matched.find(o => Array.isArray(o.billOfMaterialsItems) && o.billOfMaterialsItems.length > 0);
      if (withBom) {
        console.log(`\n  Vzorek BOM z operace ${withBom.operationName}:`);
        console.log('  ' + JSON.stringify(withBom.billOfMaterialsItems[0], null, 2).split('\n').join('\n  '));
        dumpJson('workflowoperation-bom-sample', withBom.billOfMaterialsItems[0]);
      } else {
        console.log('\n  ⚠ ŽÁDNÁ z operací dávky nemá billOfMaterialsItems naplněné!');
        console.log('  → BOM bude potřeba doplnit z ItemWorkflowOperation (template)');
      }
    }
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
}

async function probeItemWorkflowOperationForGoods() {
  console.log('\n=== 3) ItemWorkflowOperation pro goods.id ' + GOODS_ID + ' ===');
  try {
    const t0 = Date.now();
    const rows = await fy.query('ItemWorkflowOperation', { limit: 5000 }, { timeoutMs: 120000, retries: 0 });
    console.log(`  ✓ celkem ${rows.length} IWO za ${Date.now() - t0} ms`);
    if (rows.length > 0) {
      // Zkus najít, kde sídlí goods reference
      const sample = rows[0];
      console.log('  klíče prvního: ' + Object.keys(sample).join(', '));
      // Zkus různé cesty pro goods
      const paths = [
        ['workflowEntity', 'goods', 'id'],
        ['itemWorkflow', 'goods', 'id'],
        ['goods', 'id'],
        ['workflow', 'goods', 'id'],
      ];
      for (const p of paths) {
        const matched = rows.filter(r => {
          let cur = r;
          for (const key of p) cur = cur?.[key];
          return Number(cur) === GOODS_ID;
        });
        console.log(`  cesta ${p.join('.')}: matched ${matched.length}`);
      }
      // Vypiš workflowEntity 1. řádku
      console.log('\n  Vzorek workflowEntity:');
      console.log('  ' + JSON.stringify(sample.workflowEntity, null, 2).split('\n').slice(0, 8).join('\n  '));
      dumpJson('itemworkflowoperation-sample-full', rows.slice(0, 3));
    }
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
}

async function main() {
  console.log('Konfigurace:', fy.getConfig());
  await probeDirectBatch();
  await probeBatchPagination();
  await probeWorkflowOperationByEntity();
  await probeItemWorkflowOperationForGoods();
  console.log('\n📁 data/factorify-probe/normovani-*.json');
}

main().catch(e => { console.error(e); process.exit(1); });
