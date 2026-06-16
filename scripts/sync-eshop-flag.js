// HolyOS — Sync příznaku "Používá servis - e-shop" z Factorify Goods → Material.sells_on_eshop
//
// Factorify drží na entitě Goods boolean checkbox "Používá servis - e-shop".
// Náš import (dump-factorify.js) ho dřív nepřenášel, takže v Katalogu Spare Parts
// měly všechny položky ESHOP = Ne. Tento skript pole dotáhne z Factorify a srovná
// Material.sells_on_eshop podle kódu zboží.
//
// Použití:
//   node scripts/sync-eshop-flag.js            # dry-run: jen detekce pole + statistika
//   node scripts/sync-eshop-flag.js --apply    # zapíše do DB

require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const APPLY = process.argv.includes('--apply');

if (!TOKEN) { console.error('❌ FACTORIFY_TOKEN není v .env'); process.exit(1); }

function queryFactorify(entityName, body = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/query/${entityName}`, BASE_URL);
    const postData = JSON.stringify(body);
    const options = {
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': '1',
        'X-FySerialization': 'ui2',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let rows = parsed;
          if (parsed.records) rows = parsed.records;
          else if (parsed.data) rows = parsed.data;
          else if (!Array.isArray(parsed)) {
            for (const key of Object.keys(parsed)) {
              if (Array.isArray(parsed[key])) { rows = parsed[key]; break; }
            }
          }
          if (!Array.isArray(rows)) rows = [rows];
          resolve(rows);
        } catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

function getStr(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') { const i = v.label || v.name || v.referenceName; if (i) return String(i); }
  }
  return null;
}

(async () => {
  console.log('\n📦 Stahuju Goods z Factorify...');
  const goods = await queryFactorify('Goods');
  console.log(`   → ${goods.length} záznamů`);
  if (!goods.length) { console.error('❌ Žádná data.'); process.exit(1); }

  // 1) Auto-detekce pole "Používá servis - e-shop"
  const re = /eshop|servis|service/i;
  const boolFields = {};
  for (const g of goods) {
    for (const k of Object.keys(g)) {
      if (re.test(k) && typeof g[k] === 'boolean') {
        boolFields[k] = boolFields[k] || { true: 0, false: 0 };
        boolFields[k][g[k] ? 'true' : 'false']++;
      }
    }
  }
  const candidates = Object.keys(boolFields);
  console.log('\n🔎 Kandidátní bool pole na Goods (name → počet true/false):');
  candidates.forEach(c => console.log(`   ${c}: true=${boolFields[c].true}, false=${boolFields[c].false}`));

  if (!candidates.length) {
    console.error('\n❌ Nenašel jsem žádné bool pole eshop/servis. Klíče prvního goods:');
    console.log(Object.keys(goods[0]));
    process.exit(1);
  }
  // preferuj název obsahující "eshop", jinak pole s nejvíc true
  const byTrue = [...candidates].sort((a, b) => boolFields[b].true - boolFields[a].true);
  const field = candidates.find(c => /eshop/i.test(c)) || byTrue[0];
  console.log(`\n→ Použiju pole: "${field}"`);

  // 2) Srovnání podle kódu
  let setTrue = 0, setFalse = 0, notFound = 0, updated = 0;
  for (const g of goods) {
    const code = getStr(g, 'code', 'Code', 'referenceName', 'ReferenceName');
    if (!code) continue;
    const flag = !!g[field];
    flag ? setTrue++ : setFalse++;
    if (APPLY) {
      const r = await prisma.material.updateMany({ where: { code: code.slice(0, 50) }, data: { sells_on_eshop: flag } });
      if (r.count === 0) notFound++; else updated += r.count;
    }
  }

  console.log(`\n📊 Goods s příznakem true=${setTrue}, false=${setFalse}`);
  if (APPLY) {
    console.log(`✅ Zapsáno: ${updated} materiálů aktualizováno, ${notFound} kódů nemá protějšek v HolyOS.`);
  } else {
    console.log('ℹ️  DRY-RUN — nic se nezapsalo. Spusť znovu s "--apply".');
  }
  await prisma.$disconnect();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
