// =============================================================================
// HolyOS — Probe Factorify API: třetí (finální) kolo
// Cílené entity podle seznamu metadat z Factorify – jen ty pro warehouse import.
// Hlavní cíl: STOCK MOVES, STOCK DOCUMENTS – samotný audit trail!
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

// ─── Cílené kandidáty ze seznamu metadat ──────────────────────────────────

const CANDIDATES = [
  // *** SKLADOVÉ POHYBY *** - to nejdůležitější
  'StockMove',
  'PricedStockMove',
  'UnexportedStockMove',

  // *** SKLADOVÉ DOKLADY *** - příjemky/výdejky/přesunky
  'StockDocument',
  'StockDocumentAttachment',

  // Skladové položky (aktuální stav)
  'StockItem',

  // Inventury
  'StockPhysicalInventory',
  'StockPhysicalInventoryPosition',
  'StockPhysicalInventoryRecord',
  'RepeatedPhysicalInventory',
  'RepeatedPhysicalInventoryPosition',

  // Neshodnosti / scrap
  'ScrapProtocol',
  'ScrapProtocolItem',
  'ScrapProtocolStockMove',

  // Rámcové nákupní
  'FrameworkPurchaseOrder',
  'FrameworkPurchaseOrderItem',

  // Palety
  'Pallet',
  'PalletType',

  // Účetní vazba na sklad
  'AccountingDocumentsStockReceives',

  // Sériová čísla (Factorify má specifické modely)
  'BatchSerialNumber',
  'SerialNumberSequence',
  'SerialNumberData',

  // Dodací listy (cesta k pohybům?)
  'DeliveryBill',
  'DeliveryBillItem',
  'DeliveryBillPackage',

  // Dovoz (mohlo by sloužit jako příjemka ze zahraničí)
  'Import',

  // PurchaseOrderType (typy nákupních objednávek)
  'PurchaseOrderType',

  // Banka pro doplnění bankovních účtů
  'Bank',
  'CounterpartyBankAccount',

  // Number sequences pro identifikaci
  'BatchNumber',

  // Goods odd. metadata (pro mapping)
  'GoodsTemplate',
  'GoodsVariant',
  'PreferredStock',
  'GoodsDispositionArea',

  // Tag pro kategorizaci materiálu
  'Tag',

  // Note pro poznámky
  'Note',

  // Permission/Role pokud bude užitečné pro audit
  'Permission',
  'Role',
];

// ─── HTTP helper ──────────────────────────────────────────────────────────

// Hard limit – pokud entita vrátí > 100MB, abortneme. Pro probe stačí vědět "je to obrovské",
// detail si vezmeme až v master importu přes paginaci.
const SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const SAMPLE_BYTES = 2 * 1024 * 1024; // z aborted response zkusíme ze začátku 2MB extrahovat sample

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

    let req;
    const chunks = [];
    let totalSize = 0;
    let aborted = false;

    req = https.request(options, (res) => {
      res.on('data', chunk => {
        if (aborted) return;
        chunks.push(chunk);
        totalSize += chunk.length;
        if (totalSize > SIZE_LIMIT_BYTES) {
          aborted = true;
          try { req.destroy(); } catch (e) {}
        }
      });
      res.on('end', () => {
        if (aborted) {
          // Pokus o sample z prvních X bytů — najdeme první JSON objekt v poli
          const head = Buffer.concat(chunks).slice(0, SAMPLE_BYTES).toString('utf8');
          // Najdi začátek pole a první ~3 JSON objekty
          const arrStart = head.search(/\[\s*\{/);
          let sample = [];
          if (arrStart >= 0) {
            // jednoduchý objekt-by-objekt parser pro prvních pár položek
            const after = head.substring(arrStart + 1);
            let depth = 0, inStr = false, esc = false, start = -1;
            for (let i = 0; i < after.length && sample.length < 3; i++) {
              const c = after[i];
              if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
                continue;
              }
              if (c === '"') inStr = true;
              else if (c === '{') { if (depth === 0) start = i; depth++; }
              else if (c === '}') {
                depth--;
                if (depth === 0 && start >= 0) {
                  try { sample.push(JSON.parse(after.substring(start, i + 1))); } catch (e) {}
                  start = -1;
                }
              }
            }
          }
          resolve({
            status: 200, ok: true,
            count: -1, // -1 = "obrovské, neznámo přesně"
            huge: true,
            sizeMB: (totalSize / 1024 / 1024).toFixed(0),
            rows: sample,
          });
          return;
        }
        let buf;
        try { buf = Buffer.concat(chunks); } catch (e) {
          resolve({ status: res.statusCode, ok: false, error: 'Buffer concat: ' + e.message, count: 0, rows: [] });
          return;
        }
        let text;
        try { text = buf.toString('utf8'); } catch (e) {
          resolve({ status: res.statusCode, ok: false, error: 'toString: ' + e.message, count: 0, rows: [] });
          return;
        }
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {
          resolve({ status: res.statusCode, ok: false, error: 'JSON parse: ' + e.message, count: 0, rows: [] });
          return;
        }
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
          sizeMB: (totalSize / 1024 / 1024).toFixed(2),
        });
      });
      res.on('error', e => resolve({ status: 0, ok: false, error: 'res error: ' + e.message, count: 0, rows: [] }));
    });
    req.on('error', e => {
      if (aborted) return; // už jsme resolvili
      resolve({ status: 0, ok: false, error: e.message, count: 0, rows: [] });
    });
    req.setTimeout(120000, () => {
      try { req.destroy(); } catch (e) {}
      resolve({ status: 0, ok: false, error: 'Timeout', count: 0, rows: [] });
    });
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
  console.log(`Třetí kolo (finální): ${CANDIDATES.length} cílených kandidátů\n`);
  const found = [], empty = [], failed = [];

  for (const entity of CANDIDATES) {
    process.stdout.write(`  ${entity.padEnd(38)} `);
    const r = await queryFactorify(entity);
    const result = { entity, status: r.status, ok: r.ok, count: r.count, error: r.error };

    if (r.huge) {
      // entita je obrovská, abortovaná po 100MB - máme jen sample několika prvních záznamů
      const summary = fieldSummary(r.rows);
      result.fields = summary.fields;
      result.fieldCount = Object.keys(summary.fields).length;
      result.huge = true;
      result.sizeMB = r.sizeMB;
      const dumpPath = path.join(OUT_DIR, `${entity}.json`);
      fs.writeFileSync(dumpPath, JSON.stringify({
        entity, count: 'HUGE (>100MB, abortováno)', sizeMBPartial: r.sizeMB,
        fields: summary.fields, firstRecords: r.rows,
        note: 'Odpověď byla větší než 100MB, abortováno. Master import musí použít paginaci.',
      }, null, 2));
      console.log(`🔥 OBROVSKÉ (>${r.sizeMB} MB), sample ${r.rows.length} záznamů, ${result.fieldCount} polí → ${entity}.json`);
      found.push(result);
    } else if (r.ok && r.count > 0) {
      const summary = fieldSummary(r.rows);
      result.fields = summary.fields;
      result.fieldCount = Object.keys(summary.fields).length;
      const dumpPath = path.join(OUT_DIR, `${entity}.json`);
      fs.writeFileSync(dumpPath, JSON.stringify({
        entity, count: r.count, sizeMB: r.sizeMB, fields: summary.fields,
        firstRecords: r.rows.slice(0, 50),
      }, null, 2));
      console.log(`✅ ${r.count} záznamů (${r.sizeMB} MB), ${result.fieldCount} polí → ${entity}.json`);
      found.push(result);
    } else if (r.ok && r.count === 0) {
      console.log(`◯  prázdné`);
      empty.push(result);
    } else {
      console.log(`❌ ${r.error || `HTTP ${r.status}`}`);
      failed.push(result);
    }
    await new Promise(res => setTimeout(res, 200));
  }

  const sumPath = path.join(OUT_DIR, '_summary-3.md');
  const lines = [
    `# Factorify Probe – Třetí kolo (finální) – ${new Date().toISOString()}`,
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
    lines.push(`## Prázdné\n`);
    for (const r of empty) lines.push(`- \`${r.entity}\``);
    lines.push(``);
  }
  if (failed.length) {
    lines.push(`## Selhané\n`);
    for (const r of failed) lines.push(`- \`${r.entity}\` — ${r.error || `HTTP ${r.status}`}`);
  }

  fs.writeFileSync(sumPath, lines.join('\n'));
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ✅ ${found.length}   ◯ ${empty.length}   ❌ ${failed.length}`);
  console.log(`  📄 ${sumPath}`);
  console.log(`═══════════════════════════════════════════\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
