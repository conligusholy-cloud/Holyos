// =============================================================================
// HolyOS — Factorify BOM (sestava zboží) bridge — V2
// =============================================================================
// Zjištěno probováním (probe-goods-bom-deeper.js + dump-bom-item-sample.js):
//
//   - GET  /api/goods/{id}                vrací plný Goods objekt, ale
//                                          billOfMaterialItems je vždy [] (Factorify ho
//                                          nehydratuje na entitě, drží separátně).
//
//   - POST /api/query/BillOfMaterialItem  vrací 2282 řádků s polema:
//        {
//          id, position, quantity, proposedQuantity, name, externalId, note,
//          ignored, sequence, createdAt, updatedAt, createdBy, updatedBy,
//          goods    : { id, code, name, ... }   ← child (component)
//          partGoods: { id, code, name, ... }   ← parent (assembly)
//          referenceName
//        }
//
//   - POST /api/query/Goods               vrací flat seznam všech zboží (~31 MB).
//
//   - Výrobky (typu PRODUCT) v Factorify nemají vlastní BillOfMaterialItem —
//     jejich „sestava" je v UI rekonstruovaná z operací. Pro tyto případy
//     použijeme HolyOS lokální data (ProductOperation × OperationMaterial),
//     protože ta jsou synchronizovaná z Factorify.
// =============================================================================

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

// Log do souboru pro snadné zachytávání diagnostiky
const LOG_PATH = path.join(process.cwd(), 'factorify-bom.log');
function flog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  console.log('[factorify-bom]', msg);
}

// ─── Cache ─────────────────────────────────────────────────────────────────

let GOODS_CATALOG = null;            // Map<string fid, {id, code, name, type, unit, status}>
let GOODS_CATALOG_TS = 0;
let BOM_INDEX = null;                // Map<string parentFid, [{ child, quantity, unit, position, externalId, note, ignored }]>
let BOM_INDEX_TS = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

// ─── HTTP helper ──────────────────────────────────────────────────────────

function callFactorify(path, body = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = (method === 'GET' || body == null) ? '' : JSON.stringify(body);
    const headers = {
      'Accept': 'application/json',
      'Cookie': `securityToken=${TOKEN}`,
      'X-AccountingUnit': ACCT,
      'X-FySerialization': 'ui2',
      'Accept-Encoding': 'gzip, deflate', // ušetří přenos i RAM (Factorify často gzipuje)
    };
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''), method, headers,
    }, (res) => {
      // Sbírej do bufferu, NE string += chunk (string concatenation roste exponenciálně v RAM
      //   pro velké odpovědi a dokáže OOM-killem položit Node proces).
      const chunks = [];
      let totalLen = 0;
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(require('zlib').createGunzip());
      else if (enc === 'deflate') stream = res.pipe(require('zlib').createInflate());
      stream.on('data', c => { chunks.push(c); totalLen += c.length; });
      stream.on('end', () => {
        const raw = Buffer.concat(chunks, totalLen).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, raw, length: totalLen });
      });
      stream.on('error', e => reject(new Error('Factorify stream: ' + e.message)));
    });
    req.on('error', e => reject(new Error('Factorify request: ' + e.message)));
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Factorify timeout (>180s)')); });
    if (postData) req.write(postData);
    req.end();
  });
}

function asString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (typeof v['2'] === 'string') return v['2']; // multi-jazykové name objektu
    if (typeof v['1'] === 'string') return v['1'];
    return v.label || v.referenceName || v.name || null;
  }
  return null;
}

function asId(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  if (typeof v === 'object') {
    if (v.id != null) return String(v.id);
    if (v.ID != null) return String(v.ID);
  }
  return null;
}

function extractRows(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data)) return body.data;
  for (const k of Object.keys(body)) {
    if (Array.isArray(body[k])) return body[k];
  }
  return [];
}

// ─── Goods katalog (lookup pro doplnění code/name/type) ───────────────────

async function ensureGoodsCatalog(force) {
  const now = Date.now();
  if (!force && GOODS_CATALOG && (now - GOODS_CATALOG_TS) < CACHE_TTL_MS) {
    return GOODS_CATALOG;
  }
  const t0 = Date.now();
  flog('Stahuji Goods katalog...');
  const r = await callFactorify('/api/query/Goods', {});
  flog(`Goods: HTTP ${r.status}, ${(r.length / 1024 / 1024).toFixed(1)} MB, ${Date.now() - t0} ms`);
  if (r.status !== 200) throw new Error(`Goods katalog: HTTP ${r.status}`);
  const rows = extractRows(r.body);
  // Uvolnit raw response z paměti — už ji nepotřebujeme, dál pracujeme jen s mapou
  r.body = null; r.raw = null;
  const map = new Map();
  for (const g of rows) {
    const id = asId(g.id) || asId(g.ID);
    if (!id) continue;
    map.set(id, {
      id,
      code: asString(g.code) || asString(g.referenceName) || null,
      name: asString(g.name) || asString(g.label) || asString(g.referenceName) || null,
      type: asString(g.type) || null,
      unit: asString(g.unit) || null,
      status: asString(g.state) || null,
    });
  }
  GOODS_CATALOG = map;
  GOODS_CATALOG_TS = now;
  flog(`Goods katalog: ${map.size} položek`);
  return map;
}

// ─── BillOfMaterialItem index (parent_fid → [children]) ───────────────────

async function ensureBomIndex(force) {
  const now = Date.now();
  if (!force && BOM_INDEX && (now - BOM_INDEX_TS) < CACHE_TTL_MS) {
    return BOM_INDEX;
  }
  const t0 = Date.now();
  flog('Stahuji BillOfMaterialItem...');
  const r = await callFactorify('/api/query/BillOfMaterialItem', {});
  flog(`BillOfMaterialItem: HTTP ${r.status}, ${(r.length / 1024 / 1024).toFixed(1)} MB, ${Date.now() - t0} ms`);
  if (r.status !== 200) throw new Error(`BillOfMaterialItem: HTTP ${r.status}`);
  const rows = extractRows(r.body);
  r.body = null; r.raw = null;
  const map = new Map();
  for (const row of rows) {
    if (row.ignored) continue;
    const parentId = asId(row.partGoods);
    const childId = asId(row.goods);
    if (!parentId || !childId) continue;
    const child = (row.goods && typeof row.goods === 'object') ? row.goods : null;
    const item = {
      childId,
      childCode: child ? asString(child.code) : null,
      childName: child ? asString(child.name) : null,
      childType: child ? asString(child.type) : null,
      quantity: Number(row.quantity ?? row.proposedQuantity) || 0,
      unit: asString(row.unit) || null,
      position: row.position != null ? Number(row.position) : null,
      externalId: row.externalId || null,
      note: row.note || null,
    };
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId).push(item);
  }
  // Setřid podle pozice
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  BOM_INDEX = map;
  BOM_INDEX_TS = now;
  flog(`BOM index: ${map.size} parent goods, ${rows.length} řádků celkem`);
  return map;
}

// ─── HolyOS-side fallback: operace + materiály z lokální DB ──────────────
// Když Factorify pro daný Goods nemá BOM (typicky výrobek), použijeme operace
// uložené v HolyOS DB (synchronizované z Factorify přes dump-factorify-fast).
// =============================================================================

async function getOperationsBomFromDb(prisma, factorifyGoodsId) {
  const fidInt = parseInt(factorifyGoodsId);
  // Najdi HolyOS Product odpovídající danému Factorify Goods ID
  const product = await prisma.product.findFirst({
    where: { factorify_id: fidInt || 0 },
    include: {
      operations: {
        include: { materials: { include: { material: true } } },
        orderBy: { step_number: 'asc' },
      },
    },
  });
  if (!product) return null;

  // Posbírej materiály ze všech operací → unikátní list
  const items = [];
  const seen = new Set();
  for (const op of product.operations || []) {
    for (const om of op.materials || []) {
      const mat = om.material;
      if (!mat) continue;
      const key = `${mat.factorify_id || mat.code}_${om.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        childId: mat.factorify_id || null,   // Factorify ID materiálu (string)
        childCode: mat.code,
        childName: mat.name,
        childType: mat.type,
        quantity: Number(om.quantity) || 0,
        unit: om.unit || mat.unit || null,
        viaOperation: op.name,
        sourceOperation: 'holyos_db',
      });
    }
  }
  return items.length > 0 ? { product, items } : null;
}

// ─── Sestavení BOM stromu (rekurzivní) ────────────────────────────────────

/**
 * Postaví strom kusovníku pro daný Factorify Goods.
 *
 * Pro každý uzel:
 *   - Nejdřív zkusí BillOfMaterialItem (přímý Factorify BOM)
 *   - Když je prázdné, fallback na HolyOS operace+materiály (pokud `prisma` k dispozici)
 *
 * @param {string|number} rootGoodsId
 * @param {Object} prisma — Prisma client (pro fallback přes ProductOperation)
 * @returns {Object} root node
 */
// Mutex: zajistí, že paralelní požadavky na sestavu si nezdvojí stahování
// 41+31 MB z Factorify najednou (RAM blow-up + Factorify rate limit).
let _inFlightCatalog = null;
let _inFlightBomIndex = null;

async function _serializedEnsureGoodsCatalog(force) {
  if (!_inFlightCatalog) _inFlightCatalog = ensureGoodsCatalog(force).finally(() => { _inFlightCatalog = null; });
  return _inFlightCatalog;
}
async function _serializedEnsureBomIndex(force) {
  if (!_inFlightBomIndex) _inFlightBomIndex = ensureBomIndex(force).finally(() => { _inFlightBomIndex = null; });
  return _inFlightBomIndex;
}

// Cache hotových stromů (na jeden produkt) — první build trvá minuty,
// druhý request na stejný strom dostane výsledek okamžitě.
const TREE_CACHE = new Map();
const TREE_CACHE_TTL_MS = 30 * 60 * 1000;

async function buildBomTree(rootGoodsId, prisma) {
  const rootKey = String(rootGoodsId);
  const cached = TREE_CACHE.get(rootKey);
  if (cached && (Date.now() - cached.ts) < TREE_CACHE_TTL_MS) {
    flog(`buildBomTree(root=${rootGoodsId}) → CACHE HIT (age ${Math.round((Date.now()-cached.ts)/1000)}s)`);
    return cached.tree;
  }

  flog(`buildBomTree(root=${rootGoodsId}, prisma=${!!prisma}) — cold build`);
  const tBuild = Date.now();
  const catalog = await _serializedEnsureGoodsCatalog(false);
  const bomIndex = await _serializedEnsureBomIndex(false);
  flog(`  catalog=${catalog.size}, bomIndex=${bomIndex.size}`);

  // Memoizace: stejné Goods se expanduje pouze jednou. Sub-strom sdílí referenci
  // (DAG, ne strict tree). UI s tím počítá — needitujeme uzly.
  const subtreeMemo = new Map(); // fid → { children, usedSource }
  const seen = new Set();         // jen pro detekci cyklu na aktuální cestě
  let stats = { expandCalls: 0, memoHits: 0, dbCalls: 0 };

  async function expand(goodsId, qty, unit, depth, sourceHint) {
    const fid = String(goodsId);
    const cat = catalog.get(fid);
    const node = {
      factorify_id: fid,
      code: cat ? cat.code : null,
      name: cat ? cat.name : null,
      type: cat ? cat.type : null,
      unit: unit || (cat ? cat.unit : null),
      quantity: qty,
      source: sourceHint || null,
      children: [],
    };

    stats.expandCalls++;
    if (depth > 15) { node.maxDepth = true; return node; }
    if (seen.has(fid)) { node.cycle = true; return node; }

    // MEMO HIT: stejné Goods už vybudované — sdílíme sub-strom (DAG, ne strict tree).
    // Šetří desítky až stovky DB callů + Factorify lookups u opakovaně použitých polotovarů.
    if (subtreeMemo.has(fid)) {
      stats.memoHits++;
      const memo = subtreeMemo.get(fid);
      node.children = memo.children; // sdílená reference
      node.source = memo.usedSource || sourceHint;
      return node;
    }

    seen.add(fid);

    let children = bomIndex.get(fid) || [];
    let usedSource = 'fy_bom';
    if (children.length === 0 && prisma) {
      stats.dbCalls++;
      const opBom = await getOperationsBomFromDb(prisma, fid);
      if (opBom && opBom.items.length > 0) {
        children = opBom.items;
        usedSource = 'holyos_ops';
      }
    }

    for (const ch of children) {
      // ch.childId může být null pro materiály bez factorify_id v HolyOS DB
      if (!ch.childId) {
        // Vlož "syntetický" leaf bez factorify_id, ale s code+name z HolyOS
        node.children.push({
          factorify_id: null,
          code: ch.childCode,
          name: ch.childName,
          type: ch.childType,
          quantity: ch.quantity,
          unit: ch.unit,
          source: usedSource + '_no_fid',
          viaOperation: ch.viaOperation,
          children: [],
        });
        continue;
      }
      const sub = await expand(ch.childId, ch.quantity, ch.unit, depth + 1, usedSource);
      // Doplň label z BOM řádku, pokud není v katalogu
      if (!sub.code && ch.childCode) sub.code = ch.childCode;
      if (!sub.name && ch.childName) sub.name = ch.childName;
      if (!sub.type && ch.childType) sub.type = ch.childType;
      if (ch.viaOperation) sub.viaOperation = ch.viaOperation;
      if (ch.note) sub.note = ch.note;
      if (ch.externalId) sub.externalId = ch.externalId;
      node.children.push(sub);
    }

    seen.delete(fid);
    // Ulož sub-strom do memo — pro další `expand(fid, ...)` v rámci tohoto buildu
    // (s libovolným qty) sdílíme `children` referenci.
    subtreeMemo.set(fid, { children: node.children, usedSource });
    return node;
  }

  const root = await expand(rootGoodsId, 1, null, 0, null);
  // Diag
  root.bomIndexSize = bomIndex.size;
  root.catalogSize = catalog.size;
  root.stats = { ...stats, totalMs: Date.now() - tBuild, uniqueGoods: subtreeMemo.size };
  flog(`buildBomTree DONE — expandCalls=${stats.expandCalls}, memoHits=${stats.memoHits}, dbCalls=${stats.dbCalls}, ms=${Date.now() - tBuild}, unique=${subtreeMemo.size}`);

  TREE_CACHE.set(rootKey, { tree: root, ts: Date.now() });
  return root;
}

function resetCache() {
  GOODS_CATALOG = null;
  GOODS_CATALOG_TS = 0;
  BOM_INDEX = null;
  BOM_INDEX_TS = 0;
  TREE_CACHE.clear();
}

module.exports = {
  buildBomTree,
  ensureGoodsCatalog,
  ensureBomIndex,
  callFactorify,
  resetCache,
};
