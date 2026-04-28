// HolyOS — Stáhne /api/goods/2942 a vypíše top-level klíče + ukázku stromu kusovníku.
// Spuštění: node scripts/dump-goods-2942.js > goods-2942.json
require('dotenv').config();
const https = require('https');
const fs = require('fs');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';

function call(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': '1',
        'X-FySerialization': 'ui2',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  const r = await call('/api/goods/2942');
  console.error(`HTTP ${r.status}, ${r.body.length} chars`);
  if (r.status !== 200) { console.error(r.body.substring(0, 800)); process.exit(1); }

  const obj = JSON.parse(r.body);

  // Ulož surovou JSON
  fs.writeFileSync('goods-2942-raw.json', JSON.stringify(obj, null, 2), 'utf8');
  console.error('Saved → goods-2942-raw.json');

  // Top-level klíče
  console.error('\nTop-level klíče (s typem a velikostí):');
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    let info;
    if (Array.isArray(v)) info = `Array[${v.length}]` + (v.length > 0 ? ` first keys: ${Object.keys(v[0] || {}).slice(0, 8).join(',')}` : '');
    else if (v && typeof v === 'object') info = `Object{${Object.keys(v).slice(0, 6).join(',')}}`;
    else info = `${typeof v}: ${String(v).substring(0, 60)}`;
    console.error(`  ${k.padEnd(30)} ${info}`);
  }

  // Hledej kandidátní BOM pole — Array s objekty mající quantity nebo amount
  console.error('\nPole vypadající jako BOM (Array s quantity/amount):');
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      const sample = v[0];
      const hasQty = ['quantity', 'amount', 'qty', 'count'].some(f => sample[f] != null);
      const hasGoodsRef = Object.keys(sample).some(kk => /good|item|component|child|sub/i.test(kk));
      if (hasQty || hasGoodsRef) {
        console.error(`  ✅ ${k}: ${v.length} items, sample keys = [${Object.keys(sample).join(', ')}]`);
        console.error(`     first item:`, JSON.stringify(sample, null, 2).substring(0, 1200));
      }
    }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
