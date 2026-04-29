// =============================================================================
// HolyOS — Factorify wrapper pro modul Normování
// =============================================================================
// READ-ONLY čtení z Factorify pro normátorský workflow:
//   getBatch(idOrNumber) — GET /api/batch/{id} — vrací kompletní strom batche
//                          včetně workflow.operations[*].billOfMaterialsItems
//
// Probe ukázal, že JEDEN HTTP request stačí pro:
//   - metadata batche (číslo, množství, goods)
//   - seznam operací dávky (workflow.operations[])
//   - BOM každé operace (op.billOfMaterialsItems[]) s goods.code/name/unit
//
// Cache: 60 s TTL — operátor může otevřít/zavřít obrazovku několikrát během
// měření, nemusíme tahat 100 KB pokaždé.
// =============================================================================

const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

const CACHE_TTL_MS = 60 * 1000;
const _cache = new Map(); // key=batchId → { value, ts }

function rawGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + (url.search || ''),
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `securityToken=${TOKEN}`,
        'X-AccountingUnit': ACCT,
        'X-FySerialization': 'ui2',
        'Accept-Encoding': 'gzip, deflate',
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(require('zlib').createGunzip());
      else if (enc === 'deflate') stream = res.pipe(require('zlib').createInflate());
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`Factorify HTTP ${res.statusCode} ${urlPath}: ${text.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(text)); }
        catch (e) { reject(new Error(`Factorify ${urlPath}: invalid JSON — ${e.message}`)); }
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Factorify timeout > 20s')); });
    req.end();
  });
}

// FY referenceName u multi-jazyčných polí vrací { "1": "EN", "2": "CS" }
function asString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (typeof v['2'] === 'string') return v['2']; // CS
    if (typeof v['1'] === 'string') return v['1']; // EN
    return v.referenceName || v.label || v.name || null;
  }
  return null;
}

/**
 * Načte celý strom batche jedním HTTP voláním.
 * Vrací **zjednodušenou strukturu** pro normátorské UI — bez FY šumu (createdBy,
 * accountingUnit, classNameForRequestHash apod.).
 *
 * @param {string|number} batchIdOrNumber — Batch.id (= Batch.number, jsou stejné)
 * @returns {Promise<{
 *   id: string, number: string, quantity: number, released: boolean,
 *   goods: { id, code, name, unit, type } | null,
 *   workflow: { id } | null,
 *   currentOperation: { id, name, position, workplace } | null,
 *   operations: Array<{
 *     id: string, position: number|null, name: string, workplace: string|null,
 *     bomItems: Array<{
 *       id: string, goods_id: string|null, code: string|null, name: string|null,
 *       unit: string|null, quantity: number, perQuantity: number, sequence: number|null
 *     }>
 *   }>
 * }>}
 */
async function getBatch(batchIdOrNumber) {
  const id = String(batchIdOrNumber).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(`Neplatné číslo dávky: "${batchIdOrNumber}" (očekává se kladné celé číslo)`);
  }

  // Cache hit?
  const cached = _cache.get(id);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.value;
  }

  // Pozn.: Endpoint je case-sensitive lowercase: /api/batch/{id}
  // (Velké B vrací 404, viz probe-normovani-fy-2.js)
  const raw = await rawGet(`/api/batch/${id}`);

  const out = {
    id: String(raw.id),
    number: String(raw.number ?? raw.id),
    quantity: Number(raw.quantity) || 0,
    released: !!raw.released,
    finished: !!raw.finished,
    goods: raw.goods ? {
      id: String(raw.goods.id),
      code: asString(raw.goods.code),
      name: asString(raw.goods.name),
      unit: asString(raw.goods.unit),
      type: asString(raw.goods.type),
    } : null,
    workflow: raw.workflow ? { id: String(raw.workflow.id) } : null,
    currentOperation: raw.workflowOperation ? {
      id: String(raw.workflowOperation.id),
      name: asString(raw.workflowOperation.operationName),
      position: raw.workflowOperation.position ?? null,
      workplace: asString(raw.workflowOperation.stage),
    } : null,
    operations: [],
  };

  // workflow.operations je pole instance operací, každá má billOfMaterialsItems
  const ops = Array.isArray(raw.workflow?.operations) ? raw.workflow.operations : [];
  for (const op of ops) {
    const bom = Array.isArray(op.billOfMaterialsItems) ? op.billOfMaterialsItems : [];
    out.operations.push({
      id: String(op.id),
      // FY GET odpověď nepoužívá `position` na operaci přímo — používá `sequence` nebo
      // `operationPosition`. Použijeme cokoli, co je k dispozici.
      position: op.position ?? op.sequence ?? op.operationPosition ?? null,
      name: asString(op.operationName) || asString(op.name) || op.referenceName || `Op ${op.id}`,
      workplace: asString(op.stage),
      bomItems: bom.map(item => ({
        id: String(item.id),
        goods_id: item.goods?.id != null ? String(item.goods.id) : null,
        code: asString(item.goods?.code),
        name: asString(item.goods?.name),
        unit: asString(item.goods?.unit),
        quantity: Number(item.quantity) || 0,
        perQuantity: Number(item.perQuantity) || 1,
        sequence: item.sequenceOrZero ?? item.sequence ?? null,
      })),
    });
  }

  // Setřid operace — primárně podle position/sequence, sekundárně podle id
  out.operations.sort((a, b) => {
    const pa = a.position ?? 9999;
    const pb = b.position ?? 9999;
    if (pa !== pb) return pa - pb;
    return Number(a.id) - Number(b.id);
  });

  _cache.set(id, { value: out, ts: Date.now() });
  return out;
}

function clearCache(idOrNumber) {
  if (idOrNumber == null) {
    _cache.clear();
    return;
  }
  _cache.delete(String(idOrNumber));
}

module.exports = { getBatch, clearCache };
