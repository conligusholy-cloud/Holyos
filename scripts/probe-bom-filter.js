// Otestuj, jestli FY OperationBillOfMaterialsItem akceptuje server-side filter
// na operation.id. Pridavame VZDY limit 100, aby ani neuspesny filter nestahnul
// 453 MB.
//
// Interpretace vysledku:
//   - 2 rows + matched 2  -> filter FUNGUJE (op 5033 ma 2 BOM)
//   - 100 rows + matched 0 -> filter neaplikoval, server vratil prvnich 100
//   - 100 rows + matched 2 -> filter neaplikoval, ale nahodou jsou nase v top 100

require('dotenv').config();
const fy = require('./../services/factorify/client.service');

const TARGET_OP = 5033;

const VARIANTS = [
  { label: 'limit only', body: { limit: 100 } },
  { label: 'limit + operation.id', body: { limit: 100, 'operation.id': TARGET_OP } },
  { label: 'limit + operation={id}', body: { limit: 100, operation: { id: TARGET_OP } } },
  { label: 'limit + filter.operation.id', body: { limit: 100, filter: { 'operation.id': TARGET_OP } } },
  { label: 'limit + where.operation.id', body: { limit: 100, where: { 'operation.id': TARGET_OP } } },
  { label: 'limit + operationId', body: { limit: 100, operationId: TARGET_OP } },
  { label: 'limit + operation_id', body: { limit: 100, operation_id: TARGET_OP } },
];

async function main() {
  console.log('Cilove operation.id =', TARGET_OP, '(ma 2 BOM polozky podle UI)');
  console.log('');

  for (const v of VARIANTS) {
    process.stdout.write('  ' + v.label.padEnd(40) + ' ');
    try {
      const t0 = Date.now();
      const rows = await fy.query('OperationBillOfMaterialsItem', v.body, { timeoutMs: 30000, retries: 0 });
      const matched = rows.filter(function (r) { return Number(r && r.operation && r.operation.id) === TARGET_OP; });
      const elapsed = Date.now() - t0;
      let marker;
      if (rows.length <= 5 && matched.length === rows.length && rows.length > 0) {
        marker = '[OK] FILTR FUNGUJE (' + rows.length + ' rows = pouze matchy)';
      } else if (rows.length === 100) {
        marker = '[--] jen limit (filtr ignored)';
      } else {
        marker = '[??] rows ' + rows.length + ' / matched ' + matched.length;
      }
      console.log(rows.length + ' rows, matched ' + matched.length + ', ' + elapsed + ' ms -- ' + marker);
    } catch (e) {
      console.log('[FAIL] ' + e.message.slice(0, 100));
    }
    await new Promise(function (r) { setTimeout(r, 200); });
  }
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });
