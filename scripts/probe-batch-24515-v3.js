// Probe v3: použij client.service který umí extractRows
require('dotenv').config();
const fy = require('../services/factorify/client.service');

async function main() {
  console.log('=== POST /api/query/WorkflowOperation no-filter ===');
  const t0 = Date.now();
  const rows = await fy.query('WorkflowOperation', { limit: 10000 }, { timeoutMs: 120000, retries: 0 });
  console.log('  rows: ' + rows.length + ' za ' + (Date.now() - t0) + ' ms');

  // Najdi všechny WO patřící workflowEntity 4177 (= dávka 24515)
  const ours = rows.filter(function (r) { return Number(r?.workflowEntity?.id) === 4177; })
    .sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

  console.log('\n=== Operace dávky 24515 (workflowEntity 4177) ===');
  console.log('  Nalezeno: ' + ours.length);
  ours.forEach(function (op, i) {
    const name = typeof op.operationName === 'object'
      ? (op.operationName['2'] || op.operationName['1'] || JSON.stringify(op.operationName).slice(0, 30))
      : op.operationName;
    const bom = Array.isArray(op.billOfMaterialsItems)
      ? op.billOfMaterialsItems.length
      : (op.billOfMaterialsItems == null ? 'null' : '<other>');
    console.log('    [' + i + '] pos=' + op.position + ' id=' + op.id + ' name="' + name + '" bom=' + bom + ' workplace="' + (op.stage?.referenceName || '?') + '"');
  });

  // Pro každou operaci, která má bom=null, zkusíme ji znovu vytáhnout přes různé endpointy
  console.log('\n=== Pokus o BOM hydraci pro každou operaci ===');
  for (const op of ours.slice(0, 2)) { // Jen první 2 ať to netrvá dlouho
    console.log('  --- op ' + op.id + ' ---');
    // Cesta 1: přes batch.workflowOperation se BOM populuje (víme z 24515: 2 items)
    // Pokud OP ma billOfMaterialsItems=null v query, můžeme zkusit:
    //   POST /api/query/OperationBillOfMaterialsItem s filtrem na operation.id
    const bomQueries = ['OperationBillOfMaterialsItem', 'OperationBomItem', 'WorkflowOperationBomItem'];
    for (const ent of bomQueries) {
      try {
        const t = Date.now();
        const items = await fy.query(ent, { limit: 100 }, { timeoutMs: 30000, retries: 0 });
        const matched = items.filter(function (r) { return Number(r?.operation?.id) === Number(op.id); });
        console.log('    ' + ent + ': total=' + items.length + ', matched op ' + op.id + '=' + matched.length + ' (' + (Date.now() - t) + ' ms)');
        if (matched.length > 0) {
          console.log('      sample: ' + JSON.stringify(matched[0]).slice(0, 250));
          break;
        }
      } catch (e) {
        console.log('    ' + ent + ': ' + e.message.slice(0, 80));
      }
    }
  }
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });
