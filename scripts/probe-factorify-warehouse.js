// =============================================================================
// HolyOS — Probe Factorify API: zjištění entit pro sklady, pohyby, objednávky
// Spuštění: node scripts/probe-factorify-warehouse.js
// Výstup:   data/factorify-probe/<entity>.json + data/factorify-probe/_summary.md
// =============================================================================

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Konfigurace ──────────────────────────────────────────────────────────

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCOUNTING_UNIT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';
const OUT_DIR = path.join(__dirname, '..', 'data', 'factorify-probe');

if (!TOKEN) {
  console.error('❌ FACTORIFY_TOKEN není nastaven v .env');
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`\n🔗 Factorify: ${BASE_URL}`);
console.log(`🔑 Token:     ${TOKEN.substring(0, 10)}...`);
console.log(`📁 Výstup:    ${OUT_DIR}\n`);

// ─── Kandidáti na entity ──────────────────────────────────────────────────
// Cíl: najít, jak se Factorify entity skutečně jmenují pro:
//   - sklady (warehouse)
//   - lokace v rámci skladu (location, storage bin)
//   - skladové pohyby (movements, receipts, issues, transfers)
//   - aktuální stav skladu (stock levels)
//   - nákupní objednávky (PO)
//   - řádky nákupních objednávek
//   - dodavatele (suppliers, partners, companies)
//   - nákupní ceník (price list, supplier prices)
//   - příjemky / výdejky (delivery notes, dispatch notes)

const CANDIDATES = [
  // Sklady a lokace
  'Warehouse', 'Stock', 'Storage', 'StorageLocation', 'StockLocation',
  'StorageBin', 'StorageArea', 'Location', 'Stockroom', 'StockArea',
  'WarehouseArea', 'StorageZone',
  // Skladové pohyby
  'StockMovement', 'StockTransaction', 'WarehouseMovement', 'Movement',
  'GoodsMovement', 'GoodsTransaction', 'StockChange', 'InventoryMovement',
  'InventoryTransaction', 'StockOperation',
  // Aktuální stavy
  'StockLevel', 'StockBalance', 'GoodsStock', 'InventoryLevel', 'StockState',
  // Příjemky / výdejky
  'Receipt', 'GoodsReceipt', 'StockReceipt', 'Issue', 'GoodsIssue',
  'StockIssue', 'DeliveryNote', 'DispatchNote', 'StockTransfer', 'Transfer',
  // Nákupní objednávky
  'PurchaseOrder', 'PurchaseOrderItem', 'PurchaseOrderLine',
  'Order', 'OrderItem', 'OrderLine',
  'Demand', 'PurchaseDemand', 'PurchaseRequest',
  // Dodavatelé / partneři / firmy
  'Supplier', 'Vendor', 'Partner', 'BusinessPartner', 'Company',
  'Customer', 'Contact', 'Account',
  // Ceníky
  'Pricelist', 'PriceList', 'SupplierPricelist', 'SupplierPriceList',
  'PurchasePricelist', 'Price', 'PriceQuote', 'Quote',
  // Inventura
  'Inventory', 'InventoryItem', 'InventoryCheck', 'StockTake',
];

// ─── HTTP helper ──────────────────────────────────────────────────────────

function queryFactorify(entityName, body = {}) {
  return new Promise((resolve) => {
    const url = new URL(`/api/query/${entityName}`, BASE_URL);
    const postData = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': ACCOUNTING_UNIT,
        'X-FySerialization': 'ui2',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        let parseError = null;
        try { parsed = JSON.parse(data); } catch (e) { parseError = e.message; }

        // Flexibilní extrakce pole záznamů
        let rows = parsed;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.rows) rows = parsed.rows;
          else if (parsed.items) rows = parsed.items;
          else if (parsed.records) rows = parsed.records;
          else if (parsed.data) rows = parsed.data;
          else {
            for (const key of Object.keys(parsed)) {
              if (Array.isArray(parsed[key])) { rows = parsed[key]; break; }
            }
          }
        }

        resolve({
          status: res.statusCode,
          ok: res.statusCode === 200,
          parseError,
          isArray: Array.isArray(rows),
          count: Array.isArray(rows) ? rows.length : (rows ? 1 : 0),
          rows: Array.isArray(rows) ? rows : (rows ? [rows] : []),
          rawSample: data.substring(0, 500),
        });
      });
    });

    req.on('error', (e) => resolve({
      status: 0, ok: false, error: e.message, count: 0, rows: [],
    }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ status: 0, ok: false, error: 'Timeout', count: 0, rows: [] });
    });
    req.write(postData);
    req.end();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function topLevelKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).slice(0, 50);
}

function fieldSummary(rows, sampleSize = 3) {
  const keyTypes = {};
  const sample = rows.slice(0, sampleSize);
  for (const row of rows.slice(0, 20)) {
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (!keyTypes[k]) keyTypes[k] = new Set();
      let t;
      if (v === null) t = 'null';
      else if (Array.isArray(v)) t = `array[${v.length}]`;
      else if (typeof v === 'object') t = `object{${Object.keys(v).slice(0, 3).join(',')}}`;
      else t = typeof v;
      keyTypes[k].add(t);
    }
  }
  const fields = {};
  for (const [k, types] of Object.entries(keyTypes)) {
    fields[k] = Array.from(types).join(' | ');
  }
  return { fields, sample };
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Probehnu ${CANDIDATES.length} kandidátů…\n`);

  const results = [];
  const found = [];
  const empty = [];
  const failed = [];

  for (const entity of CANDIDATES) {
    process.stdout.write(`  ${entity.padEnd(30)} `);
    const r = await queryFactorify(entity);

    const result = { entity, status: r.status, ok: r.ok, count: r.count, error: r.error };

    if (r.ok && r.count > 0) {
      const summary = fieldSummary(r.rows);
      result.fields = summary.fields;
      result.fieldCount = Object.keys(summary.fields).length;
      // Uložit plný dump (max 50 záznamů)
      const dumpPath = path.join(OUT_DIR, `${entity}.json`);
      fs.writeFileSync(dumpPath, JSON.stringify({
        entity,
        count: r.count,
        fields: summary.fields,
        sample: summary.sample,
        firstRecords: r.rows.slice(0, 50),
      }, null, 2));
      console.log(`✅ ${r.count} záznamů, ${result.fieldCount} polí → ${entity}.json`);
      found.push(result);
    } else if (r.ok && r.count === 0) {
      console.log(`◯  prázdné (HTTP 200, 0 záznamů)`);
      empty.push(result);
    } else {
      const reason = r.error || `HTTP ${r.status}`;
      console.log(`❌ ${reason}`);
      failed.push(result);
    }
    results.push(result);

    // Šetrnost k API
    await new Promise(res => setTimeout(res, 150));
  }

  // ─── Souhrnný report ───────────────────────────────────────────────────
  const summaryPath = path.join(OUT_DIR, '_summary.md');
  const lines = [];
  lines.push(`# Factorify Probe – ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`**Base URL:** ${BASE_URL}`);
  lines.push(`**Accounting Unit:** ${ACCOUNTING_UNIT}`);
  lines.push(``);
  lines.push(`## Souhrn`);
  lines.push(``);
  lines.push(`- ✅ Nalezeno (s daty): **${found.length}**`);
  lines.push(`- ◯ Prázdné (HTTP 200, 0 záznamů): **${empty.length}**`);
  lines.push(`- ❌ Selhalo (4xx/5xx/timeout): **${failed.length}**`);
  lines.push(``);

  if (found.length > 0) {
    lines.push(`## Nalezené entity`);
    lines.push(``);
    lines.push(`| Entita | Záznamů | Polí | Detail |`);
    lines.push(`|--------|--------:|-----:|--------|`);
    for (const r of found) {
      lines.push(`| **${r.entity}** | ${r.count} | ${r.fieldCount} | [${r.entity}.json](./${r.entity}.json) |`);
    }
    lines.push(``);
    lines.push(`## Pole nalezených entit`);
    lines.push(``);
    for (const r of found) {
      lines.push(`### ${r.entity} (${r.count} záznamů)`);
      lines.push(``);
      lines.push(`| Pole | Typ |`);
      lines.push(`|------|-----|`);
      for (const [k, t] of Object.entries(r.fields)) {
        lines.push(`| \`${k}\` | ${t} |`);
      }
      lines.push(``);
    }
  }

  if (empty.length > 0) {
    lines.push(`## Prázdné entity (existují, ale 0 záznamů)`);
    lines.push(``);
    for (const r of empty) lines.push(`- \`${r.entity}\``);
    lines.push(``);
  }

  if (failed.length > 0) {
    lines.push(`## Selhané entity (pravděpodobně neexistují)`);
    lines.push(``);
    lines.push(`<details><summary>Rozbalit (${failed.length})</summary>`);
    lines.push(``);
    for (const r of failed) lines.push(`- \`${r.entity}\` — ${r.error || `HTTP ${r.status}`}`);
    lines.push(``);
    lines.push(`</details>`);
  }

  fs.writeFileSync(summaryPath, lines.join('\n'));

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ✅ Nalezeno: ${found.length}   ◯ Prázdné: ${empty.length}   ❌ Selhalo: ${failed.length}`);
  console.log(`  📄 Souhrn: ${summaryPath}`);
  console.log(`═══════════════════════════════════════════\n`);
}

main().catch(e => {
  console.error('Fatální chyba:', e);
  process.exit(1);
});
