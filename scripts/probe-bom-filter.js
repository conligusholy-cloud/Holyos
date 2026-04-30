// Otestuj, jestli FY OperationBillOfMaterialsItem akceptuje server-side filter
// na operation.id — pokud ano, můžeme se vyhnout 40s full stream pullu.
require('dotenv').config();
const fy = require('./../services/factorify/client.service');

const TARGET_OP = 5033; // op s 2 BOM items (Nálepky I dávky 24515)

async function main() {
  const variants = [
    { label: 'no-filter limit 5', body: { limit: 5 } },
    { label: 'operation.id=5033', body: { 'operation.id': TARGET_OP } },
    { label: 'operation={id:5033}', body: { operation: { id: TARGET_OP } } },
    { label: 'filter.operation.id=5033', body: { filter: { 'operation.id': TARGET_OP } } },
    { label: 'where.operation.id=5033', body: { where: { 'operation.id': TARGET_OP } } },
    { label: 'operationId=5033', body: { operationId: TARGET_OP } },
    { label: 'operation_id=5033', body: { operation_id: TARGET_OP } },
  ];

  for (const v of variants) {
    process.stdout.write('  ' + v.label.padEnd(36) + ' ');
    try {
      const t0 = Date.now();
      const rows = await fy.query('OperationBillOfMaterialsItem', v.body, { timeoutMs: 30000, retries: 0 });
      const matched = rows.filter(function (r) { return Number(r && r.operation && r.operation.id) === TARGET_OP; });
      const marker = rows.length === matched.length && rows.length > 0 ? '✓ FILTR funguje'
                    : rows.length === 5 ? '◯ jen limit'
                    : rows.length === matched.length ? '? both 0'
                    : (matched.length > 0 ? '◯ partial (limit nebo no filter)' : '◯ no match in subset');
      console.log(rows.length + ' rows, matched ' + matched.length + ', ' + (Date.now() - t0) + ' ms ' + marker);
    } catch (e) {
      console.log('✗ ' + e.message.slice(0, 100));
    }
    await new Promise(function (r) { setTimeout(r, 200); });
  }
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });
