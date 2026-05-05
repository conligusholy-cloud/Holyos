// =============================================================================
// HolyOS — Factorify API client
// Sdílený HTTP klient pro volání /api/query/<entity> a /api/metadata/entity/<entity>.
// Nahrazuje copy-paste callFactorify() ve scriptech (dump-factorify, factorify-bom...).
//
// Auth: cookie securityToken + headers X-AccountingUnit, X-FySerialization=ui2.
//
// Funkce:
//   query(entityName, body?, opts?)        — POST /api/query/<entity>, vrací array záznamů
//   metadata(entityName)                   — GET  /api/metadata/entity/<entity>
//   queryStream(entityName, body, onRecord)— streaming pro mega entity (StockMove apod.)
//
// Konfigurace (env):
//   FACTORIFY_BASE_URL          výchozí https://bs.factorify.cloud
//   FACTORIFY_TOKEN             povinné
//   FACTORIFY_ACCOUNTING_UNIT   výchozí '1'
// =============================================================================

const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCOUNTING_UNIT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function assertConfigured() {
  if (!TOKEN) {
    throw new Error('FACTORIFY_TOKEN není nastaven v env. Přidej ho do .env nebo Railway variables.');
  }
}

function authHeaders(extra = {}) {
  return {
    'Accept': 'application/json',
    'Cookie': `securityToken=${TOKEN}`,
    'X-AccountingUnit': ACCOUNTING_UNIT,
    'X-FySerialization': 'ui2',
    ...extra,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Nízkoúrovňová HTTPS volání ───────────────────────────────────────────

/**
 * Provede HTTPS request, vrací Buffer (raw response body).
 * Vyhazuje při HTTP != 200, timeout, network error.
 */
function rawRequest({ method = 'POST', urlPath, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} }) {
  assertConfigured();
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const postData = (method === 'GET' || body == null) ? null : JSON.stringify(body);
    const reqHeaders = authHeaders({
      ...headers,
      ...(postData != null
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        : {}),
    });
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + (url.search || ''),
      method,
      headers: reqHeaders,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      let totalSize = 0;
      res.on('data', c => { chunks.push(c); totalSize += c.length; });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          const preview = buf.slice(0, 500).toString('utf8');
          reject(new Error(`Factorify HTTP ${res.statusCode} ${urlPath}: ${preview}`));
          return;
        }
        resolve({ buffer: buf, totalSize, headers: res.headers });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Factorify timeout po ${timeoutMs}ms na ${urlPath}`));
    });
    if (postData != null) req.write(postData);
    req.end();
  });
}

async function rawRequestWithRetry(opts, retries = DEFAULT_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await rawRequest(opts);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// ─── Veřejné API ──────────────────────────────────────────────────────────

/**
 * Extrahuje pole záznamů z odpovědi Factorify Stage API.
 * Faktorify vrací: pole / { rows } / { items } / { records } / { data } / { <první_array> }
 */
function extractRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.records)) return parsed.records;
    if (Array.isArray(parsed.data)) return parsed.data;
    for (const k of Object.keys(parsed)) {
      if (Array.isArray(parsed[k])) return parsed[k];
    }
    return [parsed];
  }
  return [];
}

/**
 * POST /api/query/<entityName>
 * @param {string} entityName  - název entity (např. "Stock", "PurchaseOrder")
 * @param {object} body        - tělo požadavku (filtry, paginace) — záleží na entitě
 * @param {object} opts        - { timeoutMs, retries }
 * @returns {Promise<Array>}   - pole záznamů
 */
async function query(entityName, body = {}, opts = {}) {
  const { buffer, totalSize } = await rawRequestWithRetry({
    method: 'POST',
    urlPath: `/api/query/${entityName}`,
    body,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }, opts.retries ?? DEFAULT_RETRIES);

  // Velké odpovědi: warning do logu (přes 50MB se dělá problém s pamětí)
  if (totalSize > 50 * 1024 * 1024) {
    console.warn(`[factorify] ⚠ ${entityName}: ${(totalSize / 1024 / 1024).toFixed(0)}MB — použij queryStream() místo query()`);
  }

  let text;
  try { text = buffer.toString('utf8'); }
  catch (e) { throw new Error(`Factorify ${entityName}: response příliš velká (${totalSize}B), použij queryStream()`); }

  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error(`Factorify ${entityName}: neplatný JSON: ${e.message}`); }

  return extractRows(parsed);
}

/**
 * GET /api/metadata/entity/<entityName>
 * Vrací schéma entity (fields, label, tabs, ...) bez stahování dat.
 */
async function metadata(entityName, opts = {}) {
  const { buffer } = await rawRequestWithRetry({
    method: 'GET',
    urlPath: `/api/metadata/entity/${entityName}`,
    timeoutMs: opts.timeoutMs ?? 30_000,
  }, opts.retries ?? DEFAULT_RETRIES);

  const text = buffer.toString('utf8');
  return JSON.parse(text);
}

/**
 * Streamuje POST /api/query/<entityName> a volá onRecord(record) pro každý záznam.
 * Nepřevádí celou odpověď na string ani neudržuje v paměti — vhodné pro mega entity
 * (StockMove, StockDocument, StockItem, ...).
 *
 * Vyžaduje, aby Factorify vrátil odpověď jako JSON pole na nejvyšší úrovni nebo
 * jako objekt s polem v rows/items/records/data. Streaming JSON parser detekuje
 * začátek pole a postupně vyřízne každý záznam.
 *
 * @param {string} entityName
 * @param {object} body              filtr / paginace
 * @param {function} onRecord        async/sync callback (record) => any
 * @param {object} opts              { timeoutMs, retries, batchSize, onProgress }
 * @returns {Promise<{count, sizeBytes}>}
 */
async function queryStream(entityName, body, onRecord, opts = {}) {
  assertConfigured();
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000; // 30 min default
  const onProgress = opts.onProgress; // (count) => void
  const progressEvery = opts.progressEvery ?? 1000;

  const url = new URL(`/api/query/${entityName}`, BASE_URL);
  const postData = JSON.stringify(body || {});
  const reqOpts = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    }),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(reqOpts, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const preview = Buffer.concat(chunks).slice(0, 500).toString('utf8');
          reject(new Error(`Factorify HTTP ${res.statusCode}: ${preview}`));
        });
        return;
      }

      // Streaming JSON parser: hledá první [{ a pak postupně řeže objekty
      let phase = 'pre-array'; // pre-array | in-array | done
      let depth = 0;
      let inString = false;
      let escape = false;
      let buf = Buffer.alloc(0);
      let recordStart = -1;
      let count = 0;
      let totalSize = 0;
      let error = null;

      function processBuffer() {
        const text = buf.toString('utf8');
        let i = 0;
        if (phase === 'pre-array') {
          // najdi začátek pole [
          while (i < text.length) {
            const c = text[i];
            if (inString) {
              if (escape) { escape = false; }
              else if (c === '\\') { escape = true; }
              else if (c === '"') { inString = false; }
              i++; continue;
            }
            if (c === '"') { inString = true; i++; continue; }
            if (c === '[') {
              phase = 'in-array';
              i++;
              break;
            }
            i++;
          }
          if (phase !== 'in-array') {
            buf = Buffer.from(text.substring(i));
            return;
          }
        }

        // V poli: hledej objekty
        let consumed = i;
        while (i < text.length && phase === 'in-array') {
          const c = text[i];
          if (inString) {
            if (escape) { escape = false; }
            else if (c === '\\') { escape = true; }
            else if (c === '"') { inString = false; }
            i++; continue;
          }
          if (c === '"') { inString = true; i++; continue; }
          if (c === '{') {
            if (depth === 0) recordStart = i;
            depth++;
            i++; continue;
          }
          if (c === '}') {
            depth--;
            if (depth === 0 && recordStart >= 0) {
              const recordText = text.substring(recordStart, i + 1);
              try {
                const record = JSON.parse(recordText);
                count++;
                const result = onRecord(record);
                if (result && typeof result.then === 'function') {
                  // Pozor: streaming + async callback by měl zastavit čtení streamu.
                  // Zde to neděláme - kdo chce backpressure, ať si batchuje sám.
                }
                if (onProgress && count % progressEvery === 0) {
                  onProgress(count);
                }
              } catch (e) {
                error = new Error(`Stream parse record #${count + 1}: ${e.message}`);
                phase = 'done';
                req.destroy();
                return;
              }
              recordStart = -1;
              consumed = i + 1;
            }
            i++; continue;
          }
          if (c === ']' && depth === 0) {
            phase = 'done';
            consumed = i + 1;
            break;
          }
          i++;
        }
        // Zachovat nedokončené části pro další chunk
        if (phase === 'in-array' && recordStart >= 0) {
          // Nedokončený objekt — zachovat od jeho začátku
          buf = Buffer.from(text.substring(recordStart));
          recordStart = 0;
        } else {
          buf = Buffer.from(text.substring(consumed));
        }
      }

      res.on('data', (chunk) => {
        if (phase === 'done') return;
        totalSize += chunk.length;
        buf = Buffer.concat([buf, chunk]);
        // Volej onChunk pro progress download bytes (per HTTP chunk)
        if (opts.onChunk) opts.onChunk({ totalSize, chunkSize: chunk.length, recordsParsed: count });
        // Procesuj jen pokud máme rozumnou velikost (efektivita)
        if (buf.length > 64 * 1024 || phase === 'pre-array') {
          processBuffer();
        }
      });

      res.on('end', () => {
        if (error) { reject(error); return; }
        if (buf.length > 0) processBuffer();
        if (onProgress) onProgress(count);
        resolve({ count, sizeBytes: totalSize });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Factorify stream timeout po ${timeoutMs}ms na ${entityName}`));
    });
    req.write(postData);
    req.end();
  });
}

// ─── Diagnostika ──────────────────────────────────────────────────────────

function getConfig() {
  return {
    baseUrl: BASE_URL,
    accountingUnit: ACCOUNTING_UNIT,
    tokenSet: !!TOKEN,
    tokenPreview: TOKEN ? TOKEN.substring(0, 10) + '...' : null,
  };
}

module.exports = {
  query,
  metadata,
  queryStream,
  extractRows,
  getConfig,
};
