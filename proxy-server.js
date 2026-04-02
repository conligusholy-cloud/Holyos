/* ============================================
   proxy-server.js — CORS proxy pro Factorify API
   Spustit: node proxy-server.js
   ============================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROXY_PORT = 3001;

// Načíst .env
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const p of envPaths) {
    try {
      const text = fs.readFileSync(p, 'utf-8');
      const env = {};
      text.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const eq = line.indexOf('=');
        if (eq < 0) return;
        env[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
      });
      console.log('Načten .env z:', p);
      return env;
    } catch (e) {}
  }
  console.error('CHYBA: .env soubor nenalezen!');
  return {};
}

const env = loadEnv();
const BASE_URL = env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = env.FACTORIFY_TOKEN || '';

if (!TOKEN) {
  console.error('CHYBA: FACTORIFY_TOKEN není nastaven v .env!');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // CORS hlavičky
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-FySerialization, X-AccountingUnit');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Diagnostický endpoint — otestuje víc API cest najednou
  if (req.url === '/test-endpoints') {
    // Společné hlavičky z Factorify UI
    const fyHeaders = { 'X-FySerialization': 'ui2', 'X-AccountingUnit': '1' };
    const endpoints = [
      // Klíčové: s X-AccountingUnit hlavičkou (z Factorify UI)
      { method: 'GET', path: '/api/stage', headers: fyHeaders },
      { method: 'GET', path: '/api/query/Stage', headers: fyHeaders },
      { method: 'GET', path: '/api/grid/Stage', headers: fyHeaders },
      { method: 'GET', path: '/api/metadata/grid/Stage', headers: fyHeaders },
      // POST varianty s UI hlavičkami
      { method: 'POST', path: '/api/stage', body: '{}', headers: fyHeaders },
      { method: 'POST', path: '/api/query/Stage', body: '{}', headers: fyHeaders },
      { method: 'POST', path: '/api/grid/Stage', body: '{}', headers: fyHeaders },
      { method: 'POST', path: '/api/grid/Stage', body: '{"take":50}', headers: fyHeaders },
      // Bez AccountingUnit pro porovnání
      { method: 'GET', path: '/api/stage', headers: {} },
      { method: 'GET', path: '/api/grid/Stage', headers: {} },
    ];
    const results = [];
    let done = 0;
    for (const ep of endpoints) {
      const testUrl = new URL(BASE_URL + ep.path);
      const opts = {
        hostname: testUrl.hostname,
        port: 443,
        path: testUrl.pathname + testUrl.search,
        method: ep.method,
        headers: {
          'Accept': 'application/json',
          'Cookie': 'securityToken=' + TOKEN,
          ...(ep.headers || {}),
        },
      };
      if (ep.body) {
        if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(ep.body);
      }
      const extraInfo = Object.keys(ep.headers || {}).map(k => `${k}:${ep.headers[k]}`).join(',');
      const label = `${ep.method} ${ep.path}` + (ep.body ? ` [${ep.body}]` : '') + (extraInfo ? ` {${extraInfo}}` : '');
      const r = https.request(opts, (pRes) => {
        let chunks = [];
        pRes.on('data', c => chunks.push(c));
        pRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8').substring(0, 300);
          results.push({ endpoint: label, status: pRes.statusCode, body });
          console.log(`  TEST ${label} → ${pRes.statusCode}`);
          done++;
          if (done === endpoints.length) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(results, null, 2));
          }
        });
      });
      r.on('error', (err) => {
        results.push({ endpoint: label, status: 'ERROR', body: err.message });
        done++;
        if (done === endpoints.length) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(results, null, 2));
        }
      });
      if (ep.body) r.write(ep.body);
      r.end();
    }
    return;
  }

  // ==========================================
  // File-based storage endpointy (persistentní úložiště)
  // ==========================================
  const STORAGE_DIR = path.join(__dirname, 'data', 'storage');

  if (req.url.startsWith('/storage/')) {
    const key = req.url.replace('/storage/', '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!key) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Chybí klíč' }));
      return;
    }
    const filePath = path.join(STORAGE_DIR, key + '.json');

    // GET — načíst data
    if (req.method === 'GET') {
      try {
        if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
        if (fs.existsSync(filePath)) {
          const data = fs.readFileSync(filePath, 'utf-8');
          console.log(`  📂 LOAD ${key} (${data.length} bytes)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST — uložit data
    if (req.method === 'POST') {
      let bodyChunks = [];
      req.on('data', chunk => bodyChunks.push(chunk));
      req.on('end', () => {
        try {
          if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
          const body = Buffer.concat(bodyChunks).toString('utf-8');
          // Validace JSON
          JSON.parse(body);
          fs.writeFileSync(filePath, body, 'utf-8');
          console.log(`  💾 SAVE ${key} (${body.length} bytes)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, key, size: body.length }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // Pouze /api/* požadavky
  if (!req.url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Pouze /api/* endpointy' }));
    return;
  }

  const targetUrl = BASE_URL + req.url;
  console.log(`→ ${req.method} ${targetUrl}`);

  const urlObj = new URL(targetUrl);
  const options = {
    hostname: urlObj.hostname,
    port: 443,
    path: urlObj.pathname + urlObj.search,
    method: req.method,
    headers: {
      'Accept': 'application/json',
      'Cookie': 'securityToken=' + TOKEN,
      'X-AccountingUnit': '1',
      'X-FySerialization': 'ui2',
    },
  };

  // Sbírat POST body, pokud existuje
  let bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : null;

    if (body) {
      options.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      options.headers['Content-Length'] = body.length;
    }

    const proxyReq = https.request(options, (proxyRes) => {
      // Sbírat odpověď pro logování
      let respChunks = [];
      proxyRes.on('data', chunk => respChunks.push(chunk));
      proxyRes.on('end', () => {
        const respBody = Buffer.concat(respChunks);
        const respText = respBody.toString('utf-8').substring(0, 500);
        console.log(`  ← ${proxyRes.statusCode} (${respBody.length} bytes)`);
        if (proxyRes.statusCode >= 400) {
          console.log(`  ← Body: ${respText}`);
        }
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(respBody);
      });
    });

    proxyReq.on('error', (err) => {
      console.error('  ✗ Proxy chyba:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy chyba: ' + err.message }));
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log('');
  console.log('=== Factorify CORS Proxy ===');
  console.log(`Běží na: http://localhost:${PROXY_PORT}`);
  console.log(`Přeposílá na: ${BASE_URL}`);
  console.log(`Token: ${TOKEN.substring(0, 8)}...`);
  console.log('');
  console.log('Příklad: http://localhost:3001/api/query/Stage');
  console.log('Ctrl+C pro ukončení');
  console.log('');
});
