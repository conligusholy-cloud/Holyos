// Quick probe: vytáhne RAW FY response pro batch 24515 a vypíše strukturu,
// ať vidím, kudy se k operacím dostat když `workflow` je null.
require('dotenv').config();
const https = require('https');

const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

function rawGet(path) {
  return new Promise(function (resolve, reject) {
    const opts = {
      hostname: 'bs.factorify.cloud', port: 443, path: path, method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: 'securityToken=' + TOKEN,
        'X-AccountingUnit': ACCT,
        'X-FySerialization': 'ui2',
      },
    };
    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  const argId = process.argv[2] || '24515';
  console.log('GET /api/batch/' + argId);
  const r = await rawGet('/api/batch/' + argId);
  if (r.status !== 200) { console.log('HTTP', r.status); return; }
  const d = r.data;
  console.log('  released:', d.released);
  console.log('  finished:', d.finished);
  console.log('  goods.id:', d.goods?.id, ' code:', d.goods?.code);
  console.log('  goods top keys:', Object.keys(d.goods || {}).slice(0, 30).join(', '));
  console.log('  workflow:', d.workflow ? 'present (id=' + d.workflow.id + ')' : 'NULL');
  if (d.workflow) {
    console.log('    workflow.operations:', Array.isArray(d.workflow.operations) ? d.workflow.operations.length : 'not array');
  }
  const co = d.workflowOperation;
  console.log('  workflowOperation:');
  console.log('    id:', co?.id);
  console.log('    operationName:', co?.operationName);
  console.log('    workflowEntity:', co?.workflowEntity ? JSON.stringify(co.workflowEntity).slice(0, 200) : null);
  console.log('    billOfMaterialsItems:', Array.isArray(co?.billOfMaterialsItems) ? co.billOfMaterialsItems.length + ' items' : co?.billOfMaterialsItems);

  // Pokus o GET /api/goods/{goodsId} — možná template workflow
  const goodsId = d.goods?.id;
  if (goodsId) {
    console.log('\nGET /api/goods/' + goodsId);
    const g = await rawGet('/api/goods/' + goodsId);
    if (g.status === 200) {
      console.log('  goods top keys:', Object.keys(g.data).slice(0, 50).join(', '));
      console.log('  itemWorkflow:', g.data.itemWorkflow ? 'present (id=' + g.data.itemWorkflow.id + ')' : 'NULL');
      if (g.data.itemWorkflow?.operations) {
        console.log('    operations count:', g.data.itemWorkflow.operations.length);
        console.log('    first op keys:', Object.keys(g.data.itemWorkflow.operations[0]).join(', '));
        const firstOp = g.data.itemWorkflow.operations[0];
        console.log('    first op bom:', Array.isArray(firstOp.billOfMaterialsItems) ? firstOp.billOfMaterialsItems.length + ' items' : firstOp.billOfMaterialsItems);
        if (Array.isArray(firstOp.billOfMaterialsItems) && firstOp.billOfMaterialsItems.length > 0) {
          console.log('    first bom item:', JSON.stringify(firstOp.billOfMaterialsItems[0]).slice(0, 300));
        }
      }
      // Najdi další pole co může držet workflow:
      const wfKeys = Object.keys(g.data).filter(function (k) { return /workflow|process|operation/i.test(k); });
      console.log('  goods workflow-like keys:', wfKeys.join(', '));
    } else {
      console.log('  HTTP', g.status);
    }
  }

  // Pokus: GET /api/workflowoperation/{currentOpId}
  if (co?.id) {
    console.log('\nGET /api/workfloworation/' + co.id);
    const op = await rawGet('/api/workfloworation/' + co.id);
    console.log('  HTTP', op.status);
    if (op.status === 200) {
      const opd = op.data;
      console.log('  bom:', Array.isArray(opd.billOfMaterialsItems) ? opd.billOfMaterialsItems.length : opd.billOfMaterialsItems);
      console.log('  workflowEntity:', opd.workflowEntity ? JSON.stringify(opd.workflowEntity).slice(0, 200) : null);
    }
  }
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });
