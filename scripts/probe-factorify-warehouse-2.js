// =============================================================================
// HolyOS — Probe Factorify API: druhé kolo
// Cílí na entity, které první kolo nezachytilo:
//   - Skladové pohyby (česky, slovensky, alternativně)
//   - Generické StockOrder/SalesOrder (Factorify má StockOrder jako parent)
//   - Buying/Selling Price List + Items (ceník vyplývá z PO item.buyingPriceListItem)
//   - FrameworkStockOrder + Item (rámcové objednávky)
//   - Vnořené entity z probe-1: Address, Country, BankAccount, PaymentMethod, Batch
//   - Goods, GoodsType, Project, CostCenter, Transporter
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

console.log(`\n🔗 Factorify: ${BASE_URL}`);
console.log(`📁 Výstup:    ${OUT_DIR}\n`);

// ─── Druhé kolo kandidátů ─────────────────────────────────────────────────

const CANDIDATES = [
  // Generické order entity (Factorify má StockOrder jako parent všech objednávek)
  'StockOrder', 'StockOrderItem',
  'SalesOrder', 'SalesOrderItem',
  'FrameworkStockOrder', 'FrameworkStockOrderItem',
  'FrameworkOrder', 'FrameworkOrderItem',

  // Ceník (vidíme z PO item.buyingPriceListItem)
  'BuyingPriceList', 'BuyingPriceListItem',
  'SellingPriceList', 'SellingPriceListItem',
  'PurchasePriceList', 'PurchasePriceListItem',

  // Skladové pohyby - alternativní názvy
  'StockBookkeeping', 'StockBookking', 'Booking', 'StockBooking',
  'StockEntry', 'StockEntries',
  'StockOperation', 'WarehouseOperation',
  'MaterialBooking', 'GoodsBooking',
  'StockReservation', 'Reservation',
  'StockJournal', 'WarehouseJournal',
  'StockHistory', 'GoodsHistory',
  'StockEvent', 'GoodsEvent',
  // Možná Factorify nazývá pohyby "operations" a má StockOperation jako součást Operation
  'Operation',

  // České názvy pohybů
  'Pohyb', 'SkladovyPohyb', 'Naskladneni', 'Vyskladneni',
  'Prijemka', 'Vydejka', 'Prevodka',
  'Prevod', 'StavSkladu',

  // Slovenské
  'Pohyb', 'Naskladnenie', 'Vyskladnenie',

  // Inventura - alternativy
  'Stocktaking', 'PhysicalInventory', 'StockTaking',
  'Inventarizace',

  // Vnořené entity z prvního kola
  'Address', 'Addresses',
  'Country', 'Countries',
  'BankAccount', 'BankAccounts',
  'PaymentMethod', 'PaymentMethods',
  'Currency', 'Currencies',
  'Transporter', 'Transporters',
  'TransportConditions',
  'Project', 'Projects',
  'CostCenter', 'CostCenters',
  'Plant', 'Plants',
  'DispositionArea',
  'LongTermAsset', 'LongTermAssets',

  // Šarže (z PO item.batch)
  'Batch', 'Batches',
  'MaterialBatch', 'GoodsBatch',
  'Lot', 'Lots',
  'SerialNumber', 'SerialNumbers',

  // Goods (víme že funguje, ale chci typ a další doplňky)
  'GoodsType', 'GoodsState',
  'Material', 'Item', 'Article',

  // Faktury (= mohou obsahovat příjmy/výdeje)
  'Invoice', 'InvoiceItem', 'PurchaseInvoice', 'SalesInvoice',
  'IncomingInvoice', 'OutgoingInvoice',

  // Person/User (z createdBy)
  'Person', 'User', 'Users', 'People',

  // CompanyType, CompanyState
  'CompanyType', 'CompanyState', 'CompanyGroup',

  // Doklady obecně
  'Document', 'Documents',
];

// ─── HTTP helper ──────────────────────────────────────────────────────────

function queryFactorify(entityName, body = {}) {
  return new Promise((resolve) => {
    const url = new URL(`/api/query/${entityName}`, BASE_URL);
    const postData = JSON.stringify(body);
    const options = {
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
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
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        let rows = parsed;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.rows) rows = parsed.rows;
          else if (parsed.items) rows = parsed.items;
          else if (parsed.records) rows = parsed.records;
          else if (parsed.data) rows = parsed.data;
          else for (const k of Object.keys(parsed)) {
            if (Array.isArray(parsed[k])) { rows = parsed[k]; break; }
          }
        }
        resolve({
          status: res.statusCode, ok: res.statusCode === 200,
          count: Array.isArray(rows) ? rows.length : (rows ? 1 : 0),
          rows: Array.isArray(rows) ? rows : (rows ? [rows] : []),
        });
      });
    });
    req.on('error', e => resolve({ status: 0, ok: false, error: e.message, count: 0, rows: [] }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, ok: false, error: 'Timeout', count: 0, rows: [] }); });
    req.write(postData);
    req.end();
  });
}

function fieldSummary(rows) {
  const keyTypes = {};
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
  for (const [k, types] of Object.entries(keyTypes)) fields[k] = Array.from(types).join(' | ');
  return { fields, sample: rows.slice(0, 3) };
}

async function main() {
  console.log(`Druhé kolo: ${CANDIDATES.length} kandidátů\n`);
  const found = [], empty = [], failed = [];

  // Deduplikace (Pohyb je tam dvakrát - cz/sk)
  const seen = new Set();

  for (const entity of CANDIDATES) {
    if (seen.has(entity)) continue;
    seen.add(entity);

    process.stdout.write(`  ${entity.padEnd(32)} `);
    const r = await queryFactorify(entity);
    const result = { entity, status: r.status, ok: r.ok, count: r.count, error: r.error };

    if (r.ok && r.count > 0) {
      const summary = fieldSummary(r.rows);
      result.fields = summary.fields;
      result.fieldCount = Object.keys(summary.fields).length;
      const dumpPath = path.join(OUT_DIR, `${entity}.json`);
      fs.writeFileSync(dumpPath, JSON.stringify({
        entity, count: r.count, fields: summary.fields,
        firstRecords: r.rows.slice(0, 50),
      }, null, 2));
      console.log(`✅ ${r.count} záznamů, ${result.fieldCount} polí → ${entity}.json`);
      found.push(result);
    } else if (r.ok && r.count === 0) {
      console.log(`◯  prázdné`);
      empty.push(result);
    } else {
      console.log(`❌ ${r.error || `HTTP ${r.status}`}`);
      failed.push(result);
    }
    await new Promise(res => setTimeout(res, 150));
  }

  // Souhrn (přidávám k existujícímu _summary.md jako _summary-2.md)
  const sumPath = path.join(OUT_DIR, '_summary-2.md');
  const lines = [
    `# Factorify Probe – Druhé kolo – ${new Date().toISOString()}`,
    ``,
    `## Souhrn`,
    `- ✅ Nalezeno: **${found.length}**`,
    `- ◯ Prázdné: **${empty.length}**`,
    `- ❌ Selhalo: **${failed.length}**`,
    ``,
  ];

  if (found.length) {
    lines.push(`## Nalezené entity\n`);
    lines.push(`| Entita | Záznamů | Polí |`);
    lines.push(`|--------|--------:|-----:|`);
    for (const r of found) lines.push(`| **${r.entity}** | ${r.count} | ${r.fieldCount} |`);
    lines.push(``);
    for (const r of found) {
      lines.push(`### ${r.entity} (${r.count})`);
      lines.push(``);
      lines.push(`| Pole | Typ |`);
      lines.push(`|------|-----|`);
      for (const [k, t] of Object.entries(r.fields)) lines.push(`| \`${k}\` | ${t} |`);
      lines.push(``);
    }
  }

  if (empty.length) {
    lines.push(`## Prázdné (existují, 0 záznamů)\n`);
    for (const r of empty) lines.push(`- \`${r.entity}\``);
    lines.push(``);
  }

  if (failed.length) {
    lines.push(`## Selhané (pravděpodobně neexistují)\n`);
    lines.push(`<details><summary>Rozbalit (${failed.length})</summary>\n`);
    for (const r of failed) lines.push(`- \`${r.entity}\` — ${r.error || `HTTP ${r.status}`}`);
    lines.push(`\n</details>`);
  }

  fs.writeFileSync(sumPath, lines.join('\n'));
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ✅ ${found.length}   ◯ ${empty.length}   ❌ ${failed.length}`);
  console.log(`  📄 ${sumPath}`);
  console.log(`═══════════════════════════════════════════\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
