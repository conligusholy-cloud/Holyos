// Probe v4: stáhni VŠECHNY OperationBillOfMaterialsItem a najdi BOM pro op 5033/5038
require('dotenv').config();
const fy = require('../services/factorify/client.service');

async function main() {
  console.log('=== POST /api/query/OperationBillOfMaterialsItem (full pull) ===');
  const t0 = Date.now();
  const items = await fy.query('OperationBillOfMaterialsItem', {}, { timeoutMs: 180000, retries: 0 });
  console.log('  rows: ' + items.length + ' za ' + (Date.now() - t0) + ' ms');

  if (items.length === 0) {
    console.log('  ZERO results — entita asi neexistuje pod tímto názvem.');
    return;
  }

  // Sample shape
  console.log('\n=== Sample řádek ===');
  console.log(JSON.stringify(items[0], null, 2).slice(0, 600));

  // Najdi BOM pro každou operaci dávky 24515
  const opIds = [5033, 5038, 5039, 5032, 5034, 5035, 5036, 5037];
  console.log('\n=== BOM pro jednotlivé operace ===');
  for (const opId of opIds) {
    const matched = items.filter(function (it) { return Number(it?.operation?.id) === opId; });
    console.log('  op ' + opId + ': ' + matched.length + ' BOM items');
    if (matched.length > 0) {
      const sample = matched[0];
      const goods = sample.goods || {};
      const goodsName = typeof goods.name === 'object' ? (goods.name['2'] || goods.name['1']) : goods.name;
      console.log('    první: id=' + sample.id + ' goods.code=' + goods.code + ' name="' + (goodsName || '').slice(0, 40) + '" qty=' + sample.quantity);
    }
  }

  // Statistika: kolik unikátních operation.id celkem
  const ops = new Set();
  items.forEach(function (it) { if (it?.operation?.id) ops.add(it.operation.id); });
  console.log('\n  Unikátních operation.id v BOM tabulce: ' + ops.size);
  console.log('  Velikost dat: ' + (JSON.stringify(items).length / 1024 / 1024).toFixed(1) + ' MB');
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });
