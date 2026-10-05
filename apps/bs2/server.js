// BS2 — soukromá sekce Best Series (www.bestseries2.cz). Samostatná aplikace oddělená od HolyOS:
// vlastní server, DB (DATABASE_URL) i doména. S HolyOS ji pojí jen SSO pro správce (Tomáš, Jan).
//
// Dva druhy přihlášení:
//   • SPRÁVCE — z HolyOS: GET /api/auth/sso/bs2 → /sso?t=<JWT, BS2_SSO_SECRET, 2 min> → cookie bs2_admin (12 h)
//   • PODPOROVATEL — e-mail musí být v tabulce supporters (import CSV/XLSX). První přihlášení přes
//     /activate (e-mail → nick + heslo), pak /login nickem nebo e-mailem. Cookie bs2_user (30 dní).
// Env: PORT, DATABASE_URL, BS2_SSO_SECRET, BS2_SESSION_SECRET, HOLYOS_URL, BS2_PUBLIC_URL,
//      BS2_ALLOWED_PIDS (volitelně — čárkami person id správců z HolyOS)

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { q, migrate } = require('./db');
const V = require('./views');
const { importSupporters } = require('./import');

const PORT = process.env.PORT || 3100;
const SSO_SECRET = process.env.BS2_SSO_SECRET;
const SESSION_SECRET = process.env.BS2_SESSION_SECRET || SSO_SECRET;
const HOLYOS_URL = (process.env.HOLYOS_URL || 'https://app.holyos.cz').replace(/\/$/, '');
const ALLOWED_PIDS = String(process.env.BS2_ALLOWED_PIDS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
const ADMIN_COOKIE = 'bs2_admin', USER_COOKIE = 'bs2_user';

if (!SSO_SECRET) console.warn('[bs2] POZOR: BS2_SSO_SECRET není nastaven — SSO správců nebude fungovat.');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => { res.set('X-Frame-Options', 'DENY'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Sessions ───────────────────────────────────────────────────────────────
const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
function setCookie(req, res, name, payload, maxAgeSec) {
  const t = jwt.sign(payload, SESSION_SECRET, { expiresIn: maxAgeSec });
  res.cookie(name, t, { httpOnly: true, secure: isHttps(req), sameSite: 'lax', maxAge: maxAgeSec * 1000 });
}
function readCookie(req, name) { const t = req.cookies && req.cookies[name]; if (!t || !SESSION_SECRET) return null; try { return jwt.verify(t, SESSION_SECRET); } catch (e) { return null; } }
function requireAdmin(req, res, next) {
  const s = readCookie(req, ADMIN_COOKIE);
  if (!s || s.kind !== 'admin') return res.redirect(HOLYOS_URL + '/api/auth/sso/bs2');
  req.admin = s; next();
}
async function requireUser(req, res, next) {
  const s = readCookie(req, USER_COOKIE);
  if (!s || s.kind !== 'user') return res.redirect('/login');
  const r = await q('SELECT * FROM supporters WHERE id=$1', [s.sid]);
  const u = r.rows[0];
  if (!u || u.status !== 'active') { res.clearCookie(USER_COOKIE); return res.redirect('/login'); }
  req.user = u; next();
}
// Jednoduchý rate-limit přihlašování per IP (v paměti)
const attempts = new Map();
function tooMany(ip) { const a = attempts.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); } return a.n >= 20; }
function noteFail(ip) { const a = attempts.get(ip) || { n: 0, t: Date.now() }; a.n++; attempts.set(ip, a); }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
async function log(admin, action, detail) { try { await q('INSERT INTO admin_log (admin_pid, admin_name, action, detail) VALUES ($1,$2,$3,$4)', [admin.pid || null, admin.name || null, action, detail ? JSON.stringify(detail) : null]); } catch (e) { /* log není kritický */ } }

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/api/health', wrap(async (req, res) => { let db = false; try { await q('SELECT 1'); db = true; } catch (e) { /* */ } res.json({ ok: true, app: 'bs2', db, time: new Date().toISOString() }); }));

// ── SSO správce (z HolyOS) ─────────────────────────────────────────────────
app.get('/sso', (req, res) => {
  if (!SSO_SECRET) return res.status(500).send(V.errorPage('SSO není nakonfigurováno', 'Chybí BS2_SSO_SECRET.', HOLYOS_URL));
  try {
    const p = jwt.verify(String(req.query.t || ''), SSO_SECRET, { audience: 'bs2', issuer: 'holyos' });
    if (ALLOWED_PIDS.length && !ALLOWED_PIDS.includes(Number(p.pid))) return res.status(403).send(V.errorPage('Přístup odepřen', 'Do správy této sekce nemáš přístup.', HOLYOS_URL));
    setCookie(req, res, ADMIN_COOKIE, { kind: 'admin', uid: p.uid, pid: p.pid, name: p.name, username: p.username }, 12 * 3600);
    res.redirect('/admin');
  } catch (e) {
    res.status(401).send(V.errorPage('Přihlášení vypršelo', 'Odkaz z HolyOS je neplatný nebo vypršel (platí 2 minuty). Zkus to z HolyOS znovu.', HOLYOS_URL + '/api/auth/sso/bs2'));
  }
});

// ── Podporovatel: přihlášení / aktivace ─────────────────────────────────────
app.get('/login', (req, res) => {
  if (readCookie(req, USER_COOKIE)) return res.redirect('/');
  res.send(V.loginPage({ info: req.query.activated ? 'Účet je aktivní, můžeš se přihlásit.' : req.query.out ? 'Byl jsi odhlášen.' : '' }));
});
app.post('/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).send(V.loginPage({ error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const login = String(req.body.login || '').trim(), password = String(req.body.password || '');
  const r = await q('SELECT * FROM supporters WHERE lower(email)=lower($1) OR lower(nick)=lower($1) LIMIT 1', [login]);
  const u = r.rows[0];
  if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
    noteFail(ip);
    const hint = u && !u.password_hash ? 'Účet ještě není aktivovaný — použij „Aktivovat účet e-mailem".' : 'Nesprávný nick/e-mail nebo heslo.';
    return res.status(401).send(V.loginPage({ error: hint, login }));
  }
  if (u.status === 'blocked') return res.status(403).send(V.loginPage({ error: 'Účet je zablokovaný. Ozvi se nám.', login }));
  await q('UPDATE supporters SET last_login_at=now() WHERE id=$1', [u.id]);
  setCookie(req, res, USER_COOKIE, { kind: 'user', sid: u.id, nick: u.nick }, 30 * 24 * 3600);
  res.redirect('/');
}));
app.get('/activate', (req, res) => res.send(V.activatePage({ step: 'email' })));
app.post('/activate', wrap(async (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).send(V.activatePage({ error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const email = String(req.body.email || '').trim().toLowerCase();
  const r = await q('SELECT * FROM supporters WHERE email=$1', [email]);
  const u = r.rows[0];
  if (!u) { noteFail(ip); return res.status(404).send(V.activatePage({ step: 'email', email, error: 'Tento e-mail v seznamu podporovatelů nemáme. Zkontroluj překlep, nebo nám napiš.' })); }
  if (u.status === 'blocked') return res.status(403).send(V.activatePage({ step: 'email', email, error: 'Tento účet je zablokovaný.' }));
  if (u.password_hash) return res.send(V.loginPage({ login: email, info: 'Tenhle účet už je aktivovaný — přihlas se heslem.' }));
  res.send(V.activatePage({ step: 'credentials', email, name: u.first_name }));
}));
app.post('/activate/finish', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const nick = String(req.body.nick || '').trim(), password = String(req.body.password || ''), password2 = String(req.body.password2 || '');
  const r = await q('SELECT * FROM supporters WHERE email=$1', [email]);
  const u = r.rows[0];
  if (!u || u.status === 'blocked') return res.status(404).send(V.activatePage({ step: 'email', email, error: 'E-mail nenalezen.' }));
  if (u.password_hash) return res.send(V.loginPage({ login: email, info: 'Účet už je aktivovaný — přihlas se heslem.' }));
  const back = (error) => res.status(400).send(V.activatePage({ step: 'credentials', email, name: u.first_name, error }));
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(nick)) return back('Nick: 3–30 znaků, jen písmena, čísla, tečka, podtržítko, pomlčka.');
  if (nick.includes('@')) return back('Nick nesmí být e-mail.');
  if (password.length < 8) return back('Heslo musí mít aspoň 8 znaků.');
  if (password !== password2) return back('Hesla se neshodují.');
  const taken = await q('SELECT 1 FROM supporters WHERE lower(nick)=lower($1) AND id<>$2', [nick, u.id]);
  if (taken.rows.length) return back('Tenhle nick už někdo má, zvol jiný.');
  const hash = await bcrypt.hash(password, 11);
  await q("UPDATE supporters SET nick=$1, password_hash=$2, status='active', activated_at=now(), last_login_at=now(), updated_at=now() WHERE id=$3", [nick, hash, u.id]);
  setCookie(req, res, USER_COOKIE, { kind: 'user', sid: u.id, nick }, 30 * 24 * 3600);
  res.redirect('/');
}));
app.get('/logout', (req, res) => { res.clearCookie(USER_COOKIE); res.clearCookie(ADMIN_COOKIE); res.redirect('/login?out=1'); });

// ── Podporovatel: domů + heslo ──────────────────────────────────────────────
app.get('/', (req, res, next) => {
  if (readCookie(req, ADMIN_COOKIE)) return res.redirect('/admin');
  return requireUser(req, res, () => res.send(V.supporterHome(req.user)));
});
app.get('/password', wrap(requireUser), (req, res) => res.send(V.passwordPage({ nick: req.user.nick })));
app.post('/password', wrap(requireUser), wrap(async (req, res) => {
  const { old = '', password = '', password2 = '' } = req.body;
  const back = (error, ok) => res.send(V.passwordPage({ nick: req.user.nick, error, ok }));
  if (!(await bcrypt.compare(String(old), req.user.password_hash))) return back('Současné heslo nesouhlasí.');
  if (String(password).length < 8) return back('Nové heslo musí mít aspoň 8 znaků.');
  if (password !== password2) return back('Nová hesla se neshodují.');
  await q('UPDATE supporters SET password_hash=$1, updated_at=now() WHERE id=$2', [await bcrypt.hash(String(password), 11), req.user.id]);
  back('', 'Heslo změněno.');
}));

// ── Správa (SSO) ───────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, wrap(async (req, res) => {
  const st = (await q("SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='invited')::int AS invited, count(*) FILTER (WHERE status='blocked')::int AS blocked FROM supporters")).rows[0];
  const recent = (await q('SELECT nick, email, last_login_at FROM supporters WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 8')).rows;
  res.send(V.adminDash({ admin: req.admin, stats: st, recent, holyosUrl: HOLYOS_URL }));
}));
app.get('/admin/supporters', requireAdmin, wrap(async (req, res) => {
  const qs = String(req.query.q || '').trim(), status = String(req.query.status || '');
  const where = [], params = [];
  if (qs) { params.push('%' + qs.toLowerCase() + '%'); where.push(`(lower(email) LIKE $${params.length} OR lower(coalesce(first_name,'')) LIKE $${params.length} OR lower(coalesce(last_name,'')) LIKE $${params.length} OR lower(coalesce(nick,'')) LIKE $${params.length})`); }
  if (['invited', 'active', 'blocked'].includes(status)) { params.push(status); where.push(`status=$${params.length}`); }
  const sql = `FROM supporters ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = (await q('SELECT count(*)::int AS c ' + sql, params)).rows[0].c;
  const rows = (await q('SELECT id,email,first_name,last_name,nick,status,last_login_at ' + sql + ' ORDER BY lower(coalesce(last_name,\'\')), lower(coalesce(first_name,\'\')), email LIMIT 500', params)).rows;
  res.send(V.adminSupporters({ admin: req.admin, rows, qstr: qs, status, total, msg: req.query.msg || '', holyosUrl: HOLYOS_URL }));
}));
app.get('/admin/supporters/new', requireAdmin, (req, res) => res.send(V.adminSupporterDetail({ admin: req.admin, s: null, isNew: true, holyosUrl: HOLYOS_URL })));
app.post('/admin/supporters/new', requireAdmin, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).send(V.adminSupporterDetail({ admin: req.admin, s: { email, first_name: req.body.first_name, last_name: req.body.last_name }, isNew: true, error: 'Neplatný e-mail.', holyosUrl: HOLYOS_URL }));
  try {
    const r = await q('INSERT INTO supporters (email, first_name, last_name, source) VALUES ($1,$2,$3,$4) RETURNING id', [email, String(req.body.first_name || '').trim() || null, String(req.body.last_name || '').trim() || null, 'ručně']);
    await log(req.admin, 'create', { id: r.rows[0].id, email });
    res.redirect('/admin/supporters/' + r.rows[0].id + '?msg=' + encodeURIComponent('Podporovatel založen.'));
  } catch (e) {
    const error = e.code === '23505' ? 'Podporovatel s tímto e-mailem už existuje.' : e.message;
    res.status(400).send(V.adminSupporterDetail({ admin: req.admin, s: { email, first_name: req.body.first_name, last_name: req.body.last_name }, isNew: true, error, holyosUrl: HOLYOS_URL }));
  }
}));
async function loadSupporter(id) { const r = await q('SELECT * FROM supporters WHERE id=$1', [parseInt(id, 10) || 0]); return r.rows[0] || null; }
app.get('/admin/supporters/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id); if (!s) return res.status(404).send(V.errorPage('Nenalezeno', 'Podporovatel neexistuje.', '/admin/supporters'));
  res.send(V.adminSupporterDetail({ admin: req.admin, s, msg: req.query.msg || '', holyosUrl: HOLYOS_URL }));
}));
app.post('/admin/supporters/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id); if (!s) return res.status(404).send(V.errorPage('Nenalezeno', 'Podporovatel neexistuje.', '/admin/supporters'));
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    await q('UPDATE supporters SET email=$1, first_name=$2, last_name=$3, updated_at=now() WHERE id=$4', [email, String(req.body.first_name || '').trim() || null, String(req.body.last_name || '').trim() || null, s.id]);
    await log(req.admin, 'update', { id: s.id, email });
    res.redirect('/admin/supporters/' + s.id + '?msg=' + encodeURIComponent('Uloženo.'));
  } catch (e) { res.status(400).send(V.adminSupporterDetail({ admin: req.admin, s, error: e.code === '23505' ? 'Tento e-mail už má jiný podporovatel.' : e.message, holyosUrl: HOLYOS_URL })); }
}));
app.post('/admin/supporters/:id(\\d+)/reset', requireAdmin, wrap(async (req, res) => {
  await q("UPDATE supporters SET nick=NULL, password_hash=NULL, status=CASE WHEN status='blocked' THEN 'blocked' ELSE 'invited' END, activated_at=NULL, updated_at=now() WHERE id=$1", [req.params.id]);
  await log(req.admin, 'reset', { id: Number(req.params.id) });
  res.redirect('/admin/supporters/' + req.params.id + '?msg=' + encodeURIComponent('Přihlášení resetováno — podporovatel si účet znovu aktivuje e-mailem.'));
}));
app.post('/admin/supporters/:id(\\d+)/block', requireAdmin, wrap(async (req, res) => {
  await q("UPDATE supporters SET status='blocked', updated_at=now() WHERE id=$1", [req.params.id]); await log(req.admin, 'block', { id: Number(req.params.id) });
  res.redirect('/admin/supporters/' + req.params.id + '?msg=' + encodeURIComponent('Účet zablokován.'));
}));
app.post('/admin/supporters/:id(\\d+)/unblock', requireAdmin, wrap(async (req, res) => {
  await q("UPDATE supporters SET status=CASE WHEN password_hash IS NULL THEN 'invited' ELSE 'active' END, updated_at=now() WHERE id=$1", [req.params.id]); await log(req.admin, 'unblock', { id: Number(req.params.id) });
  res.redirect('/admin/supporters/' + req.params.id + '?msg=' + encodeURIComponent('Účet odblokován.'));
}));
app.post('/admin/supporters/:id(\\d+)/delete', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id);
  await q('DELETE FROM supporters WHERE id=$1', [req.params.id]); await log(req.admin, 'delete', { id: Number(req.params.id), email: s && s.email });
  res.redirect('/admin/supporters?msg=' + encodeURIComponent('Podporovatel smazán.'));
}));
app.get('/admin/import', requireAdmin, (req, res) => res.send(V.adminImport({ admin: req.admin, holyosUrl: HOLYOS_URL })));
app.post('/admin/import', requireAdmin, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).send(V.adminImport({ admin: req.admin, error: 'Vyber soubor.', holyosUrl: HOLYOS_URL }));
  try {
    const result = await importSupporters(req.file.buffer, req.file.originalname, { dry: req.body.dry === '1' });
    if (req.body.dry === '1') result.file += ' (jen zkouška, nic neuloženo)';
    else await log(req.admin, 'import', { file: req.file.originalname, rows: result.rows, created: result.created, updated: result.updated });
    res.send(V.adminImport({ admin: req.admin, result, holyosUrl: HOLYOS_URL }));
  } catch (e) { res.status(400).send(V.adminImport({ admin: req.admin, error: 'Soubor se nepodařilo zpracovat: ' + e.message, holyosUrl: HOLYOS_URL })); }
}));

// ── Chyby ──────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).send(V.errorPage('Stránka nenalezena', 'Tahle adresa neexistuje.', '/')));
app.use((err, req, res, next) => { console.error('[bs2]', err); res.status(500).send(V.errorPage('Chyba serveru', process.env.NODE_ENV === 'production' ? 'Něco se pokazilo, zkus to znovu.' : err.message, '/')); });

migrate().then(() => app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT}`)))
  .catch((e) => { console.error('[bs2] DB migrace selhala:', e.message); app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT} (BEZ DB — nastav DATABASE_URL)`)); });
