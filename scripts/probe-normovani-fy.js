// =============================================================================
// HolyOS — Probe Factorify entit pro modul Normování
// =============================================================================
// Cíl: potvrdit přesné názvy entit + tvar query body pro:
//   1) Batch         — výrobní dávka (filtr na číslo dávky)
//   2) ItemWorkflowOperation — operace pracovního postupu (filtr na goods)
//   3) ??BOM??       — položky kusovníku NA OPERACI (kandidáti viz CANDIDATE_BOM_ENTITIES)
//
// Výstup: data/factorify-probe/normovani-*.json + souhrn _normovani-summary.md
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fy = require('../services/factorify/client.service');

const OUT_DIR = path.join(__dirname, '..', 'data', 'factorify-probe');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Z UI screenshotu: dávka číslo 22965 (BS-S-0381 RÁM komplet) — single record, malý
const SAMPLE_BATCH_NUMBER = 22965;
// Goods 2942 (BS-M-4520 Prádlomat - V Akceptory) — má kompletní postup z UI
const SAMPLE_GOODS_ID = 2942;
// Operace 4982 (Monitor a PC) z UI screenshotu — má 14 položek BOM
const SAMPLE_WORKFLOW_OPERATION_ID = 4982;

const ENTITIES_FOR_METADATA = [
  'Batch',
  'ItemWorkflowOperation',
  'WorkflowOperation',
  'ItemWorkflow',
  // Kandidáti na per-operation BOM
  'WorkflowOperationBomItem',
  'OperationBomItem',
  'ItemWorkflowOperationBomItem',
  'WorkflowOperationItem',
  'OperationItem',
  // Reference (pro porovnání)
  'BillOfMaterialItem',
];

function dumpJson(name, data) {
  const p = path.join(OUT_DIR, `normovani-${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function safeFieldList(metadata) {
  if (!metadata) return [];
  if (Array.isArray(metadata.fields)) {
    return metadata.fields.map(f => `${f.name || f.code || '?'}: ${f.type || f.dataType || '?'}${f.referenceEntity ? ` → ${f.referenceEntity}` : ''}`);
  }
  if (metadata.properties && typeof metadata.properties === 'object') {
    return Object.entries(metadata.properties).map(([k, v]) => `${k}: ${v?.type || '?'}`);
  }
  return [];
}

async function probeMetadata() {
  console.log('\n=== METADATA ===');
  const results = {};
  for (const entity of ENTITIES_FOR_METADATA) {
    process.stdout.write(`  ${entity.padEnd(36)} `);
    try {
      const md = await fy.metadata(entity);
      const fields = safeFieldList(md);
      dumpJson(`metadata-${entity}`, md);
      console.log(`✓ ${fields.length} polí`);
      results[entity] = { ok: true, fieldCount: fields.length, fields };
    } catch (e) {
      const msg = String(e.message || e).split('\n')[0].slice(0, 120);
      console.log(`✗ ${msg}`);
      results[entity] = { ok: false, error: msg };
    }
  }
  return results;
}

async function probeBatch() {
  console.log('\n=== BATCH (číslo = ' + SAMPLE_BATCH_NUMBER + ') ===');
  // Zkusíme různé tvary filtru — Factorify Stage API obvykle žere { filter: ... } nebo
  // přímo pole hodnot.
  const attempts = [
    { label: 'no-filter (full list, limit pomocí skipu/take)', body: { take: 5 } },
    { label: 'filter.number =', body: { filter: { number: SAMPLE_BATCH_NUMBER }, take: 5 } },
    { label: 'where.number =', body: { where: { number: SAMPLE_BATCH_NUMBER } } },
    { label: 'filters[number] = (UI grid style)', body: { filters: [{ field: 'number', op: '=', value: SAMPLE_BATCH_NUMBER }] } },
  ];
  for (const a of attempts) {
    process.stdout.write(`  ${a.label.padEnd(50)} `);
    try {
      const rows = await fy.query('Batch', a.body, { retries: 0, timeoutMs: 30000 });
      const matched = rows.filter(r => Number(r.number ?? r.cislo) === SAMPLE_BATCH_NUMBER);
      console.log(`✓ ${rows.length} rows (matched=${matched.length})`);
      if (rows.length > 0) {
        dumpJson(`batch-sample-${a.label.replace(/\W+/g, '_')}`, rows.slice(0, 3));
      }
      if (matched.length > 0) {
        dumpJson('batch-MATCHED', matched);
        return matched[0];
      }
    } catch (e) {
      console.log(`✗ ${String(e.message).split('\n')[0].slice(0, 100)}`);
    }
  }
  return null;
}

async function probeOperationsForGoods(goodsId) {
  console.log('\n=== ItemWorkflowOperation (goods.id = ' + goodsId + ') ===');
  const attempts = [
    { label: 'no-filter (limit 1000)', body: { take: 1000 } },
    { label: 'filter.itemWorkflow.goods.id', body: { filter: { 'itemWorkflow.goods.id': goodsId } } },
    { label: 'filter.itemWorkflow.goods', body: { filter: { 'itemWorkflow.goods': { id: goodsId } } } },
  ];
  for (const a of attempts) {
    process.stdout.write(`  ${a.label.padEnd(50)} `);
    try {
      const rows = await fy.query('ItemWorkflowOperation', a.body, { retries: 0, timeoutMs: 60000 });
      // Filtruj klientsky podle goods
      const matched = rows.filter(r => {
        const w = r.itemWorkflow || r.workflow || {};
        const g = w?.goods || w?.product || {};
        return Number(g?.id) === goodsId;
      });
      console.log(`✓ ${rows.length} rows (klientsky matched=${matched.length})`);
      if (matched.length > 0) {
        dumpJson('itemworkflowoperation-MATCHED', matched);
        return matched;
      } else if (rows.length > 0 && rows.length < 50) {
        dumpJson(`itemworkflowoperation-sample`, rows.slice(0, 3));
      }
    } catch (e) {
      console.log(`✗ ${String(e.message).split('\n')[0].slice(0, 100)}`);
    }
  }
  return [];
}

async function probeBomForOperation(opId) {
  console.log('\n=== Per-operation BOM (workflowOperation.id = ' + opId + ') ===');
  const candidates = [
    'WorkflowOperationBomItem',
    'OperationBomItem',
    'ItemWorkflowOperationBomItem',
    'WorkflowOperationItem',
    'OperationItem',
  ];
  for (const entity of candidates) {
    process.stdout.write(`  ${entity.padEnd(36)} `);
    try {
      const rows = await fy.query(entity, { take: 50 }, { retries: 0, timeoutMs: 30000 });
      console.log(`✓ ${rows.length} rows`);
      if (rows.length > 0) {
        dumpJson(`bom-${entity}-sample`, rows.slice(0, 3));
      }
    } catch (e) {
      console.log(`✗ ${String(e.message).split('\n')[0].slice(0, 100)}`);
    }
  }
  // Pro jistotu zkus BillOfMaterialItem s referencí na operaci
  try {
    process.stdout.write(`  BillOfMaterialItem (search workflowOp ref) `);
    const rows = await fy.query('BillOfMaterialItem', { take: 50 }, { retries: 0, timeoutMs: 30000 });
    const sample = rows[0] || {};
    const opRefKey = Object.keys(sample).find(k => /workflow|operation/i.test(k));
    console.log(`→ první klíč s 'workflow|operation' = ${opRefKey || '(žádný)'}`);
    if (sample) dumpJson('bom-billofmaterialitem-sample', rows.slice(0, 3));
  } catch (e) {
    console.log(`✗ ${String(e.message).split('\n')[0].slice(0, 100)}`);
  }
}

async function main() {
  console.log('Konfigurace:', fy.getConfig());
  const meta = await probeMetadata();
  const batchSample = await probeBatch();
  if (batchSample) {
    console.log(`\n  → Batch ${SAMPLE_BATCH_NUMBER} klíče: ${Object.keys(batchSample).join(', ')}`);
  }
  await probeOperationsForGoods(SAMPLE_GOODS_ID);
  await probeBomForOperation(SAMPLE_WORKFLOW_OPERATION_ID);

  // Souhrn
  const summaryLines = [
    `# Normování FY probe — ${new Date().toISOString()}`,
    ``,
    `Cílový průzkum entit pro modul \`modules/normovani-fy\`.`,
    ``,
    `## Metadata results`,
    ``,
  ];
  for (const [entity, r] of Object.entries(meta)) {
    if (r.ok) {
      summaryLines.push(`### ${entity} ✓ (${r.fieldCount} polí)`);
      r.fields.slice(0, 40).forEach(f => summaryLines.push(`- ${f}`));
      if (r.fields.length > 40) summaryLines.push(`- ... +${r.fields.length - 40} dalších`);
      summaryLines.push('');
    } else {
      summaryLines.push(`### ${entity} ✗ ${r.error}`);
      summaryLines.push('');
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, '_normovani-summary.md'), summaryLines.join('\n'));
  console.log(`\n📄 data/factorify-probe/_normovani-summary.md`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
