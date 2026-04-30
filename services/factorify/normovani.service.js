// =============================================================================
// HolyOS — Factorify wrapper pro modul Normovani
// =============================================================================
// READ-ONLY čteni z Factorify pro normátorský workflow.
//
// Dva scenare:
// A) Davka ma vlastni materializovany workflow (jako 22965) → GET /api/batch/{id}
//    vrati workflow.operations[*].billOfMaterialsItems populovane v jednom requestu.
// B) Davka nema vlastni workflow (jako 24515) → workflow=null, ale
//    workflowOperation.workflowEntity.id je validni ref. Stahnu vsechny operace
//    a BOM z indexovanych entit (lazy 5min cache).
// =============================================================================

const https = require('https');
const { URL } = require('url');
const fy = require('./client.service');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

const CACHE_TTL_MS = 60 * 1000;
const INDEX_TTL_MS = 5 * 60 * 1000;

const _cache = new Map();
let _woIndex = null, _woTs = 0, _woInflight = null;
let _bomIndex = null, _bomTs = 0, _bomInflight = null;

function rawGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const opts = {
      hostname: url.hostname, port: 443,
      path: url.pathname + (url.search || ''),
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: 'securityToken=' + TOKEN,
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
          reject(new Error('Factorify HTTP ' + res.statusCode + ' ' + urlPath + ': ' + text.slice(0, 300)));
          return;
        }
        try { resolve(JSON.parse(text)); }
        catch (e) { reject(new Error('Factorify ' + urlPath + ': invalid JSON — ' + e.message)); }
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Factorify timeout > 20s')); });
    req.end();
  });
}

function asString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (typeof v['2'] === 'string') return v['2'];
    if (typeof v['1'] === 'string') return v['1'];
    return v.referenceName || v.label || v.name || null;
  }
  return null;
}

function trimBomItem(item) {
  return {
    id: String(item.id),
    operation_id: item.operation && item.operation.id != null ? Number(item.operation.id) : null,
    goods_id: item.goods && item.goods.id != null ? String(item.goods.id) : null,
    code: asString(item.goods && item.goods.code),
    name: asString(item.goods && item.goods.name),
    unit: asString(item.goods && item.goods.unit),
    quantity: Number(item.quantity) || 0,
    perQuantity: Number(item.perQuantity) || 1,
    sequence: item.sequenceOrZero != null ? item.sequenceOrZero : (item.sequence != null ? item.sequence : null),
  };
}

function trimWorkflowOp(op) {
  return {
    id: String(op.id),
    position: op.position != null ? op.position : (op.sequence != null ? op.sequence : null),
    name: asString(op.operationName) || asString(op.name) || op.referenceName || ('Op ' + op.id),
    workplace: asString(op.stage),
    workflowEntityId: op.workflowEntity && op.workflowEntity.id != null ? Number(op.workflowEntity.id) : null,
  };
}

async function ensureWorkflowOperationIndex() {
  const now = Date.now();
  if (_woIndex && now - _woTs < INDEX_TTL_MS) return _woIndex;
  if (_woInflight) return _woInflight;
  _woInflight = (async () => {
    const t0 = Date.now();
    const rows = await fy.query('WorkflowOperation', {}, { timeoutMs: 120000, retries: 1 });
    const map = new Map();
    for (const op of rows) {
      const wfId = op && op.workflowEntity && op.workflowEntity.id;
      if (wfId == null) continue;
      const trimmed = trimWorkflowOp(op);
      const key = Number(wfId);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(trimmed);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.position == null ? 9999 : a.position) - (b.position == null ? 9999 : b.position));
    }
    _woIndex = map;
    _woTs = Date.now();
    console.log('[normovani] WorkflowOperation index: ' + rows.length + ' rows, ' + map.size + ' workflows, ' + (Date.now() - t0) + ' ms');
    return map;
  })().finally(() => { _woInflight = null; });
  return _woInflight;
}

async function ensureBomIndex() {
  const now = Date.now();
  if (_bomIndex && now - _bomTs < INDEX_TTL_MS) return _bomIndex;
  if (_bomInflight) return _bomInflight;
  _bomInflight = (async () => {
    const t0 = Date.now();
    const map = new Map();
    let count = 0;
    await fy.queryStream(
      'OperationBillOfMaterialsItem',
      {},
      (item) => {
        const opId = item && item.operation && item.operation.id;
        if (opId == null) return;
        const trimmed = trimBomItem(item);
        const key = Number(opId);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(trimmed);
        count++;
      },
      { timeoutMs: 5 * 60000 }
    );
    for (const list of map.values()) {
      list.sort((a, b) => (a.sequence == null ? 0 : a.sequence) - (b.sequence == null ? 0 : b.sequence));
    }
    _bomIndex = map;
    _bomTs = Date.now();
    console.log('[normovani] BOM index: ' + count + ' rows, ' + map.size + ' ops, ' + (Date.now() - t0) + ' ms');
    return map;
  })().finally(() => { _bomInflight = null; });
  return _bomInflight;
}

async function getBatch(batchIdOrNumber) {
  const id = String(batchIdOrNumber).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error('Neplatne cislo davky: "' + batchIdOrNumber + '"');
  }
  const cached = _cache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const raw = await rawGet('/api/batch/' + id);

  const out = {
    id: String(raw.id),
    number: String(raw.number != null ? raw.number : raw.id),
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
      position: raw.workflowOperation.position != null ? raw.workflowOperation.position : null,
      workplace: asString(raw.workflowOperation.stage),
    } : null,
    operations: [],
    source: null,
  };

  const embeddedOps = Array.isArray(raw.workflow && raw.workflow.operations) ? raw.workflow.operations : [];
  if (embeddedOps.length > 0) {
    out.source = 'embedded';
    for (const op of embeddedOps) {
      const bom = Array.isArray(op.billOfMaterialsItems) ? op.billOfMaterialsItems : [];
      out.operations.push({
        id: String(op.id),
        position: op.position != null ? op.position : (op.sequence != null ? op.sequence : (op.operationPosition != null ? op.operationPosition : null)),
        name: asString(op.operationName) || asString(op.name) || op.referenceName || ('Op ' + op.id),
        workplace: asString(op.stage),
        bomItems: bom.map((it) => {
          const t = trimBomItem(it);
          return { id: t.id, goods_id: t.goods_id, code: t.code, name: t.name, unit: t.unit, quantity: t.quantity, perQuantity: t.perQuantity, sequence: t.sequence };
        }),
      });
    }
  } else if (raw.workflowOperation && raw.workflowOperation.workflowEntity && raw.workflowOperation.workflowEntity.id != null) {
    out.source = 'index';
    const wfEntityId = Number(raw.workflowOperation.workflowEntity.id);
    out.workflow = { id: String(wfEntityId) };
    const [woIdx, bomIdx] = await Promise.all([
      ensureWorkflowOperationIndex(),
      ensureBomIndex(),
    ]);
    const ops = woIdx.get(wfEntityId) || [];
    for (const op of ops) {
      const bom = bomIdx.get(Number(op.id)) || [];
      out.operations.push({
        id: op.id,
        position: op.position,
        name: op.name,
        workplace: op.workplace,
        bomItems: bom.map((b) => ({ id: b.id, goods_id: b.goods_id, code: b.code, name: b.name, unit: b.unit, quantity: b.quantity, perQuantity: b.perQuantity, sequence: b.sequence })),
      });
    }
  }

  out.operations.sort((a, b) => {
    const pa = a.position == null ? 9999 : a.position;
    const pb = b.position == null ? 9999 : b.position;
    if (pa !== pb) return pa - pb;
    return Number(a.id) - Number(b.id);
  });

  _cache.set(id, { value: out, ts: Date.now() });
  return out;
}

function clearCache(idOrNumber) {
  if (idOrNumber == null) {
    _cache.clear();
    _woIndex = null; _woTs = 0;
    _bomIndex = null; _bomTs = 0;
    return;
  }
  _cache.delete(String(idOrNumber));
}

module.exports = { getBatch, clearCache };
