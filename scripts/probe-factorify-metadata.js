// =============================================================================
// HolyOS — Probe Factorify METADATA endpoint pro mega entity
// /api/metadata/entity/<Name> vrací strukturu polí bez stahování dat
// =============================================================================

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCOUNTING_UNIT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';
const OUT_DIR = path.join(__dirname, '..', 'data', 'factorify-probe');

if (!TOKEN) { console.error('❌ FACTORIFY_TOKEN není v .env'); process.exit(1); }
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`\n🔗 Factorify metadata: ${BASE_URL}\n`);

// Entity, které jsme nedokázali stáhnout - chceme jejich strukturu polí
const MEGA_ENTITIES = [
  'StockMove',
  'PricedStockMove',
  'UnexportedStockMove',
  'StockDocument',
  'StockItem',
  'StockPhysicalInventoryRecord',
  // Pro doplnění - i malé, abychom měli kompletní reference:
  'Stock',
  'PurchaseOrder',
  'PurchaseOrderItem',
  'Company',
  'BuyingPriceList',
  'BuyingPriceListItem',
];

function getMetadata(entityName) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'bs.factorify.cloud',
      port: 443,
      path: `/api/metadata/entity/${entityName}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': ACCOUNTING_UNIT,
        'X-FySerialization': 'ui2',
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {
          resolve({ ok: false, error: 'parse: ' + e.message, raw: text.substring(0, 500) });
          return;
        }
        resolve({ ok: res.statusCode === 200, status: res.statusCode, data: parsed });
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.end();
  });
}

async function main() {
  console.log(`Tahám metadata pro ${MEGA_ENTITIES.length} entit\n`);
  const results = [];

  for (const entity of MEGA_ENTITIES) {
    process.stdout.write(`  ${entity.padEnd(38)} `);
    const r = await getMetadata(entity);
    if (r.ok) {
      const dumpPath = path.join(OUT_DIR, `${entity}.metadata.json`);
      fs.writeFileSync(dumpPath, JSON.stringify(r.data, null, 2));
      // Pokus o extrakci field listu
      let fieldCount = 0;
      const fields = [];
      if (Array.isArray(r.data?.fields)) {
        fieldCount = r.data.fields.length;
        for (const f of r.data.fields) {
          fields.push(`${f.name || f.code || '?'}: ${f.type || f.dataType || '?'}`);
        }
      } else if (r.data?.properties) {
        fieldCount = Object.keys(r.data.properties).length;
      }
      console.log(`✅ ${fieldCount} polí → ${entity}.metadata.json`);
      results.push({ entity, ok: true, fieldCount, fields });
    } else {
      console.log(`❌ ${r.error || `HTTP ${r.status}`}`);
      results.push({ entity, ok: false, error: r.error });
    }
    await new Promise(res => setTimeout(res, 200));
  }

  // Souhrn
  const sumPath = path.join(OUT_DIR, '_metadata-summary.md');
  const lines = [`# Factorify Metadata – ${new Date().toISOString()}`, ``];
  for (const r of results) {
    if (r.ok) {
      lines.push(`## ${r.entity} (${r.fieldCount} polí)`);
      lines.push('');
      if (r.fields.length) {
        for (const f of r.fields.slice(0, 100)) lines.push(`- ${f}`);
      }
      lines.push('');
    } else {
      lines.push(`## ${r.entity} ❌ ${r.error}`);
      lines.push('');
    }
  }
  fs.writeFileSync(sumPath, lines.join('\n'));
  console.log(`\n📄 ${sumPath}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
