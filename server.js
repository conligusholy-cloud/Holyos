/* ============================================
   server.js — Produkční server pro Výroba app

   Funkce:
   - Servíruje statické soubory (frontend)
   - CORS proxy pro Factorify API
   - Přihlášení uživatelů (session-based auth)
   - Správa uživatelů (admin panel)

   Spustit: node server.js
   ============================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==========================================
// Konfigurace
// ==========================================
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hodin

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
  console.error('VAROVÁNÍ: .env soubor nenalezen, používám process.env');
  return {};
}

const envFile = loadEnv();
const BASE_URL = process.env.FACTORIFY_BASE_URL || envFile.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || envFile.FACTORIFY_TOKEN || '';

if (!TOKEN) {
  console.error('CHYBA: FACTORIFY_TOKEN není nastaven!');
  process.exit(1);
}

// ==========================================
// Úložiště uživatelů (JSON soubor)
// ==========================================
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const STORAGE_DIR = path.join(__dirname, 'data', 'storage');

function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function loadUsers() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    // Výchozí admin účet
    const { hash, salt } = hashPassword('admin');
    const users = [
      { id: 1, username: 'admin', displayName: 'Administrátor', hash, salt, role: 'admin', created: new Date().toISOString() }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    console.log('Vytvořen výchozí admin účet: admin / admin');
    return users;
  }
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// ==========================================
// Session management (in-memory)
// ==========================================
const sessions = new Map();

function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    created: Date.now(),
    lastAccess: Date.now(),
  });
  return sessionId;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return null;
  }
  session.lastAccess = Date.now();
  return session;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

// Vyčištění starých sessions každou hodinu
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.created > SESSION_MAX_AGE) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

// ==========================================
// Cookie helpers
// ==========================================
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const [name, ...rest] = c.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function setSessionCookie(res, sessionId) {
  const isSecure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `sid=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}; SameSite=Lax${isSecure ? '; Secure' : ''}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

// ==========================================
// Pomocné funkce
// ==========================================
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ==========================================
// Přihlašovací stránka (inline HTML)
// ==========================================
function getLoginPage(error) {
  const errorHtml = error ? `<div class="error">${error}</div>` : '';
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Přihlášení — HOLYOS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #1e1e2e; --surface: #282840; --surface2: #313150;
      --text: #e0e0f0; --text2: #a0a0c0; --accent: #6c8cff;
      --border: #3a3a5c; --error: #ef4444;
    }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg); color: var(--text);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .login-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 16px; padding: 40px; width: 100%; max-width: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    .login-logo {
      width: 56px; height: 56px;
      border-radius: 14px; display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px; overflow: hidden;
    }
    .login-logo svg { width: 56px; height: 56px; }
    h1 { text-align: center; font-size: 22px; margin-bottom: 4px; }
    .subtitle { text-align: center; color: var(--text2); font-size: 14px; margin-bottom: 28px; }
    label { display: block; font-size: 13px; color: var(--text2); margin-bottom: 6px; margin-top: 16px; }
    input[type="text"], input[type="password"] {
      width: 100%; padding: 10px 14px; background: var(--surface2);
      border: 1px solid var(--border); border-radius: 8px;
      color: var(--text); font-size: 15px; outline: none; transition: border-color 0.2s;
    }
    input:focus { border-color: var(--accent); }
    button {
      width: 100%; padding: 12px; margin-top: 24px; background: var(--accent);
      border: none; border-radius: 8px; color: #fff; font-size: 15px;
      font-weight: 600; cursor: pointer; transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    .error {
      background: rgba(239,68,68,0.15); border: 1px solid var(--error);
      color: var(--error); padding: 10px 14px; border-radius: 8px;
      font-size: 13px; margin-bottom: 8px; text-align: center;
    }
    .footer { text-align: center; color: var(--text2); font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="login-logo"><svg viewBox="0 0 100 100"><defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#6C5CE7"/><stop offset="50%" style="stop-color:#0984E3"/><stop offset="100%" style="stop-color:#00B894"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#lg)"/><rect x="22" y="22" width="10" height="56" rx="4" fill="white"/><rect x="68" y="22" width="10" height="56" rx="4" fill="white"/><rect x="32" y="42" width="36" height="10" rx="4" fill="white"/></svg></div>
    <h1>HOLYOS</h1>
    <p class="subtitle">Přihlaste se pro přístup do systému</p>
    ${errorHtml}
    <form method="POST" action="/auth/login">
      <label for="username">Uživatelské jméno</label>
      <input type="text" id="username" name="username" required autofocus autocomplete="username">
      <label for="password">Heslo</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Přihlásit se</button>
    </form>
    <div class="footer">HOLYOS v0.1 — Best Series</div>
  </div>
</body>
</html>`;
}

// ==========================================
// Admin stránka pro správu uživatelů
// ==========================================
function getAdminPage(session) {
  const users = loadUsers();
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Správa uživatelů — HOLYOS</title>
  <link rel="stylesheet" href="/css/dashboard.css">
  <style>
    .admin-container { max-width: 800px; margin: 0 auto; padding: 20px; }
    .admin-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    .admin-table th, .admin-table td {
      padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border);
    }
    .admin-table th { color: var(--text2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .admin-table tr:hover { background: var(--surface2); }
    .btn { padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-danger { background: var(--error, #ef4444); color: #fff; }
    .btn-small { padding: 4px 10px; font-size: 12px; }
    .form-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
    .form-row input, .form-row select {
      padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-size: 14px;
    }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-admin { background: rgba(108,140,255,0.2); color: var(--accent); }
    .badge-user { background: rgba(160,160,192,0.15); color: var(--text2); }
    .msg { padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; font-size: 13px; }
    .msg-ok { background: rgba(34,197,94,0.15); color: #22c55e; }
    .msg-err { background: rgba(239,68,68,0.15); color: #ef4444; }
    .back-link { color: var(--accent); text-decoration: none; font-size: 14px; }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <aside id="sidebar" class="sidebar"></aside>
  <div class="main-wrapper">
    <div class="main-header">
      <h2>Správa uživatelů</h2>
      <div class="main-header-right">
        <span style="color:var(--text2); font-size:13px;">Přihlášen: ${session.displayName}</span>
      </div>
    </div>
    <div class="main-content">
      <div class="admin-container">
        <div id="msg"></div>

        <h3 style="margin-bottom:4px;">Přidat nového uživatele</h3>
        <form id="addForm" class="form-row">
          <input name="username" placeholder="Uživatelské jméno" required style="flex:1; min-width:140px;">
          <input name="displayName" placeholder="Celé jméno" required style="flex:1; min-width:140px;">
          <input name="password" type="password" placeholder="Heslo" required style="flex:1; min-width:120px;">
          <select name="role"><option value="user">Uživatel</option><option value="admin">Admin</option></select>
          <button type="submit" class="btn btn-primary">Přidat</button>
        </form>

        <table class="admin-table">
          <thead><tr><th>Jméno</th><th>Uživatel</th><th>Role</th><th>Vytvořen</th><th></th></tr></thead>
          <tbody id="userList"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script src="/js/sidebar.js"></script>
  <script>
    renderSidebar('nastaveni');

    var users = ${JSON.stringify(users.map(u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, created: u.created })))};

    function renderUsers() {
      var html = '';
      users.forEach(function(u) {
        var badge = u.role === 'admin' ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-user">Uživatel</span>';
        var date = u.created ? new Date(u.created).toLocaleDateString('cs-CZ') : '—';
        var del = u.username !== 'admin' ? '<button class="btn btn-danger btn-small" onclick="deleteUser('+u.id+')">Smazat</button>' : '';
        html += '<tr><td>'+u.displayName+'</td><td>'+u.username+'</td><td>'+badge+'</td><td>'+date+'</td><td>'+del+'</td></tr>';
      });
      document.getElementById('userList').innerHTML = html;
    }
    renderUsers();

    function showMsg(text, ok) {
      var el = document.getElementById('msg');
      el.className = 'msg ' + (ok ? 'msg-ok' : 'msg-err');
      el.textContent = text;
      setTimeout(function() { el.textContent = ''; el.className = ''; }, 4000);
    }

    document.getElementById('addForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var fd = new FormData(this);
      fetch('/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: fd.get('username'),
          displayName: fd.get('displayName'),
          password: fd.get('password'),
          role: fd.get('role'),
        })
      }).then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.ok) {
            users.push(d.user);
            renderUsers();
            showMsg('Uživatel přidán', true);
            document.getElementById('addForm').reset();
          } else { showMsg(d.error || 'Chyba', false); }
        }).catch(function() { showMsg('Chyba spojení', false); });
    });

    function deleteUser(id) {
      if (!confirm('Opravdu smazat tohoto uživatele?')) return;
      fetch('/auth/users/' + id, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.ok) {
            users = users.filter(function(u) { return u.id !== id; });
            renderUsers();
            showMsg('Uživatel smazán', true);
          } else { showMsg(d.error || 'Chyba', false); }
        }).catch(function() { showMsg('Chyba spojení', false); });
    }
  </script>
</body>
</html>`;
}

// ==========================================
// HTTP Server
// ==========================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const cookies = parseCookies(req);
  const session = getSession(cookies.sid);

  // ---- AUTH ENDPOINTS ----

  // Login page
  if (pathname === '/login') {
    if (req.method === 'GET') {
      if (session) { res.writeHead(302, { Location: '/' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage());
      return;
    }
  }

  // Login action
  if (pathname === '/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const username = (params.get('username') || '').trim();
    const password = params.get('password') || '';

    const users = loadUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage('Nesprávné uživatelské jméno nebo heslo'));
      return;
    }

    const { hash } = hashPassword(password, user.salt);
    if (hash !== user.hash) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage('Nesprávné uživatelské jméno nebo heslo'));
      return;
    }

    const sessionId = createSession(user);
    setSessionCookie(res, sessionId);
    res.writeHead(302, { Location: '/' });
    res.end();
    console.log(`Přihlášen: ${user.displayName} (${user.username})`);
    return;
  }

  // Logout
  if (pathname === '/auth/logout') {
    if (cookies.sid) destroySession(cookies.sid);
    clearSessionCookie(res);
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }

  // Current user info (AJAX)
  if (pathname === '/auth/me' && session) {
    sendJSON(res, 200, { username: session.username, displayName: session.displayName, role: session.role });
    return;
  }

  // ---- REQUIRE AUTH for everything below ----
  if (!session) {
    // Allow static assets for login page
    if (pathname === '/login' || pathname.startsWith('/auth/')) {
      sendJSON(res, 401, { error: 'Nepřihlášen' });
      return;
    }
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }

  // ---- ADMIN: User management ----
  if (pathname === '/admin/users' && session.role === 'admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getAdminPage(session));
    return;
  }

  // API: Add user
  if (pathname === '/auth/users' && req.method === 'POST' && session.role === 'admin') {
    try {
      const body = JSON.parse(await readBody(req));
      const users = loadUsers();

      if (!body.username || !body.password || !body.displayName) {
        sendJSON(res, 400, { error: 'Vyplňte všechna pole' });
        return;
      }
      if (users.find(u => u.username === body.username)) {
        sendJSON(res, 400, { error: 'Uživatel s tímto jménem již existuje' });
        return;
      }

      const { hash, salt } = hashPassword(body.password);
      const newUser = {
        id: Math.max(0, ...users.map(u => u.id)) + 1,
        username: body.username.trim(),
        displayName: body.displayName.trim(),
        hash, salt,
        role: body.role === 'admin' ? 'admin' : 'user',
        created: new Date().toISOString(),
      };
      users.push(newUser);
      saveUsers(users);

      sendJSON(res, 200, { ok: true, user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role, created: newUser.created } });
      console.log(`Nový uživatel: ${newUser.displayName} (${newUser.username})`);
    } catch (e) {
      sendJSON(res, 400, { error: 'Neplatná data' });
    }
    return;
  }

  // API: Delete user
  if (pathname.startsWith('/auth/users/') && req.method === 'DELETE' && session.role === 'admin') {
    const userId = parseInt(pathname.split('/').pop());
    const users = loadUsers();
    const user = users.find(u => u.id === userId);

    if (!user) { sendJSON(res, 404, { error: 'Uživatel nenalezen' }); return; }
    if (user.username === 'admin') { sendJSON(res, 400, { error: 'Admin účet nelze smazat' }); return; }

    const filtered = users.filter(u => u.id !== userId);
    saveUsers(filtered);
    sendJSON(res, 200, { ok: true });
    console.log(`Smazán uživatel: ${user.displayName} (${user.username})`);
    return;
  }

  // ---- FILE STORAGE endpoints ----
  if (pathname.startsWith('/storage/')) {
    const key = pathname.replace('/storage/', '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!key) { sendJSON(res, 400, { error: 'Chybí klíč' }); return; }
    const filePath = path.join(STORAGE_DIR, key + '.json');

    if (req.method === 'GET') {
      try {
        ensureDataDir();
        if (fs.existsSync(filePath)) {
          const data = fs.readFileSync(filePath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        ensureDataDir();
        JSON.parse(body); // validace
        fs.writeFileSync(filePath, body, 'utf-8');
        sendJSON(res, 200, { ok: true, key, size: body.length });
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return;
    }
  }

  // ---- FACTORIFY API PROXY ----
  if (pathname.startsWith('/api/')) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-FySerialization, X-AccountingUnit');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const targetUrl = BASE_URL + pathname + url.search;
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

    const body = await readBody(req);
    if (body) {
      options.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const proxyReq = https.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        const respBody = Buffer.concat(chunks);
        console.log(`  ← ${proxyRes.statusCode} (${respBody.length} bytes)`);
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        });
        res.end(respBody);
      });
    });

    proxyReq.on('error', (err) => {
      console.error('  ✗ Proxy chyba:', err.message);
      sendJSON(res, 502, { error: 'Proxy chyba: ' + err.message });
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
    return;
  }

  // ---- STATIC FILES ----
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Pokud cesta končí / přidej index.html
  if (filePath.endsWith('/')) filePath += 'index.html';

  // Bezpečnost — zabránit přístupu mimo složku
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Neposkytovat .env a users.json
  const basename = path.basename(filePath);
  if (basename === '.env' || basename === 'users.json') {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 — Stránka nenalezena</h1>');
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>500 — Chyba serveru</h1>');
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('=== Výroba — Produkční server ===');
  console.log(`Běží na: http://localhost:${PORT}`);
  console.log(`Factorify API: ${BASE_URL}`);
  console.log(`Token: ${TOKEN.substring(0, 8)}...`);
  console.log('');
  console.log('Výchozí přihlášení: admin / admin');
  console.log('Správa uživatelů: /admin/users');
  console.log('');
});
