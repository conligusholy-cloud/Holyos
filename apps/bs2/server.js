// BS2 — soukromá sekce Best Series (www.bestseries2.cz). Samostatná aplikace oddělená od HolyOS:
// vlastní server, DB (DATABASE_URL) i doména. S HolyOS ji pojí jen SSO pro správce (Tomáš, Jan).
//
// Dva druhy přihlášení:
//   • SPRÁVCE — z HolyOS: GET /api/auth/sso/bs2 → /sso?t=<JWT, BS2_SSO_SECRET, 2 min> → cookie bs2_admin (12 h)
//   • UŽIVATEL — e-mail musí být v tabulce supporters (import CSV/XLSX). První přihlášení přes
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
const { importSupporters, prepareImport, writeImport } = require('./import');

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
  // Nepřihlášený nikdy nesmí být poslán do HolyOS — admin se dostane jen z menu HolyOS; návštěvník uvidí jen BS2 login
  if (!s || s.kind !== 'admin') return res.redirect('/login');
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
app.get('/api/health', wrap(async (req, res) => {
  let db = false, db_error;
  try { await q('SELECT 1'); db = true; } catch (e) { db_error = e.message; }
  res.json({ ok: true, app: 'bs2', db, db_error, db_configured: !!process.env.DATABASE_URL, time: new Date().toISOString() });
}));

// ── SSO správce (z HolyOS) ─────────────────────────────────────────────────
app.get('/sso', (req, res) => {
  if (!SSO_SECRET) return res.status(500).send(V.errorPage('Služba není nakonfigurována', 'Zkus to prosím později.', '/login'));
  try {
    const p = jwt.verify(String(req.query.t || ''), SSO_SECRET, { audience: 'bs2', issuer: 'holyos' });
    if (ALLOWED_PIDS.length && !ALLOWED_PIDS.includes(Number(p.pid))) return res.status(403).send(V.errorPage('Přístup odepřen', 'Do této sekce nemáš přístup.', '/login'));
    setCookie(req, res, ADMIN_COOKIE, { kind: 'admin', uid: p.uid, pid: p.pid, name: p.name, username: p.username }, 12 * 3600);
    res.redirect('/admin');
  } catch (e) {
    res.status(401).send(V.errorPage('Odkaz vypršel', 'Přihlašovací odkaz je neplatný nebo vypršel. Otevři sekci znovu z místa, odkud jsi přišel.', '/login'));
  }
});

// ── Uživatel: přihlášení / aktivace ─────────────────────────────────────
// Počet aktivních členů na přihlašovací stránce (cache 10 min, při chybě DB se číslo nezobrazí)
let _members = { n: null, at: 0 };
async function memberCount() {
  if (Date.now() - _members.at < 600000) return _members.n;
  try { const r = await q("SELECT count(*)::int AS n FROM supporters WHERE status='active'"); _members = { n: r.rows[0].n, at: Date.now() }; } catch (e) { _members = { n: null, at: Date.now() }; }
  return _members.n;
}
// Favicon / logo (SVG, cache 1 den)
app.get('/favicon.svg', (req, res) => { res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(require('./logo').logoSvg(64, 'f')); });
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.get('/login', wrap(async (req, res) => {
  if (readCookie(req, USER_COOKIE)) return res.redirect('/');
  res.send(V.loginPage({ members: await memberCount(), info: req.query.activated ? 'Účet je aktivní, můžeš se přihlásit.' : req.query.out ? 'Byl jsi odhlášen.' : '' }));
}));
// Zapomenuté heslo — zatím bez automatického e-mailu: žádost se zapíše do admin_log, Tomáš/Jan ji vyřídí ručně (reset v adminu)
app.get('/forgot', (req, res) => res.send(V.forgotPage()));
app.post('/forgot', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).send(V.forgotPage({ email, error: 'Zadej platný e-mail.' }));
  const r = await q('SELECT id, nick FROM supporters WHERE lower(email)=$1 LIMIT 1', [email]);
  await log({ name: 'web' }, 'forgot_password', { email, known: !!r.rows[0], supporter_id: r.rows[0] ? r.rows[0].id : null, ip: req.ip });
  res.send(V.forgotPage({ email, done: true }));
}));
app.post('/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).send(V.loginPage({ error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const login = String(req.body.login || '').trim(), password = String(req.body.password || '');
  const r = await q('SELECT * FROM supporters WHERE lower(email)=lower($1) OR lower(nick)=lower($1) LIMIT 1', [login]);
  const u = r.rows[0];
  if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
    noteFail(ip);
    const hint = u && !u.password_hash ? 'Účet ještě není aktivovaný. Otevři bestseries2.cz/activate a nastav si heslo.' : 'Nesprávný nick/e-mail nebo heslo.';
    return res.status(401).send(V.loginPage({ error: hint, login, members: await memberCount() }));
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
  if (!u) { noteFail(ip); return res.status(404).send(V.activatePage({ step: 'email', email, error: 'Tento e-mail v seznamu uživatelů nemáme. Zkontroluj překlep, nebo nám napiš.' })); }
  if (u.status === 'blocked') return res.status(403).send(V.activatePage({ step: 'email', email, error: 'Tento účet je zablokovaný.' }));
  if (u.password_hash) return res.send(V.loginPage({ login: email, info: 'Tenhle účet už je aktivovaný — přihlas se heslem.' }));
  res.send(V.activatePage({ step: 'credentials', email, name: u.first_name, nick: (u.extra && u.extra.puvodni_nick) || '' }));
}));
app.post('/activate/finish', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const nick = String(req.body.nick || '').trim(), password = String(req.body.password || ''), password2 = String(req.body.password2 || '');
  const r = await q('SELECT * FROM supporters WHERE email=$1', [email]);
  const u = r.rows[0];
  if (!u || u.status === 'blocked') return res.status(404).send(V.activatePage({ step: 'email', email, error: 'E-mail nenalezen.' }));
  if (u.password_hash) return res.send(V.loginPage({ login: email, info: 'Účet už je aktivovaný — přihlas se heslem.' }));
  const back = (error) => res.status(400).send(V.activatePage({ step: 'credentials', email, name: u.first_name, nick, error }));
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

// ── Referenční program (prodejci) ───────────────────────────────────────
const PUBLIC_URL = (process.env.BS2_PUBLIC_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
function makeRefCode() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = require('crypto').randomBytes(8); return Array.from(b, x => a[x % a.length]).join(''); }
async function ensureRefCode(u) {
  if (u.ref_code) return u.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = makeRefCode();
    try { await q('UPDATE supporters SET ref_code=$1, updated_at=now() WHERE id=$2 AND ref_code IS NULL', [code, u.id]); const r = await q('SELECT ref_code FROM supporters WHERE id=$1', [u.id]); if (r.rows[0] && r.rows[0].ref_code) return r.rows[0].ref_code; } catch (e) { if (e.code !== '23505') throw e; }
  }
  throw new Error('Nepodařilo se vytvořit referenční kód.');
}
// První linie prodejce = lidé registrovaní přes jeho odkaz (referred_by) + historická vazba ze starého systému (extra.tab3 = nick)
async function loadFirstLine(u) {
  const r = await q(`SELECT id,email,first_name,last_name,nick,phone,status,user_type,created_at,activated_at,last_login_at,referred_by
    FROM supporters WHERE id<>$1 AND (referred_by=$1 ${u.nick ? "OR lower(trim(extra->>'tab3')) = lower($2)" : ''})
    ORDER BY created_at DESC LIMIT 500`, u.nick ? [u.id, u.nick] : [u.id]);
  return r.rows;
}
// Partnerská síť: nákupy prádlomatů lidí z první linie prodejce
async function loadNetwork(u) {
  const r = await q(`SELECT p.id AS purchase_id, p.product_name, p.price_czk, p.purchased_at, s.id, s.email, s.first_name, s.last_name, s.nick, s.phone
    FROM purchases p JOIN supporters s ON s.id=p.supporter_id
    WHERE s.id<>$1 AND (s.referred_by=$1 ${u.nick ? "OR lower(trim(s.extra->>'tab3')) = lower($2)" : ''})
    ORDER BY p.purchased_at DESC, p.id DESC LIMIT 1000`, u.nick ? [u.id, u.nick] : [u.id]);
  return r.rows;
}
async function loadSeller(code) {
  if (!/^[a-z0-9]{6,20}$/.test(String(code || ''))) return null;
  const r = await q("SELECT id, nick, first_name, last_name, status, user_type FROM supporters WHERE ref_code=$1", [code]);
  const s = r.rows[0];
  return s && s.status !== 'blocked' && s.user_type === 'seller' ? s : null;
}
app.get('/join/:code', wrap(async (req, res) => {
  const seller = await loadSeller(req.params.code);
  if (!seller) return res.status(404).send(V.errorPage('Odkaz neplatí', 'Tenhle registrační odkaz není platný. Požádej toho, kdo ti ho poslal, o nový.', '/login'));
  if (readCookie(req, USER_COOKIE)) return res.redirect('/');
  res.send(V.joinPage({ code: req.params.code, seller }));
}));
app.post('/join/:code', wrap(async (req, res) => {
  const seller = await loadSeller(req.params.code);
  if (!seller) return res.status(404).send(V.errorPage('Odkaz neplatí', 'Tenhle registrační odkaz není platný.', '/login'));
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).send(V.joinPage({ code: req.params.code, seller, error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const f = { first_name: String(req.body.first_name || '').trim(), last_name: String(req.body.last_name || '').trim(), email: String(req.body.email || '').trim().toLowerCase(), phone: String(req.body.phone || '').trim(), nick: String(req.body.nick || '').trim() };
  const password = String(req.body.password || ''), password2 = String(req.body.password2 || '');
  const back = (error) => res.status(400).send(V.joinPage({ code: req.params.code, seller, f, error }));
  if (!f.first_name || !f.last_name) return back('Vyplň jméno a příjmení.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return back('Zadej platný e-mail.');
  if (f.phone && !/^[+0-9 ()./-]{6,25}$/.test(f.phone)) return back('Telefon má neplatný formát.');
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(f.nick)) return back('Nick: 3–30 znaků, jen písmena, čísla, tečka, podtržítko, pomlčka.');
  if (password.length < 8) return back('Heslo musí mít aspoň 8 znaků.');
  if (password !== password2) return back('Hesla se neshodují.');
  if ((await q('SELECT 1 FROM supporters WHERE email=$1', [f.email])).rows.length) return back('Tento e-mail už u nás účet má — přihlas se, nebo použij Zapomenuté heslo.');
  if ((await q('SELECT 1 FROM supporters WHERE lower(nick)=lower($1)', [f.nick])).rows.length) return back('Tenhle nick už někdo má, zvol jiný.');
  const hash = await bcrypt.hash(password, 11);
  const r = await q(`INSERT INTO supporters (email, first_name, last_name, phone, nick, password_hash, status, user_type, referred_by, source, activated_at, last_login_at)
    VALUES ($1,$2,$3,$4,$5,$6,'active','standard',$7,'referral',now(),now()) RETURNING id`, [f.email, f.first_name, f.last_name, f.phone || null, f.nick, hash, seller.id]);
  await log({ name: 'web' }, 'join_via_referral', { id: r.rows[0].id, email: f.email, seller_id: seller.id, seller_nick: seller.nick, ip });
  setCookie(req, res, USER_COOKIE, { kind: 'user', sid: r.rows[0].id, nick: f.nick }, 30 * 24 * 3600);
  res.redirect('/?welcome=1');
}));

// ── Uživatel: domů + heslo ──────────────────────────────────────────────
app.get('/', (req, res, next) => {
  if (readCookie(req, ADMIN_COOKIE)) return res.redirect('/admin');
  return requireUser(req, res, async () => {
    res.send(V.supporterHome(req.user));
  });
});
async function eurRate() { const r = await q("SELECT value FROM app_settings WHERE key='eur_czk_rate'"); const n = Number(r.rows[0] && r.rows[0].value); return n > 0 ? n : 25; }
app.post('/currency', wrap(requireUser), wrap(async (req, res) => {
  const cur = req.body.cur === 'EUR' ? 'EUR' : 'CZK';
  await q('UPDATE supporters SET currency=$1, updated_at=now() WHERE id=$2', [cur, req.user.id]);
  const back = ['/pradlomaty', '/discount-credit'].includes(req.body.back) ? req.body.back : '/pradlomaty';
  res.redirect(back);
}));
app.post('/admin/settings/eur-rate', requireAdmin, wrap(async (req, res) => {
  const n = Number(String(req.body.rate || '').replace(/\s/g, '').replace(',', '.'));
  if (n > 0 && n < 1000) await q("INSERT INTO app_settings (key,value) VALUES ('eur_czk_rate',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [String(n)]);
  res.redirect('/admin/products?msg=' + encodeURIComponent('Kurz uložen.'));
}));
app.get('/compounder', wrap(requireUser), (req, res) => res.send(V.supporterCompounder(req.user)));
app.get('/pradlomaty', wrap(requireUser), wrap(async (req, res) => {
  let offers = [];
  try { const out = await loadProducts(); const set = await offeredSet(); offers = (out.items || []).filter(p => set.has(p.id)); } catch (e) { /* bez nabídky */ }
  try { const mins = new Map((await q('SELECT holyos_item_id, min_price_czk, min_price_eur, dc_use_pct FROM product_offers')).rows.map(r => [r.holyos_item_id, r])); offers = offers.map(p => { const m = mins.get(p.id) || {}; return { ...p, min_price_czk: m.min_price_czk, min_price_eur: m.min_price_eur, dc_use_pct: m.dc_use_pct }; }); } catch (e) { /* bez minima */ }
  const sum = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).b || 0);
  const balance = req.user.currency === 'EUR' ? sum / (await eurRate()) : sum;
  res.send(V.supporterProducts(req.user, offers, { balance, msg: req.query.msg || '' }));
}));
// Koupit (+ případně uplatnit DC): vše se přepočítá na serveru, DC se hned odečtou, objednávku potvrdí admin
app.post('/order', wrap(requireUser), wrap(async (req, res) => {
  const back = (m) => res.redirect('/pradlomaty?msg=' + encodeURIComponent(m));
  const cur = req.user.currency === 'EUR' ? 'EUR' : 'CZK';
  const items = (await loadProducts()).items || [];
  const set = await offeredSet();
  const p = items.find(x => String(x.id) === String(req.body.item) && set.has(x.id));
  if (!p) return back('Tento prádlomat teď nelze objednat.');
  const net = Number(cur === 'EUR' ? p.price_eur : p.price_czk);
  if (!isFinite(net) || net <= 0) return back('Prádlomat nemá cenu v zvolené měně.');
  const o = (await q('SELECT credit_pct, min_price_czk, min_price_eur, dc_use_pct FROM product_offers WHERE holyos_item_id=$1', [p.id])).rows[0] || {};
  const min = Number(cur === 'EUR' ? o.min_price_eur : o.min_price_czk) || 0;
  let room = Math.max(0, Math.round(net - min)); if (o.dc_use_pct != null) room = Math.min(room, Math.floor(net * Number(o.dc_use_pct) / 100));
  const rate = cur === 'EUR' ? await eurRate() : 1;
  const bal = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).b || 0) / rate;
  let dc = Math.max(0, parseInt(req.body.dc, 10) || 0);
  dc = Math.min(dc, room, Math.floor(bal));
  const ins = await q('INSERT INTO orders (supporter_id, holyos_item_id, product_name, currency, price_net, dc_used, final_net) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, p.id, p.name_cs, cur, net, dc, net - dc]);
  if (dc > 0) await q('INSERT INTO credits (supporter_id, amount_czk, note, order_id) VALUES ($1,$2,$3,$4)', [req.user.id, -Math.round(dc * rate * 100) / 100, 'Uplatnění DC: ' + p.name_cs + ' (objednávka #' + ins.rows[0].id + ')', ins.rows[0].id]);
  await log({ name: req.user.nick }, 'order_new', { id: ins.rows[0].id, product: p.name_cs, dc });
  res.redirect('/moje-pradlomaty?ordered=1');
}));
app.get('/moje-pradlomaty', wrap(requireUser), wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM purchases WHERE supporter_id=$1 ORDER BY purchased_at DESC, id DESC', [req.user.id])).rows;
  let byId = new Map(); try { byId = new Map(((await loadProducts()).items || []).map(p => [p.id, p])); } catch (e) { /* bez parametrů stroje */ }
  rows.forEach(r => { r.machine = byId.get(r.holyos_item_id) || null; });
  const orders = (await q('SELECT * FROM orders WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100', [req.user.id])).rows;
  res.send(V.supporterMine(req.user, { rows, orders, msg: req.query.ordered ? 'Objednávka odeslána. Ozveme se s potvrzením.' : '' }));
}));
app.get('/discount-credit', wrap(requireUser), wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM credits WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC LIMIT 500', [req.user.id])).rows;
  let sellable = [];
  try {
    const items = (await loadProducts()).items || [];
    const off = new Map((await q('SELECT holyos_item_id, offered, credit_pct FROM product_offers')).rows.map(r => [r.holyos_item_id, r]));
    sellable = items.filter(p => off.get(p.id) && off.get(p.id).offered).map(p => ({ ...p, credit_pct: Number(off.get(p.id).credit_pct) }));
  } catch (e) { /* bez tabulky */ }
  res.send(V.supporterCredit(req.user, { rows, sellable, rate: await eurRate() }));
}));
app.get('/sit', wrap(requireUser), wrap(async (req, res) => {
  if (req.user.user_type !== 'seller') return res.redirect('/');
  const [rows, line] = await Promise.all([loadNetwork(req.user), loadFirstLine(req.user)]);
  res.send(V.supporterNetwork(req.user, { rows, lineCount: line.length }));
}));
app.get('/team', wrap(requireUser), wrap(async (req, res) => {
  if (req.user.user_type !== 'seller') return res.redirect('/');
  const code = await ensureRefCode(req.user);
  res.send(V.supporterTeam(req.user, { team: await loadFirstLine(req.user), refUrl: PUBLIC_URL + '/join/' + code }));
}));
app.get('/password', wrap(requireUser), (req, res) => res.send(V.passwordPage({ s: req.user })));
app.post('/password', wrap(requireUser), wrap(async (req, res) => {
  const { old = '', password = '', password2 = '' } = req.body;
  const back = (error, ok) => res.send(V.passwordPage({ s: req.user, error, ok }));
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
// Volba sloupců seznamu (cookie, 1 rok). Klíče údajů z importu se načítají z DB (cache 5 min).
const COLS_COOKIE = 'bs2_cols';
function readCols(req) { try { const a = JSON.parse(req.cookies[COLS_COOKIE] || 'null'); return Array.isArray(a) && a.length ? a.filter(x => typeof x === 'string').slice(0, 60) : V.DEFAULT_COLS; } catch (e) { return V.DEFAULT_COLS; } }
let extraKeysCache = { at: 0, keys: [] };
async function extraKeys() {
  if (Date.now() - extraKeysCache.at < 5 * 60e3) return extraKeysCache.keys;
  const r = await q('SELECT DISTINCT k FROM supporters, LATERAL jsonb_object_keys(extra) AS k ORDER BY k');
  extraKeysCache = { at: Date.now(), keys: r.rows.map(x => x.k) };
  return extraKeysCache.keys;
}
app.post('/admin/supporters/columns', requireAdmin, (req, res) => {
  const back = String(req.body.back || '/admin/supporters').startsWith('/admin/supporters') ? String(req.body.back) : '/admin/supporters';
  if (req.body.reset) { res.clearCookie(COLS_COOKIE); return res.redirect(back); }
  let cols = req.body.cols || []; if (!Array.isArray(cols)) cols = [cols];
  cols = cols.map(String).filter(c => /^(x:.{1,80}|[a-z_]{1,40})$/.test(c)).slice(0, 60);
  res.cookie(COLS_COOKIE, JSON.stringify(cols), { httpOnly: true, secure: isHttps(req), sameSite: 'lax', maxAge: 365 * 24 * 3600 * 1000 });
  res.redirect(back);
});
const USER_TYPES = ['standard', 'owner', 'seller'];
app.get('/admin/supporters', requireAdmin, wrap(async (req, res) => {
  const qs = String(req.query.q || '').trim(), status = String(req.query.status || ''), utype = String(req.query.type || '');
  const where = [], params = [];
  if (qs) { params.push('%' + qs.toLowerCase() + '%'); where.push(`(lower(email) LIKE $${params.length} OR lower(coalesce(first_name,'')) LIKE $${params.length} OR lower(coalesce(last_name,'')) LIKE $${params.length} OR lower(coalesce(nick,'')) LIKE $${params.length})`); }
  if (['invited', 'active', 'blocked'].includes(status)) { params.push(status); where.push(`status=$${params.length}`); }
  if (USER_TYPES.includes(utype)) { params.push(utype); where.push(`user_type=$${params.length}`); }
  const sql = `FROM supporters ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const cols = readCols(req);
  const keys = await extraKeys();
  const needExtra = cols.some(c => c.startsWith('x:'));
  const total = (await q('SELECT count(*)::int AS c ' + sql, params)).rows[0].c;
  const rows = (await q(`SELECT id,email,first_name,last_name,nick,status,user_type,last_login_at,activated_at,created_at,source${needExtra ? ',extra' : ''} ` + sql + " ORDER BY lower(coalesce(last_name,'')), lower(coalesce(first_name,'')), email LIMIT 500", params)).rows;
  res.send(V.adminSupporters({ admin: req.admin, rows, qstr: qs, status, utype, total, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, cols, extraKeys: keys }));
}));
// Produkty = aktivní stroje z prodejního ceníku HolyOS (jen čtení; cache 5 min)
let productsCache = { at: 0, items: null };
async function loadProducts() {
  if (productsCache.items && Date.now() - productsCache.at < 5 * 60e3) return { items: productsCache.items };
  const secret = process.env.BS2_SSO_SECRET;
  if (!secret) return { error: 'Chybí BS2_SSO_SECRET.' };
  const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + '/api/auth/bs2/products', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { error: 'HolyOS vrátil chybu ' + r.status + '.' };
  productsCache = { at: Date.now(), items: await r.json() };
  return { items: productsCache.items };
}
async function offeredSet() { const r = await q('SELECT holyos_item_id FROM product_offers WHERE offered'); return new Set(r.rows.map(x => x.holyos_item_id)); }
app.get('/admin/products', requireAdmin, wrap(async (req, res) => {
  if (req.query.refresh) productsCache = { at: 0, items: null };
  let out; try { out = await loadProducts(); } catch (e) { out = { error: 'Nepodařilo se načíst ceník z HolyOS: ' + e.message }; }
  const offered = await offeredSet();
  const po = new Map((await q('SELECT holyos_item_id, credit_pct, min_price_czk, min_price_eur, dc_use_pct FROM product_offers')).rows.map(r => [r.holyos_item_id, r]));
  const rows = (out.items || []).map(p => { const o = po.get(p.id) || {}; return { ...p, offered: offered.has(p.id), credit_pct: Number(o.credit_pct || 0), min_price_czk: o.min_price_czk, min_price_eur: o.min_price_eur, dc_use_pct: o.dc_use_pct }; });
  res.send(V.adminProducts({ admin: req.admin, rows, error: out.error || '', msg: req.query.msg || '', holyosUrl: HOLYOS_URL, rate: await eurRate() }));
}));
// Jedno tlačítko Uložit u řádku: Discount Credit %, minimální cena Kč/€ a využití DC % najednou
// Jedno tlačítko Uložit na celou skupinu (např. L1 · H2): pole jsou pojmenována <pole>_<id položky>
app.post('/admin/products/save-group', requireAdmin, wrap(async (req, res) => {
  const num = (x, max) => { const t = String(x == null ? '' : x).replace(/\s/g, '').replace(',', '.'); if (t === '') return null; const n = Number(t); return isFinite(n) && n >= 0 ? (max ? Math.min(max, n) : n) : null; };
  const b = req.body, ids = [...new Set(Object.keys(b).map(k => (/^(?:credit_pct|min_czk|min_eur|dc_use_pct)_(\d+)$/.exec(k) || [])[1]).filter(Boolean))];
  for (const id of ids) {
    await q('INSERT INTO product_offers (holyos_item_id, offered, credit_pct, min_price_czk, min_price_eur, dc_use_pct, updated_at) VALUES ($1,false,$2,$3,$4,$5,now()) ON CONFLICT (holyos_item_id) DO UPDATE SET credit_pct=EXCLUDED.credit_pct, min_price_czk=EXCLUDED.min_price_czk, min_price_eur=EXCLUDED.min_price_eur, dc_use_pct=EXCLUDED.dc_use_pct, updated_at=now()',
      [id, num(b['credit_pct_' + id], 100) || 0, num(b['min_czk_' + id]), num(b['min_eur_' + id]), num(b['dc_use_pct_' + id], 100)]);
  }
  await log(req.admin, 'product_save_group', { ids });
  res.redirect('/admin/products?msg=' + encodeURIComponent('Uloženo (' + ids.length + ' ' + (ids.length === 1 ? 'produkt' : ids.length < 5 ? 'produkty' : 'produktů') + ').'));
}));
app.post('/admin/products/:id(\\d+)/save', requireAdmin, wrap(async (req, res) => {
  const num = (x, max) => { const t = String(x == null ? '' : x).replace(/\s/g, '').replace(',', '.'); if (t === '') return null; const n = Number(t); return isFinite(n) && n >= 0 ? (max ? Math.min(max, n) : n) : null; };
  const b = req.body, credit = num(b.credit_pct, 100) || 0, mc = num(b.min_czk), me = num(b.min_eur), du = num(b.dc_use_pct, 100);
  await q('INSERT INTO product_offers (holyos_item_id, offered, credit_pct, min_price_czk, min_price_eur, dc_use_pct, updated_at) VALUES ($1,false,$2,$3,$4,$5,now()) ON CONFLICT (holyos_item_id) DO UPDATE SET credit_pct=EXCLUDED.credit_pct, min_price_czk=EXCLUDED.min_price_czk, min_price_eur=EXCLUDED.min_price_eur, dc_use_pct=EXCLUDED.dc_use_pct, updated_at=now()', [req.params.id, credit, mc, me, du]);
  await log(req.admin, 'product_save', { holyos_item_id: Number(req.params.id), credit_pct: credit, min_czk: mc, min_eur: me, dc_use_pct: du });
  res.redirect('/admin/products?msg=' + encodeURIComponent('Produkt uložen.'));
}));
app.post('/admin/products/:id(\\d+)/min', requireAdmin, wrap(async (req, res) => {
  const num = (x) => { const t = String(x || '').replace(/\s/g, '').replace(',', '.'); if (t === '') return null; const n = Number(t); return isFinite(n) && n >= 0 ? n : null; };
  const mc = num(req.body.min_czk), me = num(req.body.min_eur);
  await q('INSERT INTO product_offers (holyos_item_id, offered, min_price_czk, min_price_eur, updated_at) VALUES ($1,false,$2,$3,now()) ON CONFLICT (holyos_item_id) DO UPDATE SET min_price_czk=EXCLUDED.min_price_czk, min_price_eur=EXCLUDED.min_price_eur, updated_at=now()', [req.params.id, mc, me]);
  await log(req.admin, 'product_min_price', { holyos_item_id: Number(req.params.id), min_czk: mc, min_eur: me });
  res.redirect('/admin/products?msg=' + encodeURIComponent('Minimální cena uložena.'));
}));
app.post('/admin/products/:id(\\d+)/dcuse', requireAdmin, wrap(async (req, res) => {
  const t = String(req.body.pct || '').replace(/\s/g, '').replace(',', '.');
  let pct = t === '' ? null : Number(t); if (pct != null) pct = isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null;
  await q('INSERT INTO product_offers (holyos_item_id, offered, dc_use_pct, updated_at) VALUES ($1,false,$2,now()) ON CONFLICT (holyos_item_id) DO UPDATE SET dc_use_pct=EXCLUDED.dc_use_pct, updated_at=now()', [req.params.id, pct]);
  await log(req.admin, 'product_dc_use_pct', { holyos_item_id: Number(req.params.id), pct });
  res.redirect('/admin/products?msg=' + encodeURIComponent('Využití DC uloženo.'));
}));
app.post('/admin/products/:id(\\d+)/credit', requireAdmin, wrap(async (req, res) => {
  let pct = Number(String(req.body.pct || '0').replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(pct) || pct < 0) pct = 0; if (pct > 100) pct = 100;
  await q('INSERT INTO product_offers (holyos_item_id, offered, credit_pct, updated_at) VALUES ($1,false,$2,now()) ON CONFLICT (holyos_item_id) DO UPDATE SET credit_pct=EXCLUDED.credit_pct, updated_at=now()', [req.params.id, pct]);
  await log(req.admin, 'product_credit_pct', { holyos_item_id: Number(req.params.id), pct });
  res.redirect('/admin/products?msg=' + encodeURIComponent('Discount Credit uložen.'));
}));
// Přepínač „Nabízet uživatelům" u stroje (id = položka ceníku HolyOS)
app.post('/admin/products/:id(\\d+)/offer', requireAdmin, wrap(async (req, res) => {
  const on = req.body.on === '1';
  await q('INSERT INTO product_offers (holyos_item_id, offered, updated_at) VALUES ($1,$2,now()) ON CONFLICT (holyos_item_id) DO UPDATE SET offered=EXCLUDED.offered, updated_at=now()', [req.params.id, on]);
  await log(req.admin, on ? 'product_offer_on' : 'product_offer_off', { holyos_item_id: Number(req.params.id) });
  res.redirect('/admin/products');
}));
app.get('/admin/orders', requireAdmin, wrap(async (req, res) => {
  const status = ['new', 'confirmed', 'cancelled'].includes(req.query.status) ? req.query.status : '';
  const rows = (await q("SELECT o.*, s.first_name, s.last_name, s.email, s.nick FROM orders o JOIN supporters s ON s.id=o.supporter_id " + (status ? 'WHERE o.status=$1 ' : '') + "ORDER BY (o.status='new') DESC, o.created_at DESC LIMIT 500", status ? [status] : [])).rows;
  const counts = {}; (await q('SELECT status, count(*)::int AS c FROM orders GROUP BY status')).rows.forEach(r => { counts[r.status] = r.c; });
  res.send(V.adminOrders({ admin: req.admin, rows, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, status, counts }));
}));
app.post('/admin/orders/:id(\\d+)/confirm', requireAdmin, wrap(async (req, res) => {
  const o = (await q("UPDATE orders SET status='confirmed', decided_at=now() WHERE id=$1 AND status='new' RETURNING *", [parseInt(req.params.id, 10)])).rows[0];
  if (!o) return res.redirect('/admin/orders');
  const s = await loadSupporter(o.supporter_id);
  const rate = o.currency === 'EUR' ? await eurRate() : 1;
  const priceCzk = Math.round(Number(o.final_net) * rate * 100) / 100;
  let m = null; try { m = ((await loadProducts()).items || []).find(p => p.id === o.holyos_item_id) || null; } catch (e) { /* bez parametrů */ }
  const ins = await q('INSERT INTO purchases (supporter_id, holyos_item_id, product_name, price_czk, note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [s.id, o.holyos_item_id, o.product_name, priceCzk, 'Objednávka #' + o.id + (Number(o.dc_used) > 0 ? ' · uplatněno ' + Number(o.dc_used).toLocaleString('cs-CZ') + ' DC' : '')]);
  const creditMsg = await grantSellerCredit(s, m ? { id: m.id } : (o.holyos_item_id ? { id: o.holyos_item_id } : null), priceCzk, o.product_name, ins.rows[0].id);
  if (s.user_type === 'standard') await q("UPDATE supporters SET user_type='owner', updated_at=now() WHERE id=$1", [s.id]);
  await log(req.admin, 'order_confirm', { id: o.id });
  res.redirect('/admin/orders?msg=' + encodeURIComponent('Objednávka #' + o.id + ' potvrzena, nákup zapsán.' + creditMsg));
}));
app.post('/admin/orders/:id(\\d+)/cancel', requireAdmin, wrap(async (req, res) => {
  const o = (await q("UPDATE orders SET status='cancelled', decided_at=now() WHERE id=$1 AND status='new' RETURNING id", [parseInt(req.params.id, 10)])).rows[0];
  if (o) { await q('DELETE FROM credits WHERE order_id=$1', [o.id]); await log(req.admin, 'order_cancel', { id: o.id }); }
  res.redirect('/admin/orders?msg=' + encodeURIComponent(o ? 'Objednávka zrušena, DC vráceny.' : 'Objednávku nelze zrušit.'));
}));
app.get('/admin/supporters/new', requireAdmin, (req, res) => res.send(V.adminSupporterDetail({ admin: req.admin, s: null, isNew: true, holyosUrl: HOLYOS_URL })));
app.post('/admin/supporters/new', requireAdmin, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).send(V.adminSupporterDetail({ admin: req.admin, s: { email, first_name: req.body.first_name, last_name: req.body.last_name }, isNew: true, error: 'Neplatný e-mail.', holyosUrl: HOLYOS_URL }));
  try {
    const r = await q('INSERT INTO supporters (email, first_name, last_name, source) VALUES ($1,$2,$3,$4) RETURNING id', [email, String(req.body.first_name || '').trim() || null, String(req.body.last_name || '').trim() || null, 'ručně']);
    await log(req.admin, 'create', { id: r.rows[0].id, email });
    res.redirect('/admin/supporters/' + r.rows[0].id + '?msg=' + encodeURIComponent('Uživatel založen.'));
  } catch (e) {
    const error = e.code === '23505' ? 'Uživatel s tímto e-mailem už existuje.' : e.message;
    res.status(400).send(V.adminSupporterDetail({ admin: req.admin, s: { email, first_name: req.body.first_name, last_name: req.body.last_name }, isNew: true, error, holyosUrl: HOLYOS_URL }));
  }
}));
async function loadSupporter(id) { const r = await q('SELECT * FROM supporters WHERE id=$1', [parseInt(id, 10) || 0]); return r.rows[0] || null; }
app.get('/admin/supporters/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id); if (!s) return res.status(404).send(V.errorPage('Nenalezeno', 'Uživatel neexistuje.', '/admin/supporters'));
  const firstLine = s.nick ? (await q("SELECT id,email,first_name,last_name,nick,status,extra FROM supporters WHERE id<>$1 AND lower(trim(extra->>'tab3')) = lower($2) ORDER BY lower(coalesce(last_name,'')), lower(coalesce(first_name,'')), email LIMIT 2000", [s.id, s.nick])).rows : [];
  const purchases = (await q('SELECT * FROM purchases WHERE supporter_id=$1 ORDER BY purchased_at DESC, id DESC', [s.id])).rows;
  let machines = []; try { machines = (await loadProducts()).items || []; } catch (e) { /* bez výběru */ }
  const credits = (await q('SELECT * FROM credits WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC', [s.id])).rows;
  res.send(V.adminSupporterDetail({ admin: req.admin, s, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, firstLine, purchases, machines, credits }));
}));
// Discount Credit prodejci: % z ceny bez DPH podle nastavení typu stroje; prodejce = kdo zákazníka přivedl (referred_by) nebo nick v tab3
async function grantSellerCredit(s, m, price, name, purchaseId) {
  let creditMsg = '';
  try {
    if (m && price != null) {
      const pct = Number(((await q('SELECT credit_pct FROM product_offers WHERE holyos_item_id=$1', [m.id])).rows[0] || {}).credit_pct || 0);
      const seller = (await q("SELECT id, nick FROM supporters WHERE id<>$1 AND (id=$2 OR ($3::text IS NOT NULL AND lower(nick)=lower($3))) ORDER BY (id=$2) DESC NULLS LAST LIMIT 1", [s.id, s.referred_by || 0, (s.extra && s.extra.tab3 && String(s.extra.tab3).trim()) || null])).rows[0];
      if (pct > 0 && seller) {
        const amount = Math.round(Number(price) * pct) / 100;
        await q('INSERT INTO credits (supporter_id, amount_czk, note, purchase_id) VALUES ($1,$2,$3,$4)', [seller.id, amount, 'Prodej: ' + name + ' (' + ([s.first_name, s.last_name].filter(Boolean).join(' ') || s.email) + '), ' + pct + ' % z ceny bez DPH', purchaseId]);
        creditMsg = ' Prodejci ' + (seller.nick || '') + ' připsáno ' + amount.toLocaleString('cs-CZ') + ' DC.';
      }
    }
  } catch (e) { console.error('credit auto', e.message); }
  return creditMsg;
}
app.post('/admin/supporters/:id(\\d+)/purchases', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id); if (!s) return res.redirect('/admin/supporters');
  let m = null; try { m = ((await loadProducts()).items || []).find(p => String(p.id) === String(req.body.item)); } catch (e) { /* ruční název */ }
  const name = m ? m.name_cs : String(req.body.custom || '').trim().slice(0, 200);
  if (!name) return res.redirect('/admin/supporters/' + s.id + '?msg=' + encodeURIComponent('Vyber prádlomat nebo zadej název.'));
  const pr = String(req.body.price || '').replace(/\s/g, '').replace(',', '.');
  const price = pr !== '' && !isNaN(Number(pr)) ? Number(pr) : (m && m.price_czk != null ? m.price_czk : null);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : new Date().toISOString().slice(0, 10);
  const ins = await q('INSERT INTO purchases (supporter_id, holyos_item_id, product_name, price_czk, purchased_at, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [s.id, m ? m.id : null, name, price, date, String(req.body.note || '').trim().slice(0, 500) || null]);
  const creditMsg = await grantSellerCredit(s, m, price, name, ins.rows[0].id);
  if (s.user_type === 'standard') await q("UPDATE supporters SET user_type='owner', updated_at=now() WHERE id=$1", [s.id]);
  await log(req.admin, 'purchase_add', { id: s.id, product: name });
  res.redirect('/admin/supporters/' + s.id + '?msg=' + encodeURIComponent('Nákup přidán.' + creditMsg));
}));
app.post('/admin/supporters/:id(\\d+)/credits', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id); if (!s) return res.redirect('/admin/supporters');
  const amt = Number(String(req.body.amount || '').replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(amt) || amt === 0) return res.redirect('/admin/supporters/' + s.id + '?msg=' + encodeURIComponent('Zadej nenulovou částku.'));
  await q('INSERT INTO credits (supporter_id, amount_czk, note) VALUES ($1,$2,$3)', [s.id, amt, String(req.body.note || '').trim().slice(0, 300) || null]);
  await log(req.admin, 'credit_add', { id: s.id, amount: amt });
  res.redirect('/admin/supporters/' + s.id + '?msg=' + encodeURIComponent('Kredit zapsán.'));
}));
app.post('/admin/credits/:cid(\\d+)/delete', requireAdmin, wrap(async (req, res) => {
  const r = await q('DELETE FROM credits WHERE id=$1 RETURNING supporter_id', [parseInt(req.params.cid, 10)]);
  await log(req.admin, 'credit_delete', { id: req.params.cid });
  res.redirect(r.rows[0] ? '/admin/supporters/' + r.rows[0].supporter_id + '?msg=' + encodeURIComponent('Pohyb smazán.') : '/admin/supporters');
}));
app.post('/admin/purchases/:pid(\\d+)', requireAdmin, wrap(async (req, res) => {
  const b = req.body, st = ['ordered', 'production', 'delivered', 'running'].includes(b.status) ? b.status : 'ordered';
  const t = (x, n) => String(x || '').trim().slice(0, n) || null;
  const r = await q('UPDATE purchases SET status=$1, serial_no=$2, location=$3, note=$4 WHERE id=$5 RETURNING supporter_id', [st, t(b.serial_no, 100), t(b.location, 300), t(b.note, 500), parseInt(req.params.pid, 10)]);
  await log(req.admin, 'purchase_update', { id: req.params.pid, status: st });
  res.redirect(r.rows[0] ? '/admin/supporters/' + r.rows[0].supporter_id + '?msg=' + encodeURIComponent('Nákup uložen.') : '/admin/supporters');
}));
app.post('/admin/purchases/:pid(\\d+)/delete', requireAdmin, wrap(async (req, res) => {
  const r = await q('DELETE FROM purchases WHERE id=$1 RETURNING supporter_id', [parseInt(req.params.pid, 10)]);
  await log(req.admin, 'purchase_delete', { id: req.params.pid });
  res.redirect(r.rows[0] ? '/admin/supporters/' + r.rows[0].supporter_id + '?msg=' + encodeURIComponent('Nákup smazán.') : '/admin/supporters');
}));
app.post('/admin/supporters/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
  const s = await loadSupporter(req.params.id); if (!s) return res.status(404).send(V.errorPage('Nenalezeno', 'Uživatel neexistuje.', '/admin/supporters'));
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    const utype = USER_TYPES.includes(String(req.body.user_type)) ? String(req.body.user_type) : (s.user_type || 'standard');
    await q('UPDATE supporters SET email=$1, first_name=$2, last_name=$3, user_type=$5, updated_at=now() WHERE id=$4', [email, String(req.body.first_name || '').trim() || null, String(req.body.last_name || '').trim() || null, s.id, utype]);
    await log(req.admin, 'update', { id: s.id, email, user_type: utype });
    // Ruční nastavení zůstatku DC: rozdíl proti aktuálnímu zůstatku se zapíše jako pohyb v credits (historie zůstává)
    let dcMsg = '';
    if (req.body.dc_balance != null && String(req.body.dc_balance).trim() !== '') {
      const target = Number(String(req.body.dc_balance).replace(/\s/g, '').replace(',', '.'));
      if (isFinite(target)) {
        const cur = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [s.id])).rows[0] || {}).b || 0);
        const diff = Math.round((target - cur) * 100) / 100;
        if (diff !== 0) {
          await q('INSERT INTO credits (supporter_id, amount_czk, note) VALUES ($1,$2,$3)', [s.id, diff, 'Ruční úprava zůstatku adminem (' + (req.admin.name || req.admin.username || 'admin') + '): ' + cur.toLocaleString('cs-CZ') + ' → ' + target.toLocaleString('cs-CZ') + ' DC']);
          await log(req.admin, 'credit_set', { id: s.id, from: cur, to: target });
          dcMsg = ' DC nastaveno na ' + target.toLocaleString('cs-CZ') + '.';
        }
      }
    }
    res.redirect('/admin/supporters/' + s.id + '?msg=' + encodeURIComponent('Uloženo.' + dcMsg));
  } catch (e) { res.status(400).send(V.adminSupporterDetail({ admin: req.admin, s, error: e.code === '23505' ? 'Tento e-mail už má jiný uživatel.' : e.message, holyosUrl: HOLYOS_URL })); }
}));
// Nové dočasné heslo — nick zůstává, heslo se zobrazí JEDNOU adminovi (předá uživateli), ten si ho pak změní v Můj účet
app.post('/admin/supporters/:id(\\d+)/password', requireAdmin, wrap(async (req, res) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = require('crypto').randomBytes(10);
  const pwd = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  const hash = await bcrypt.hash(pwd, 10);
  const r = await q("UPDATE supporters SET password_hash=$2, status=CASE WHEN status='blocked' THEN 'blocked' ELSE 'active' END, activated_at=COALESCE(activated_at, now()), updated_at=now() WHERE id=$1 RETURNING nick, email", [req.params.id, hash]);
  await log(req.admin, 'new_password', { id: Number(req.params.id) });
  const u = r.rows[0] || {};
  res.redirect('/admin/supporters/' + req.params.id + '?msg=' + encodeURIComponent('Nové dočasné heslo pro ' + (u.nick || u.email) + ': ' + pwd + ' — pošli ho uživateli, ať si ho po přihlášení změní.'));
}));
// „Reset přihlášení" (smazání nicku + hesla) odstraněn 2026-10-05 na přání Tomáše — nahrazen akcí Nové heslo. Endpoint záměrně neexistuje.
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
  res.redirect('/admin/supporters?msg=' + encodeURIComponent('Uživatel smazán.'));
}));
// Import běží na pozadí (28k řádků by přes proxy vypršelo) — úloha v paměti + průběh přes /admin/import/status/:id
const importJobs = new Map();
app.get('/admin/import', requireAdmin, (req, res) => {
  const job = req.query.job ? importJobs.get(String(req.query.job)) : null;
  if (job && job.done) return res.send(V.adminImport({ admin: req.admin, result: job.result, holyosUrl: HOLYOS_URL }));
  res.send(V.adminImport({ admin: req.admin, job, holyosUrl: HOLYOS_URL }));
});
app.get('/admin/import/status/:id', requireAdmin, (req, res) => {
  const j = importJobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Úloha nenalezena (server se mezitím restartoval?)' });
  res.json({ id: j.id, total: j.total, processed: j.processed, done: j.done, error: j.error || null, started_at: j.started_at, finished_at: j.finished_at || null,
    created: j.result.created, updated: j.result.updated, skipped: j.result.skipped, errors: j.result.errors.length });
});
app.post('/admin/import', requireAdmin, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).send(V.adminImport({ admin: req.admin, error: 'Vyber soubor.', holyosUrl: HOLYOS_URL }));
  let prep;
  try { prep = prepareImport(req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).send(V.adminImport({ admin: req.admin, error: 'Soubor se nepodařilo zpracovat: ' + e.message, holyosUrl: HOLYOS_URL })); }
  const { result, prepared } = prep;
  if (req.body.dry === '1' || !prepared.length) {
    result.created = prepared.length; result.file += req.body.dry === '1' ? ' (jen zkouška, nic neuloženo)' : '';
    return res.send(V.adminImport({ admin: req.admin, result, holyosUrl: HOLYOS_URL }));
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const job = { id, total: prepared.length, processed: 0, done: false, started_at: new Date().toISOString(), result };
  importJobs.set(id, job);
  // po hodině uklidit
  setTimeout(() => importJobs.delete(id), 3600e3).unref();
  const admin = req.admin;
  setImmediate(async () => {
    try { await writeImport(prepared, result, { onProgress: (n) => { job.processed = n; } }); }
    catch (e) { job.error = e.message; result.errors.unshift('Import přerušen: ' + e.message); }
    finally {
      job.done = true; job.finished_at = new Date().toISOString();
      await log(admin, 'import', { file: req.file.originalname, rows: result.rows, created: result.created, updated: result.updated, skipped: result.skipped, nick_conflicts: result.nick_conflicts, error: job.error || null });
    }
  });
  res.redirect('/admin/import?job=' + id);
}));

// ── Chyby ──────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).send(V.errorPage('Stránka nenalezena', 'Tahle adresa neexistuje.', '/')));
app.use((err, req, res, next) => { console.error('[bs2]', err); res.status(500).send(V.errorPage('Chyba serveru', process.env.NODE_ENV === 'production' ? 'Něco se pokazilo, zkus to znovu.' : err.message, '/')); });

migrate().then(() => app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT}`)))
  .catch((e) => { console.error('[bs2] DB migrace selhala:', e.message); app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT} (BEZ DB — nastav DATABASE_URL)`)); });
