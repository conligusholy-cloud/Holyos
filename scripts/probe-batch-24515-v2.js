// Probe v2: zjisti, jak dotáhnout VŠECHNY operace dávky 24515 + jejich BOM,
// když workflow je null ale workflowEntity.id existuje (4177).
require('dotenv').config();
const https = require('https');

const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

function call(method, path, body) {
  return new Promise(function (resolve) {
    const opts = {
      hostname: 'bs.factorify.cloud', port: 443, path: path, method: method,
      headers: {
        Accept: 'application/json',
        Cookie: 'securityToken=' + TOKEN,
        'X-AccountingUnit': ACCT,
        'X-FySerialization': 'ui2',
      },
    };
    const post = body ? JSON.stringify(body) : null;
    if (post) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(post);
    }
    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, data: data, raw: text.slice(0, 200) });
      });
    });
    req.on('error', function () { resolve({ status: 0 }); });
    req.setTimeout(30000, function () { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (post) req.write(post);
    req.end();
  });
}

async function main() {
  const candidates = [
    { method: 'GET', path: '/api/workflowoperation/5033' },
    { method: 'GET', path: '/api/itemworkflowoperation/5033' },
    { method: 'GET', path: '/api/workflow/4177' },
    { method: 'GET', path: '/api/itemworkflow/4177' },
  ];

  console.log('=== Direct GETs ===');
  for (const c of candidates) {
    const r = await call(c.method, c.path);
    let info = 'HTTP ' + r.status;
    if (r.status === 200 && r.data) {
      const d = r.data;
      info += ' — keys: ' + Object.keys(d).slice(0, 12).join(', ');
      if (Array.isArray(d.operations)) info += ' / operations: ' + d.operations.length;
      if (Array.isArray(d.billOfMaterialsItems)) info += ' / bom: ' + d.billOfMaterialsItems.length;
    } else if (r.raw) {
      info += ' — ' + r.raw.replace(/\s+/g, ' ').slice(0, 100);
    }
    console.log('  ' + c.method + ' ' + c.path + ' → ' + info);
  }

  console.log('\n=== POST /api/query/WorkflowOperation (filter workflowEntity.id=4177) ===');
  const queries = [
    {},
    { 'workflowEntity.id': 4177 },
    { workflowEntity: { id: 4177 } },
    { filter: { 'workflowEntity.id': 4177 } },
    { where: { 'workflowEntity.id': 4177 } },
  ];
  for (const q of queries) {
    const r = await call('POST', '/api/query/WorkflowOperation', q);
    let info = 'HTTP ' + r.status;
    if (Array.isArray(r.data)) {
      const matched = r.data.filter(function (row) { return row?.workflowEntity?.id === 4177; });
      info += ' — total: ' + r.data.length + ' / matched workflowEntity 4177: ' + matched.length;
      if (matched.length > 0) {
        const m = matched[0];
        info += ' / first op id ' + m.id + ' name "' + (typeof m.operationName === 'object' ? (m.operationName['2'] || JSON.stringify(m.operationName)) : m.operationName) + '"';
        info += ' / bom: ' + (Array.isArray(m.billOfMaterialsItems) ? m.billOfMaterialsItems.length : m.billOfMaterialsItems);
      }
    }
    console.log('  body=' + JSON.stringify(q) + ' → ' + info);
    await new Promise(function (r) { setTimeout(r, 200); });
  }

  console.log('\n=== Pokus: získat všechny operace dávky 4177 přes batch.workflowOperation lookup ===');
  // Strategie: batch.workflowOperation.workflowEntity.id => POST /api/query/WorkflowOperation no-filter,
  // klientsky vyfiltrovat všechny WO s tím workflowEntity.id, setřídit podle position.
  const all = await call('POST', '/api/query/WorkflowOperation', {});
  if (Array.isArray(all.data)) {
    const ours = all.data.filter(function (r) { return r?.workflowEntity?.id === 4177; })
      .sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    console.log('  Operací s workflowEntity 4177: ' + ours.length);
    ours.forEach(function (op) {
      const name = typeof op.operationName === 'object' ? (op.operationName['2'] || JSON.stringify(op.operationName).slice(0, 30)) : op.operationName;
      const bom = Array.isArray(op.billOfMaterialsItems) ? op.billOfMaterialsItems.length : (op.billOfMaterialsItems == null ? 'null' : '<other>');
      console.log('    pos=' + op.position + ' id=' + op.id + ' name="' + name + '" bom=' + bom);
    });
  }
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });
