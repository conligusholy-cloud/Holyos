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
const db = require('./db');

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
    is_super_admin: user.is_super_admin || 0,
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

    // Check if user is super admin (from people DB)
    const allPeople = db.getAllPeople({});
    const personRecord = allPeople.find(p => p.username === user.username);
    user.is_super_admin = personRecord && personRecord.is_super_admin ? 1 : 0;

    const sessionId = createSession(user);
    setSessionCookie(res, sessionId);
    res.writeHead(302, { Location: '/' });
    res.end();
    console.log(`Přihlášen: ${user.displayName} (${user.username})${user.is_super_admin ? ' [SUPER ADMIN]' : ''}`);
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
    sendJSON(res, 200, { username: session.username, displayName: session.displayName, role: session.role, is_super_admin: session.is_super_admin || 0 });
    return;
  }

  // Set current user context for audit logging
  if (session) {
    db.setCurrentUser({ username: session.username, displayName: session.displayName });
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

  // ---- ADMIN TASKS API ----
  if (pathname.startsWith('/api/admin-tasks')) {
    // GET /api/admin-tasks — list tasks (anyone can create, only admin sees all)
    if (pathname === '/api/admin-tasks' && req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        status: url.searchParams.get('status') || undefined,
        page: url.searchParams.get('page') || undefined,
      };
      const tasks = db.getAdminTasks(filters);
      sendJSON(res, 200, tasks);
      return;
    }

    // POST /api/admin-tasks — create a new task (any authenticated user)
    if (pathname === '/api/admin-tasks' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const task = JSON.parse(body);
          task.created_by = { username: session.username, displayName: session.displayName };
          const result = db.createAdminTask(task);
          sendJSON(res, 201, result);
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
        }
      });
      return;
    }

    // GET /api/admin-tasks/:id
    const taskGetMatch = pathname.match(/^\/api\/admin-tasks\/(\d+)$/);
    if (taskGetMatch && req.method === 'GET') {
      const task = db.getAdminTask(parseInt(taskGetMatch[1]));
      if (!task) { sendJSON(res, 404, { error: 'Požadavek nenalezen' }); return; }
      sendJSON(res, 200, task);
      return;
    }

    // PUT /api/admin-tasks/:id — update task (super admin only)
    if (taskGetMatch && req.method === 'PUT') {
      if (!session.is_super_admin) { sendJSON(res, 403, { error: 'Přístup odepřen' }); return; }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const updates = JSON.parse(body);
          const result = db.updateAdminTask(parseInt(taskGetMatch[1]), updates);
          if (!result) { sendJSON(res, 404, { error: 'Požadavek nenalezen' }); return; }
          sendJSON(res, 200, result);
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
        }
      });
      return;
    }

    // DELETE /api/admin-tasks/:id — delete task (super admin only)
    if (taskGetMatch && req.method === 'DELETE') {
      if (!session.is_super_admin) { sendJSON(res, 403, { error: 'Přístup odepřen' }); return; }
      const ok = db.deleteAdminTask(parseInt(taskGetMatch[1]));
      if (!ok) { sendJSON(res, 404, { error: 'Požadavek nenalezen' }); return; }
      sendJSON(res, 200, { ok: true });
      return;
    }
  }

  // ---- AUDIT LOG API (super admin only) ----
  if (pathname.startsWith('/api/audit')) {
    // Check super admin
    if (!session.is_super_admin) {
      sendJSON(res, 403, { error: 'Přístup odepřen — vyžaduje Super Admin' });
      return;
    }

    // GET /api/audit — list audit entries
    if (pathname === '/api/audit' && req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        entity: url.searchParams.get('entity') || undefined,
        user: url.searchParams.get('user') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      };
      const entries = db.getAuditLog(filters);
      sendJSON(res, 200, entries);
      return;
    }

    // GET /api/audit/:id — get single entry with snapshot
    const entryMatch = pathname.match(/^\/api\/audit\/(\d+)$/);
    if (entryMatch && req.method === 'GET') {
      const entry = db.getAuditEntry(parseInt(entryMatch[1]));
      if (!entry) { sendJSON(res, 404, { error: 'Záznam nenalezen' }); return; }
      // Return without full snapshot (just metadata)
      const { snapshot, ...rest } = entry;
      rest.hasSnapshot = !!snapshot;
      sendJSON(res, 200, rest);
      return;
    }

    // POST /api/audit/:id/rollback — rollback to this point
    const rollbackMatch = pathname.match(/^\/api\/audit\/(\d+)\/rollback$/);
    if (rollbackMatch && req.method === 'POST') {
      const id = parseInt(rollbackMatch[1]);
      const success = db.rollbackToEntry(id);
      if (!success) { sendJSON(res, 404, { error: 'Záznam nenalezen nebo nemá snapshot' }); return; }
      sendJSON(res, 200, { ok: true, message: `Systém vrácen do bodu #${id}` });
      return;
    }
  }

  // ---- PERMISSIONS API ----
  if (pathname.startsWith('/api/hr/permissions')) {
    // GET /api/hr/permissions — get all permissions
    if (pathname === '/api/hr/permissions' && req.method === 'GET') {
      sendJSON(res, 200, db.getPermissions());
      return;
    }

    // GET /api/hr/permissions/:roleId — get permissions for a role
    const rolePermMatch = pathname.match(/^\/api\/hr\/permissions\/(\d+)$/);
    if (rolePermMatch && req.method === 'GET') {
      sendJSON(res, 200, db.getPermissionsForRole(parseInt(rolePermMatch[1])));
      return;
    }

    // POST /api/hr/permissions/:roleId — set permissions for a role (admin only)
    if (rolePermMatch && req.method === 'POST') {
      if (session.role !== 'admin' && !session.is_super_admin) {
        sendJSON(res, 403, { error: 'Přístup odepřen' });
        return;
      }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const perms = JSON.parse(body);
          const result = db.setPermissions(parseInt(rolePermMatch[1]), perms);
          sendJSON(res, 200, result);
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
        }
      });
      return;
    }
  }

  // ---- HR MODULE API ----
  if (pathname.startsWith('/api/hr/')) {
    const handleHR = require('./api/hr');
    const handled = await handleHR(req, res, pathname);
    if (handled) return;
  }

  // ---- WAREHOUSE & PURCHASING API ----
  if (pathname.startsWith('/api/wh/')) {
    const handleWarehouse = require('./api/warehouse');
    const handled = await handleWarehouse(req, res, pathname);
    if (handled) return;
  }

  // ---- MINDMAP NOTES & VERSIONS API ----
  const MINDMAP_FILE = path.join(__dirname, 'data', 'mindmap-notes.json');
  const MINDMAP_VERSIONS_FILE = path.join(__dirname, 'data', 'mindmap-versions.json');

  function loadMindmapData() {
    try { return JSON.parse(fs.readFileSync(MINDMAP_FILE, 'utf-8')); }
    catch (e) { return { notes: {}, featuresOverride: {}, descOverride: {}, connectionsOverride: {}, reviewed: {} }; }
  }

  function saveMindmapData(data) {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(MINDMAP_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  function loadVersions() {
    try { return JSON.parse(fs.readFileSync(MINDMAP_VERSIONS_FILE, 'utf-8')); }
    catch (e) { return []; }
  }

  function saveVersion(description, snapshot) {
    const versions = loadVersions();
    versions.push({
      id: versions.length + 1,
      date: new Date().toISOString(),
      description,
      snapshot, // full copy of mindmap-notes.json data
    });
    // Keep max 50 versions
    while (versions.length > 50) versions.shift();
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(MINDMAP_VERSIONS_FILE, JSON.stringify(versions, null, 2), 'utf-8');
    return versions[versions.length - 1];
  }

  // GET current mindmap data
  if (pathname === '/api/mindmap/notes' && req.method === 'GET') {
    sendJSON(res, 200, loadMindmapData());
    return;
  }

  // SAVE mindmap data (notes only — no structural changes)
  if (pathname === '/api/mindmap/notes' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const current = loadMindmapData();
      // Only update notes, preserve overrides
      current.notes = body.notes || current.notes;
      saveMindmapData(current);
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // COMMIT AI changes — saves features + creates version
  if (pathname === '/api/mindmap/commit' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { moduleId, features, desc, connections, changes } = body;
      if (!moduleId || !features) {
        sendJSON(res, 400, { error: 'moduleId and features required' });
        return;
      }

      // Save snapshot of current state BEFORE change
      const currentData = loadMindmapData();
      saveVersion('Před změnou: ' + (changes || moduleId), JSON.parse(JSON.stringify(currentData)));

      // Apply the change
      if (!currentData.featuresOverride) currentData.featuresOverride = {};
      if (!currentData.descOverride) currentData.descOverride = {};
      if (!currentData.connectionsOverride) currentData.connectionsOverride = {};

      currentData.featuresOverride[moduleId] = features;
      if (desc) currentData.descOverride[moduleId] = desc;
      if (connections) currentData.connectionsOverride[moduleId] = connections;

      // Clear the note for this module (it's been applied)
      if (currentData.notes && currentData.notes[moduleId]) {
        currentData.notes[moduleId] = '';
      }

      // Remove old legacy applied
      if (currentData.applied) delete currentData.applied[moduleId];

      saveMindmapData(currentData);

      // Save snapshot AFTER change
      const ver = saveVersion('AI: ' + (changes || 'Struktura aktualizována — ' + moduleId), JSON.parse(JSON.stringify(currentData)));

      sendJSON(res, 200, { ok: true, version: ver.id });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // TOGGLE reviewed/locked status for a feature
  if (pathname === '/api/mindmap/reviewed' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { moduleId, featureIndex, value } = body;
      if (!moduleId || featureIndex === undefined) {
        sendJSON(res, 400, { error: 'moduleId and featureIndex required' });
        return;
      }
      const current = loadMindmapData();
      if (!current.reviewed) current.reviewed = {};
      if (!current.reviewed[moduleId]) current.reviewed[moduleId] = {};
      current.reviewed[moduleId][String(featureIndex)] = !!value;
      saveMindmapData(current);
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // GET version history
  if (pathname === '/api/mindmap/versions' && req.method === 'GET') {
    sendJSON(res, 200, loadVersions().map(v => ({ id: v.id, date: v.date, description: v.description })));
    return;
  }

  // RESTORE a specific version
  const versionMatch = pathname.match(/^\/api\/mindmap\/versions\/(\d+)\/restore$/);
  if (versionMatch && req.method === 'POST') {
    try {
      const versionId = parseInt(versionMatch[1]);
      const versions = loadVersions();
      const version = versions.find(v => v.id === versionId);
      if (!version) { sendJSON(res, 404, { error: 'Version not found' }); return; }

      // Save current as version before restoring
      const currentData = loadMindmapData();
      saveVersion('Před obnovením verze #' + versionId, JSON.parse(JSON.stringify(currentData)));

      // Restore
      saveMindmapData(version.snapshot);
      sendJSON(res, 200, { ok: true, restored: versionId });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // ---- MINDMAP AI APPLY — intelligent note processing ----
  if (pathname === '/api/mindmap/ai-apply' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { moduleData, notes, lockedFeatures } = JSON.parse(body);
      if (!moduleData || !notes) {
        sendJSON(res, 400, { error: 'Missing moduleData or notes' });
        return;
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        sendJSON(res, 500, { error: 'ANTHROPIC_API_KEY not configured' });
        return;
      }

      // Build prompt for Claude
      const prompt = `Jsi expert na strukturování myšlenkových map pro firemní systém HOLYOS.

Dostáváš modul myšlenkové mapy a poznámky uživatele. Tvým úkolem je INTELIGENTNĚ zapracovat poznámky do struktury modulu.

## Aktuální modul:
- ID: ${moduleData.id}
- Název: ${moduleData.label}
- Popis: ${moduleData.desc}
- Aktuální features: ${JSON.stringify(moduleData.features, null, 2)}
- Connections: ${JSON.stringify(moduleData.connections || [])}

## Poznámky uživatele k zapracování:
${notes}

## ZAMČENÉ FEATURES (NESMÍŠ MĚNIT):
${lockedFeatures && lockedFeatures.length > 0 ? lockedFeatures.map(f => '- ' + f).join('\n') : '(žádné)'}
Zamčené features musíš zachovat PŘESNĚ tak jak jsou — nesmíš je přejmenovávat, mazat, slučovat ani měnit jejich sub-items!

## Instrukce:
1. Analyzuj poznámky a porozuměj záměru uživatele
2. Restrukturalizuj features modulu tak, aby odrážely požadavky z poznámek
3. Pokud uživatel chce rozdělit něco na části, vytvoř hierarchickou strukturu (features mohou být stringy nebo objekty {text, sub: [...]})
4. Pokud poznámka zmiňuje propojení s jiným modulem, přidej do connections
5. Pokud poznámka mění popis modulu, uprav desc
6. Zachovej existující features které nejsou v rozporu s poznámkami
7. DŮLEŽITÉ: Zamčené features MUSÍŠ zachovat beze změny ve výstupu!
8. Features mohou být:
   - Prostý string: "Evidence zaměstnanců"
   - Objekt s podkategoriemi: {"text": "Evidence lidí", "sub": ["Lidé obecně — kontakty, dodavatelé, zákazníci", "Zaměstnanci — smlouvy, docházka, mzdy"]}

Vrať POUZE validní JSON objekt (bez markdown, bez komentářů) s touto strukturou:
{
  "features": [...],
  "connections": [...],
  "desc": "...",
  "changes": "Stručný popis provedených změn v češtině (1-2 věty)"
}`;

      // Call Anthropic API
      const requestBody = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      });

      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(requestBody),
          }
        }, (aiRes) => {
          let data = '';
          aiRes.on('data', chunk => data += chunk);
          aiRes.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (aiRes.statusCode !== 200) {
                reject(new Error(parsed.error?.message || `API error ${aiRes.statusCode}`));
                return;
              }
              const text = parsed.content?.[0]?.text || '';
              // Extract JSON from response (strip potential markdown fences)
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (!jsonMatch) {
                reject(new Error('AI response did not contain valid JSON'));
                return;
              }
              resolve(JSON.parse(jsonMatch[0]));
            } catch (e) {
              reject(new Error('Failed to parse AI response: ' + e.message));
            }
          });
        });
        aiReq.on('error', reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error('AI request timeout')); });
        aiReq.write(requestBody);
        aiReq.end();
      });

      sendJSON(res, 200, { ok: true, result: aiResult });
    } catch (e) {
      console.error('AI apply error:', e.message);
      sendJSON(res, 500, { error: e.message });
    }
    return;
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
  if (filePath.endsWith('/') || filePath.endsWith('\\')) filePath = path.join(filePath, 'index.html');

  // Pokud je to adresář, přidej index.html
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (_) {}

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
