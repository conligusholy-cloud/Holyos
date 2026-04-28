// HolyOS — Stáhne BillOfMaterialItem flat seznam, ukáže prvních 5 řádků a klíče.
// Spuštění: node scripts/dump-bom-item-sample.js
require('dotenv').config();
const https = require('https');
const fs = require('fs');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';

function call(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = JSON.stringify(body || {});
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
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
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

(async () => {
  console.log('Stahuji /api/query/BillOfMaterialItem (~40 MB) ...');
  const t0 = Date.now();
  const r = await call('/api/query/BillOfMaterialItem', {});
  console.log(`HTTP ${r.status}, ${r.body.length} chars, ${Date.now() - t0} ms`);
  if (r.status !== 200) { console.log(r.body.substring(0, 500)); process.exit(1); }

  const obj = JSON.parse(r.body);
  let rows = obj;
  if (obj && obj.rows) rows = obj.rows;
  else if (obj && obj.items) rows = obj.items;
  else if (!Array.isArray(obj)) {
    for (const k of Object.keys(obj)) {
      if (Array.isArray(obj[k])) { rows = obj[k]; break; }
    }
  }
  console.log(`\nPočet řádků: ${rows.length}`);

  if (rows.length === 0) { console.log('Prázdné!'); process.exit(0); }

  console.log('\nKlíče prvního řádku:');
  console.log('  ' + Object.keys(rows[0]).join(', '));

  console.log('\nPRVNÍ ŘÁDEK (full):');
  console.log(JSON.stringify(rows[0], null, 2).substring(0, 2500));

  console.log('\nDRUHÝ ŘÁDEK (full):');
  if (rows[1]) console.log(JSON.stringify(rows[1], null, 2).substring(0, 2500));

  // Najdi řádky kde parent goods je 2942 (nebo libovolné pole odkazující na 2942)
  console.log('\nHledám řádky s referencí na Goods #2942 (BS-M-4520):');
  const matching = [];
  for (const row of rows.slice(0, Math.min(rows.length, 50000))) {
    const json = JSON.stringify(row);
    if (json.includes('"id":2942') || json.includes(':2942,') || json.includes(':2942}')) {
      matching.push(row);
      if (matching.length >= 10) break;
    }
  }
  console.log(`  Nalezeno ${matching.length} řádků (limit 10), ukázka prvních 3:`);
  for (let i = 0; i < Math.min(3, matching.length); i++) {
    console.log(`\n  [${i}] ${JSON.stringify(matching[i], null, 2).substring(0, 1500)}`);
  }

  // Ulož sample do souboru pro pozdější rozbor
  fs.writeFileSync('bom-item-sample.json', JSON.stringify({
    totalRows: rows.length,
    firstFive: rows.slice(0, 5),
    matching2942: matching,
  }, null, 2), 'utf8');
  console.log('\n✅ Sample uložen → bom-item-sample.json');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
