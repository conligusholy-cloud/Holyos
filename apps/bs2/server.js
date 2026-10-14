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
const LOC = require('./location');
const LAPP = require('./location-app');
const LADM = require('./location-admin');
const LSTUDY = require('./location-study');
const { importSupporters, prepareImport, writeImport } = require('./import');
const AI = require('./ai');
const BUILD = require('./build');
const ST = require('./stats');

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
// Větší limit těla požadavku — nastavení AI chatu (znalosti po tématech) může mít stovky kB
app.use(express.json({ limit: '8mb', verify: (req, res, buf) => { if (req.originalUrl === '/api/location/stripe-webhook') req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '8mb' }));
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isHttps(req)) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CSP: cizí skripty se nespustí, formuláře nejdou odeslat jinam, stránku nelze vložit do iframe. Inline skripty/handlery aplikace jsou povoleny ('unsafe-inline').
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
// ---- CSRF: každý POST musí přijít z našeho webu (Origin/Referer = náš host). Formuláře navíc nesou token svázaný s relací. ----
const CSRF_SECRET = (process.env.BS2_SESSION_SECRET || 'dev') + ':csrf';
function csrfToken(req) { const a = req.cookies && (req.cookies.bs2_user || req.cookies.bs2_admin || ''); return require('crypto').createHmac('sha256', CSRF_SECRET).update(String(a)).digest('hex').slice(0, 32); }
app.use((req, res, next) => {
  if (req.method !== 'POST' || req.path === '/sso' || req.path.startsWith('/api/health')) return next();
  const host = req.get('host'); const src = req.get('origin') || req.get('referer') || '';
  if (src) { try { if (new URL(src).host !== host) return res.status(403).send('Požadavek odmítnut (CSRF).'); } catch (e) { return res.status(403).send('Požadavek odmítnut (CSRF).'); } }
  else if (!(req.get('content-type') || '').includes('application/json')) return res.status(403).send('Požadavek odmítnut (CSRF).');
  req.csrfToken = csrfToken(req); next();
});
app.use((req, res, next) => {
  req.csrfToken = req.csrfToken || csrfToken(req);
  if (req.method === 'POST' && (req.get('content-type') || '').includes('application/x-www-form-urlencoded') && req.path !== '/login' && req.path !== '/activate' && req.path !== '/activate/finish' && req.path !== '/forgot' && !req.path.startsWith('/join/') && !req.path.startsWith('/reset/')) {
    if (String((req.body || {})._csrf || '') !== req.csrfToken) return res.status(403).send('Formulář vypršel nebo byl odeslán odjinud — obnovte stránku a zkuste to znovu.');
  }
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Sessions ───────────────────────────────────────────────────────────────
const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
function setCookie(req, res, name, payload, maxAgeSec) {
  const t = jwt.sign(payload, SESSION_SECRET, { expiresIn: maxAgeSec });
  res.cookie(name, t, { httpOnly: true, secure: isHttps(req), sameSite: 'lax', maxAge: maxAgeSec * 1000 });
}
function readCookie(req, name) { const t = req.cookies && req.cookies[name]; if (!t || !SESSION_SECRET) return null; try { return jwt.verify(t, SESSION_SECRET); } catch (e) { return null; } }
// Správce BS2 = jen Tomáš Holý a Jan Holý (nezávisle na nastavení HolyOS). BS2_ALLOWED_PIDS může seznam zúžit na konkrétní person id.
function isAllowedAdmin(p) {
  if (!p) return false;
  if (ALLOWED_PIDS.length && !ALLOWED_PIDS.includes(Number(p.pid))) return false;
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const parts = norm(p.name).split(/\s+/).filter(Boolean);
  const first = parts[0] || '', last = parts[parts.length - 1] || '';
  return last === 'holy' && (first === 'tomas' || first === 'jan');
}
// ── Volitelné 2FA pro správce (zapne se env BS2_ADMIN_2FA=1): TOTP (Google/Microsoft Authenticator), tajemství per správce v app_settings ──
const ADMIN_2FA = String(process.env.BS2_ADMIN_2FA || '') === '1';
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function b32dec(str) { let bits = '', out = []; for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret, t = Date.now(), step = 30) { const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step))); const h = crypto.createHmac('sha1', b32dec(secret)).update(ctr).digest(); const o = h[h.length - 1] & 0xf; const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0'); return code; }
function totpOk(secret, code) { const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false; for (const d of [-1, 0, 1]) if (totp(secret, Date.now() + d * 30000) === c) return true; return false; }
async function adminTotpSecret(pid) { try { const r = await q("SELECT value FROM app_settings WHERE key=$1", ['admin_totp_' + pid]); return (r.rows[0] || {}).value || null; } catch (e) { return null; } }
function requireAdmin(req, res, next) {
  const s = readCookie(req, ADMIN_COOKIE);
  if (ADMIN_2FA && s && s.kind === 'admin' && !s.tfa && !req.path.startsWith('/admin/2fa')) return res.redirect('/admin/2fa');
  // Nepřihlášený nikdy nesmí být poslán do HolyOS — admin se dostane jen z menu HolyOS; návštěvník uvidí jen BS2 login
  if (!s || s.kind !== 'admin') return res.redirect('/login');
  if (!isAllowedAdmin(s)) { res.clearCookie(ADMIN_COOKIE); return res.status(403).send(V.errorPage('Přístup odepřen', 'Administrace je dostupná jen Tomáši a Janu Holému.', '/')); }
  req.admin = s; next();
}
async function requireUser(req, res, next, skipConsent) {
  const s = readCookie(req, USER_COOKIE);
  if (!s || s.kind !== 'user') return res.redirect('/login');
  const r = await q('SELECT * FROM supporters WHERE id=$1', [s.sid]);
  const u = r.rows[0];
  if (!u || u.status !== 'active') { res.clearCookie(USER_COOKIE); return res.redirect('/login'); }
  // Záložka AI chat se v menu ukáže jen když je chat zapnutý v Admin → AI chat (a je k dispozici API klíč)
  try { const cfg = await AI.loadConfig(); u.ai_chat_on = !!cfg.enabled && !!process.env.ANTHROPIC_API_KEY; } catch (e) { u.ai_chat_on = false; }
  // Kdo ještě nepotvrdil VOP a souhlas se zpracováním osobních údajů (např. přenesený ze starého systému), musí je nejdřív odsouhlasit
  if (!skipConsent && (!u.vop_consent_at || !u.gdpr_consent_at)) return res.redirect('/souhlas');
  try { const dd = await userDocs(u); u.new_docs = dd.filter(d => !d.seen).length; u.unpaid_docs = dd.filter(d => d.unpaid).length; } catch (e) { u.new_docs = 0; u.unpaid_docs = 0; }
  req.user = u; next();
}
// Doklady (odeslané faktury z HolyOS) k objednávkám uživatele; cache 60 s, aby se HolyOS nevolal při každém zobrazení stránky
const _docCache = new Map();
async function userDocs(u, fresh) {
  const c = _docCache.get(u.id);
  if (!fresh && c && Date.now() - c.t < 60e3) return c.docs;
  const ordRows = (await q('SELECT id, status FROM orders WHERE supporter_id=$1 ORDER BY id DESC LIMIT 100', [u.id])).rows;
  const ids = ordRows.map(r => r.id); const cancelled = new Set(ordRows.filter(r => r.status === 'cancelled').map(r => r.id));
  let docs = [];
  if (ids.length) {
    const r = await holyosFetch('GET', '/api/auth/bs2/invoices?refs=' + ids.join(','), null, 3500);
    if (r.ok) {
      const m = await r.json();
      Object.keys(m).forEach(ref => ['proforma', 'final'].forEach(w => {
        const i = m[ref][w];
        if (i && i.delivery_status === 'sent') {
          // Záloha čeká na zaplacení: není zaplacená, nemá finální fakturu a objednávka není zrušená
          const paid = i.status === 'cancelled' || i.status === 'paid' || Number(i.paid_amount || 0) + 0.01 >= Number(i.total) || !!m[ref].final;
          docs.push({ ref: Number(ref), which: w, id: i.id, number: i.invoice_number, total: i.total, currency: i.currency, sent_at: i.sent_at, due: i.date_due, unpaid: w === 'proforma' && !paid && !cancelled.has(Number(ref)) });
        }
      }));
    } else if (c) return c.docs;
  }
  const seen = new Set((await q('SELECT invoice_id FROM doc_seen WHERE supporter_id=$1', [u.id])).rows.map(r => r.invoice_id));
  docs.forEach(d => { d.seen = seen.has(d.id); });
  _docCache.set(u.id, { t: Date.now(), docs });
  return docs;
}
const requireUserNoConsent = (req, res, next) => requireUser(req, res, next, true);
// Obecný rate-limit v paměti: key (např. 'support:'+id), max pokusů za okno
const _rl = new Map();
function rateLimited(key, max, windowMs) { const now = Date.now(); const a = _rl.get(key) || { n: 0, t: now }; if (now - a.t > windowMs) { a.n = 0; a.t = now; } a.n++; _rl.set(key, a); if (_rl.size > 20000) _rl.clear(); return a.n > max; }
// Jednoduchý rate-limit přihlašování per IP (v paměti)
const attempts = new Map();
function tooMany(ip) { const a = attempts.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); } return a.n >= 20; }
function noteFail(ip) { const a = attempts.get(ip) || { n: 0, t: Date.now() }; a.n++; attempts.set(ip, a); }
// Přepínač prostředí Admin ⇄ Uživatel v hlavičce: obě přihlášení (bs2_admin a bs2_user) existují vedle sebe,
// takže se dá mezi nimi přepínat bez nového přihlášení. Značka <!--BS2-SWITCH--> se nahradí až při odeslání stránky.
app.use((req, res, next) => {
  const send = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string' && body.includes('<!--BS2-SWITCH-->')) {
      const a = readCookie(req, ADMIN_COOKIE), u = readCookie(req, USER_COOKIE);
      const hasAdmin = !!(a && a.kind === 'admin' && isAllowedAdmin(a)), hasUser = !!(u && u.kind === 'user');
      const inAdmin = req.path.startsWith('/admin');
      let html = '';
      if (false && (hasAdmin || (hasUser && inAdmin))) { // přepínač Admin/Uživatel vypnut — do administrace se chodí jen z menu HolyOS
        // z admina: „Uživatel" vede do uživatelského prostředí (bez uživatelského přihlášení na přihlašovací stránku)
        html = `<span class="envsw" role="group" aria-label="Prostředí"><a href="/admin" class="${inAdmin ? 'on' : ''}" title="Administrace">🛠 <span>Admin</span></a><a href="${hasUser ? '/' : '/login'}" class="${inAdmin ? '' : 'on'}" title="${hasUser ? 'Uživatelské prostředí' : 'Uživatelské prostředí — nejdřív se přihlas jako uživatel'}">👤 <span>Uživatel</span></a></span>`;
      }
      body = body.replace('<!--BS2-SWITCH-->', html);
    }
    if (typeof body === 'string' && body.includes('<form')) body = body.replace(/<form\b([^>]*method=["']?post["']?[^>]*)>/gi, (m) => m + '<input type="hidden" name="_csrf" value="' + csrfToken(req) + '">');
    return send(body);
  };
  next();
});
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const LOC_STATUS_TXT = { pending: 'čeká na platbu', request: 'žádost', paid: 'zaplaceno', granted: 'přístup předán', cancelled: 'zrušeno' };
function velinForLog(admin, action, d) {
  d = d || {}; const who = (admin && admin.name) || '';
  if (action === 'order_new') notifyVelin('🛒 Nová objednávka #' + d.id, (d.product || d.service || 'objednávka') + (who ? ' · ' + who : ''), '/admin/orders', 'order');
  else if (action === 'order_confirm') notifyVelin('✅ Objednávka #' + d.id + ' potvrzena', (d.service ? 'služba ' + d.service : 'stav: potvrzeno') + (who ? ' · ' + who : ''), '/admin/orders', 'order');
  else if (action === 'order_cancel') notifyVelin('❌ Objednávka #' + d.id + ' zrušena', who ? 'zrušil(a) ' + who : 'stav: zrušeno', '/admin/orders', 'order');
  else if (action === 'location_status') notifyVelin('🌐 Online objednávka #' + d.id, 'nový stav: ' + (LOC_STATUS_TXT[d.status] || d.status) + (who ? ' · ' + who : ''), '/admin/online', 'order');
  else if (action === 'suggestion_new') notifyVelin('💡 Nový podnět na vylepšení', (who ? 'od ' + who : 'nový podnět'), '/admin/suggestions', 'suggestion');
}
async function log(admin, action, detail) { try { velinForLog(admin || {}, action, detail); } catch (e) { /* notifikace nejsou kritické */ } try { await q('INSERT INTO admin_log (admin_pid, admin_name, action, detail) VALUES ($1,$2,$3,$4)', [admin.pid || null, admin.name || null, action, detail ? JSON.stringify(detail) : null]); } catch (e) { /* log není kritický */ } }

// Zákazník aplikace vidí jen /lokalita*; ostatní uživatelé do /lokalita nesmí.
app.use((req, res, next) => {
  const s = readCookie(req, USER_COOKIE); if (!s || s.kind !== 'user') return next();
  if (!/^\/(lokalita|password|podpora|api\/support|support\/file|logout|souhlas|api\/track|api\/presence|location)/.test(req.path) && !req.path.startsWith('/admin') && !req.path.startsWith('/api/health') && !req.path.startsWith('/img') && !req.path.startsWith('/api/location')) {
    return q('SELECT user_type FROM supporters WHERE id=$1', [s.sid]).then((r) => { const u = r.rows[0]; if (u && u.user_type === 'location') return res.redirect('/lokalita'); next(); }).catch(() => next());
  }
  next();
});
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
    if (!isAllowedAdmin(p)) return res.status(403).send(V.errorPage('Přístup odepřen', 'Administrace je dostupná jen Tomáši a Janu Holému.', '/login'));
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
  // Číslo na přihlašovací stránce = lidé, kteří se do Best Series 2.0 aspoň jednou sami přihlásili (stejně jako admin → Přehled)
  try { const r = await q("SELECT count(*)::int AS n FROM supporters WHERE last_login_at IS NOT NULL"); _members = { n: r.rows[0].n, at: Date.now() }; } catch (e) { _members = { n: null, at: Date.now() }; }
  return _members.n;
}
// Favicon / logo (SVG, cache 1 den)
app.get('/favicon.svg', (req, res) => { res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(require('./logo').logoSvg(64, 'f')); });
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.get('/img/pradlomat.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(require('path').join(__dirname, 'pradlomat.webp')));
app.get('/img/pradlomat-mini.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(require('path').join(__dirname, 'pradlomat-mini.webp')));
// Chyby přihlášení se předávají přes redirect (?e=kód), aby obnovení stránky nenabízelo „odeslat formulář znovu"
const LOGIN_ERRORS = { bad: 'Nesprávný nick/e-mail nebo heslo.', inactive: 'Účet ještě není aktivovaný. Otevři bestseries2.cz/activate a nastav si heslo.', many: 'Příliš mnoho pokusů. Zkus to za 15 minut.', locked: 'Účet je dočasně zamčený po opakovaných neúspěšných pokusech. Zkus to za chvíli.' };
app.get('/login', wrap(async (req, res) => {
  if (readCookie(req, USER_COOKIE)) return res.redirect('/');
  const e = String(req.query.e || ''); const error = LOGIN_ERRORS[e] ? LOGIN_ERRORS[e] + (e === 'locked' && req.query.min ? ' (' + parseInt(req.query.min, 10) + ' min)' : '') : '';
  res.send(V.loginPage({ members: await memberCount(), error, login: String(req.query.login || '').slice(0, 120), info: req.query.activated ? 'Účet je aktivní, můžeš se přihlásit.' : req.query.reset ? 'Heslo je změněné, můžeš se přihlásit.' : req.query.out ? 'Byl jsi odhlášen.' : '' }));
}));
// Zapomenuté heslo — zatím bez automatického e-mailu: žádost se zapíše do admin_log, Tomáš/Jan ji vyřídí ručně (reset v adminu)
app.get('/forgot', (req, res) => res.send(V.forgotPage()));
// Odeslání e-mailu přes HolyOS (Graph send-as); BS2 samo e-maily neodesílá.
async function sendBs2MailRaw({ to, subject, body, link, linkLabel }) {
  const secret = process.env.BS2_SSO_SECRET; if (!secret) throw new Error('Chybí BS2_SSO_SECRET');
  const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + '/api/auth/bs2/send-mail', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body, link, linkLabel }), signal: AbortSignal.timeout(20000) });
  console.log('[bs2] HolyOS send-mail odpověď ' + r.status);
  if (!r.ok) throw new Error('HolyOS send-mail ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
}
// Fakturace přes HolyOS (zálohová faktura k objednávce produktu / faktura po platbě online produktu). Fire-and-forget, selhání se jen zaloguje.
async function holyosFetch(method, path, body, timeoutMs) {
  const secret = process.env.BS2_SSO_SECRET; if (!secret) throw new Error('Chybí BS2_SSO_SECRET');
  const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
  return fetch(HOLYOS_URL + path, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs || 25000) });
}
function holyosInvoice(kind, payload) {
  try {
    const secret = process.env.BS2_SSO_SECRET; if (!secret || !HOLYOS_URL) return;
    const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
    fetch(HOLYOS_URL + '/api/auth/bs2/invoice/' + kind, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(async (r) => { const t = await r.text().catch(() => ''); console.log('[bs2] faktura ' + kind + ' ref=' + payload.ref + ' → ' + r.status + ' ' + t.slice(0, 160)); })
      .catch((e) => console.warn('[bs2] faktura ' + kind + ':', e.message));
  } catch (e) { console.warn('[bs2] faktura ' + kind + ':', e.message); }
}
const invCustomer = (u) => ({ name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.nick || u.email, email: u.email, phone: u.phone || null });
function orderInvItems(name, net, disc) {
  const it = [{ description: name, quantity: 1, unit_price: Number(net) }];
  if (Number(disc) > 0) it.push({ description: 'Sleva (Discount Credit)', quantity: 1, unit_price: -Number(disc) });
  return it;
}
// Push do Velína (Tomáš + Jan Holý) přes HolyOS. Fire-and-forget; selhání nikdy neshodí požadavek.
function notifyVelin(title, body, path, type) {
  try {
    const secret = process.env.BS2_SSO_SECRET; if (!secret || !HOLYOS_URL) return;
    const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
    fetch(HOLYOS_URL + '/api/auth/bs2/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, path, type }) })
      .then(async (r) => { const t = await r.text().catch(() => ''); if (!r.ok) console.warn('[bs2] velín notify ' + r.status + ' ' + t.slice(0, 120)); else console.log('[bs2] velín notify OK: ' + title + ' → ' + t.slice(0, 80)); })
      .catch((e) => console.warn('[bs2] velín notify:', e.message));
  } catch (e) { console.warn('[bs2] velín notify:', e.message); }
}
// Odeslání + zápis do mail_log (úspěch i chyba), aby šlo e-maily vidět v aktivitě uživatele
async function sendBs2Mail(o) {
  try { await sendBs2MailRaw(o); logMail(o, 'sent', null); }
  catch (e) { logMail(o, 'failed', e.message); throw e; }
}
function logMail(o, status, error) {
  const to = String((o && o.to) || '').trim().toLowerCase(); if (!to) return;
  q('INSERT INTO mail_log (supporter_id, to_email, subject, status, error) VALUES ((SELECT id FROM supporters WHERE lower(email)=$1 LIMIT 1), $1, $2, $3, $4)', [to, String(o.subject || '').slice(0, 300), status, error ? String(error).slice(0, 300) : null]).catch(() => {});
}
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
// Obnova hesla: ověří e-mail v databázi a pokud existuje, pošle odkaz (platí 1 hodinu, jednorázový). Odpověď je vždy stejná.
app.post('/forgot', wrap(async (req, res) => {
  const ip = req.ip;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).send(V.forgotPage({ email, error: 'Zadej platný e-mail.' }));
  if (tooMany(ip)) return res.status(429).send(V.forgotPage({ email, error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  noteFail(ip);
  const r = await q('SELECT id, nick, first_name, status, password_hash FROM supporters WHERE lower(email)=$1 LIMIT 1', [email]);
  const u = r.rows[0];
  let sent = false, why = '', resetRowId = null;
  if (u && u.status !== 'blocked') {
    if (!u.password_hash) { // účet ještě není aktivovaný → pošleme odkaz na aktivaci (tam se potvrdí VOP a GDPR)
      try { await sendBs2Mail({ to: email, subject: 'Aktivace účtu — Best Series 2.0', link: PUBLIC_URL + '/activate', linkLabel: 'Aktivovat účet', body: (u.first_name ? 'Ahoj ' + u.first_name + ',' : 'Ahoj,') + '\n\nTvůj účet v Best Series 2.0 ještě není aktivovaný. Aktivuješ ho přes odkaz níže — zadáš tento e-mail a zvolíš si nick a heslo.' }); sent = true; } catch (e) { why = 'mail_error'; console.error('[bs2] aktivační e-mail:', e.message); }
    } else {
    const recent = (await q("SELECT count(*)::int AS c FROM password_resets WHERE supporter_id=$1 AND created_at > now() - interval '15 minutes'", [u.id])).rows[0].c;
    if (recent >= 3) why = 'limit';
    else {
      try {
        const raw = crypto.randomBytes(32).toString('hex');
        const ins = await q("INSERT INTO password_resets (supporter_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour') RETURNING id", [u.id, sha256(raw)]);
        resetRowId = ins.rows[0].id;
        const hello = u.first_name ? 'Ahoj ' + u.first_name + ',' : 'Ahoj,';
        await sendBs2Mail({ to: email, subject: 'Obnovení hesla — Best Series 2.0', link: PUBLIC_URL + '/reset/' + raw, linkLabel: 'Nastavit nové heslo',
          body: hello + '\n\nněkdo (doufáme, že Ty) požádal o obnovu hesla k účtu v Best Series 2.0' + (u.nick ? ' (nick ' + u.nick + ')' : '') + '. Nové heslo si nastavíš přes odkaz níže. Odkaz platí 1 hodinu a lze ho použít jen jednou.\n\nPokud jsi o obnovu nežádal, tento e-mail ignoruj — Tvoje heslo zůstane beze změny.' });
        sent = true;
      } catch (e) { why = 'mail_error'; if (resetRowId) await q('DELETE FROM password_resets WHERE id=$1', [resetRowId]).catch(() => {}); console.error('[bs2] obnova hesla — e-mail se nepodařilo odeslat:', e.message); }
    }
    }
  }
  console.log('[bs2] obnova hesla: e-mail=' + email + ' nalezen=' + !!u + (u ? ' stav=' + u.status + ' heslo=' + !!u.password_hash : '') + ' odesláno=' + sent + (why ? ' důvod=' + why : ''));
  if (u) ST.track(req, u.id, 'reset_request', { meta: { sent } });
  await log({ name: 'web' }, 'forgot_password', { email, known: !!u, sent, why: why || undefined, supporter_id: u ? u.id : null, ip });
  res.send(V.forgotPage({ email, done: true }));
}));
async function findReset(raw) {
  const r = await q("SELECT pr.id, pr.supporter_id, s.nick, s.email FROM password_resets pr JOIN supporters s ON s.id=pr.supporter_id WHERE pr.token_hash=$1 AND pr.used_at IS NULL AND pr.expires_at > now() AND s.status<>'blocked'", [sha256(String(raw || ''))]);
  return r.rows[0] || null;
}
app.get('/reset/:token', wrap(async (req, res) => {
  const t = await findReset(req.params.token);
  if (!t) return res.status(400).send(V.resetPage({ invalid: true }));
  res.send(V.resetPage({ token: req.params.token, nick: t.nick }));
}));
app.post('/reset/:token', wrap(async (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).send(V.resetPage({ token: req.params.token, error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const t = await findReset(req.params.token);
  if (!t) { noteFail(ip); return res.status(400).send(V.resetPage({ invalid: true })); }
  const password = String(req.body.password || ''), password2 = String(req.body.password2 || '');
  const back = (error) => res.status(400).send(V.resetPage({ token: req.params.token, nick: t.nick, error }));
  if (password.length < 8) return back('Heslo musí mít aspoň 8 znaků.');
  if (password !== password2) return back('Hesla se neshodují.');
  const hash = await bcrypt.hash(password, 11);
  await q("UPDATE supporters SET password_hash=$1, updated_at=now() WHERE id=$2", [hash, t.supporter_id]);
  await q('UPDATE password_resets SET used_at=now() WHERE supporter_id=$1 AND used_at IS NULL', [t.supporter_id]);
  await log({ name: 'web' }, 'password_reset_done', { supporter_id: t.supporter_id, ip });
  res.redirect('/login?reset=1');
}));
app.post('/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.redirect('/login?e=many');
  const login = String(req.body.login || '').trim(), password = String(req.body.password || '');
  const r = await q('SELECT * FROM supporters WHERE lower(email)=lower($1) OR lower(nick)=lower($1) LIMIT 1', [login]);
  const u = r.rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) return res.redirect('/login?e=locked&min=' + Math.ceil((new Date(u.locked_until) - Date.now()) / 60000) + '&login=' + encodeURIComponent(login));
  if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
    noteFail(ip);
    ST.track(req, u && u.id, 'login_fail', { meta: { known: !!u, activated: !!(u && u.password_hash) } });
    if (u) await q("UPDATE supporters SET failed_logins=COALESCE(failed_logins,0)+1, locked_until=CASE WHEN COALESCE(failed_logins,0)+1>=10 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1", [u.id]).catch(() => {});
    return res.redirect('/login?e=' + (u && !u.password_hash ? 'inactive' : 'bad') + '&login=' + encodeURIComponent(login));
  }
  if (u.status === 'blocked') return res.status(403).send(V.loginPage({ error: 'Účet je zablokovaný. Ozvi se nám.', login }));
  await q('UPDATE supporters SET last_login_at=now(), failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]);
  ST.track(req, u.id, 'login', { meta: { by: login.includes('@') ? 'email' : 'nick' } });
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
  if (String(req.body.vop || '') !== '1') return back('Pro aktivaci účtu je nutné odsouhlasit všeobecné obchodní podmínky.');
  if (String(req.body.gdpr || '') !== '1') return back('Pro aktivaci účtu je nutné odsouhlasit zpracování osobních údajů.');
  const taken = await q('SELECT 1 FROM supporters WHERE lower(nick)=lower($1) AND id<>$2', [nick, u.id]);
  if (taken.rows.length) return back('Tenhle nick už někdo má, zvol jiný.');
  const hash = await bcrypt.hash(password, 11);
  await q("UPDATE supporters SET nick=$1, password_hash=$2, status='active', activated_at=now(), last_login_at=now(), updated_at=now(), gdpr_consent_at=now(), vop_consent_at=now() WHERE id=$3", [nick, hash, u.id]);
  setCookie(req, res, USER_COOKIE, { kind: 'user', sid: u.id, nick }, 30 * 24 * 3600);
  res.redirect('/');
}));
app.get('/logout', (req, res) => { try { const ls = readCookie(req, USER_COOKIE); if (ls && ls.kind === 'user') { ST.track(req, ls.sid, 'logout'); ST.leave(ls.sid); } } catch (e) {} res.clearCookie(USER_COOKIE); res.clearCookie(ADMIN_COOKIE); res.redirect('/login?out=1'); });

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
  return s && s.status !== 'blocked' && ['seller', 'standard'].includes(s.user_type) ? s : null; // doporučovat mohou typy Může prodávat i Stávající
}
app.get('/join/:code', wrap(async (req, res) => {
  const seller = await loadSeller(req.params.code);
  if (!seller) return res.status(404).send(V.errorPage('Odkaz neplatí', 'Tenhle registrační odkaz není platný. Požádej toho, kdo ti ho poslal, o nový.', '/login'));
  if (readCookie(req, USER_COOKIE)) return res.redirect('/');
  res.send(V.joinPage({ code: req.params.code, seller }));
}));
app.get('/gdpr', (req, res) => res.send(V.gdprPage()));
// Sběr událostí z prohlížeče přihlášeného uživatele (stránky, kliknutí, čas, scroll) — vždy 204, chyby se ignorují
const TRACK_TYPES = ['pageview', 'click', 'time', 'scroll', 'section', 'interact', 'ping'];
// Živý počet lidí na webu pro lištu (přihlášení uživatelé; ping každých 30 s). Za hodinu = unikátní uživatelé s aktivitou do 60 min.
// Číslo v liště = online právě teď (ping do 90 s) + aktivní lidé za posledních 60 minut z databáze událostí (stejně jako admin Živě); cache 10 s
let _presCache = { at: 0, data: null };
// Anonymní ping z veřejných stránek (bez přihlášení): jen náhodné sid z prohlížeče, žádné osobní údaje
const PUBLIC_HIT_PATHS = ['/location', '/login', '/activate', '/home', '/location/vop', '/location/gdpr'];
app.post('/api/presence/ping', (req, res) => {
  const sid = String((req.body || {}).sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (sid && !rateLimited('pp:' + req.ip, 240, 3600e3)) {
    ST.anonTouch(sid);
    const path = String((req.body || {}).path || '').split('?')[0].replace(/\/+$/, '') || '/';
    if (PUBLIC_HIT_PATHS.includes(path)) q('INSERT INTO page_hits (d, path, sid) VALUES (CURRENT_DATE, $1, $2) ON CONFLICT DO NOTHING', [path, sid]).catch(() => {});
  }
  res.json({ ok: true });
});
// Statistiky pro HolyOS Centrum reklamy (JWT iss=holyos, aud=bs2-api, sdílený BS2_SSO_SECRET)
app.get('/api/holyos/ads-stats', wrap(async (req, res) => {
  const secret = process.env.BS2_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { jwt.verify(m[1], secret, { audience: 'bs2-api', issuer: 'holyos' }); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const visits = (await q("SELECT path, to_char(d,'YYYY-MM-DD') AS d, count(*)::int AS n FROM page_hits WHERE d > CURRENT_DATE - $1::int GROUP BY path, d ORDER BY d", [days])).rows;
  const uniques = (await q("SELECT path, count(DISTINCT sid)::int AS n FROM page_hits WHERE d > CURRENT_DATE - $1::int GROUP BY path", [days])).rows;
  const orders = (await q("SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('paid','granted'))::int AS paid, COALESCE(sum(amount_czk) FILTER (WHERE status IN ('paid','granted')),0) AS revenue, count(*) FILTER (WHERE status IN ('pending','request'))::int AS pending FROM location_orders WHERE created_at > now() - ($1::int || ' days')::interval", [days])).rows[0];
  const ordersByDay = (await q("SELECT to_char(created_at,'YYYY-MM-DD') AS d, count(*)::int AS n, count(*) FILTER (WHERE status IN ('paid','granted'))::int AS paid FROM location_orders WHERE created_at > now() - ($1::int || ' days')::interval GROUP BY 1 ORDER BY 1", [days])).rows;
  const customers = Number(((await q('SELECT count(*)::int AS n FROM supporters WHERE location_package IS NOT NULL')).rows[0] || {}).n || 0);
  const logins = (await q("SELECT count(DISTINCT supporter_id)::int AS n FROM user_events WHERE type='login' AND created_at > now() - ($1::int || ' days')::interval", [days])).rows[0];
  res.json({ days, visits, uniques, orders, ordersByDay, customers, logins: Number(logins.n || 0) });
}));
app.get('/api/presence', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!_presCache.data || Date.now() - _presCache.at > 10e3) {
    const c = ST.presenceCounts();
    let hour = 0; try { hour = Number(((await q("SELECT count(DISTINCT supporter_id)::int AS c FROM user_events WHERE created_at > now() - interval '60 minutes' AND supporter_id IS NOT NULL")).rows[0] || {}).c || 0); } catch (e) { hour = 0; }
    const now = c.now + c.anon_now, hr = Math.max(hour, c.hour) + c.anon_hour;
    _presCache = { at: Date.now(), data: { now, hour: hr, total: now + hr } };
  }
  res.json(_presCache.data);
}));
app.post('/api/track', (req, res) => {
  try {
    const s = readCookie(req, USER_COOKIE); const b = req.body || {};
    if (!s || s.kind !== 'user' || !TRACK_TYPES.includes(b.type) || rateLimited('trk:' + s.sid, 900, 60e3)) return res.status(204).end();
    let meta = b.meta && typeof b.meta === 'object' ? b.meta : null; if (meta && JSON.stringify(meta).length > 1200) meta = null;
    if (b.type === 'ping') ST.ping(req, s.sid, { sid: b.sid, path: b.path }); else ST.track(req, s.sid, b.type, { sid: b.sid, path: b.path, label: b.label, meta });
  } catch (e) { /* ignoruj */ }
  res.status(204).end();
});
app.get('/vop', (req, res) => res.send(V.vopPage()));

// ── Prověření lokality (/location): veřejná prodejní stránka, Stripe Checkout, webhook, admin ──
// Stripe bez SDK (REST přes fetch). Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BS2_LOCATION_NOTIFY_EMAIL.
app.get('/location', (req, res) => { res.set('Cache-Control', 'no-cache'); res.send(LOC.locationPage(LAPP.LIMITS, LAPP.SEARCH_LIMITS)); });
// Ceník online produktů z app_settings (přepisuje výchozí ceny/limity za běhu)
async function loadPricing() { try { const r = await q('SELECT value FROM app_settings WHERE key=$1', [LADM.PRICING_KEY]); const p = JSON.parse((r.rows[0] || {}).value || 'null'); LADM.applyPricing(p || {}); return p; } catch (e) { console.warn('[bs2] ceník:', e.message); LADM.applyPricing({}); return null; } }
app.get('/location/vop', (req, res) => res.send(V.locVopPage()));
app.get('/location/gdpr', (req, res) => res.send(V.locGdprPage()));
const LT = require('./location-terms');
function stripeForm(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach((k) => { const key = prefix ? prefix + '[' + k + ']' : k; const v = obj[k]; if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? stripeForm(x, key + '[' + i + ']', out) : out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(x))));
    else if (typeof v === 'object') stripeForm(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v)); });
  return out.join('&');
}
async function stripePost(path, body) {
  const r = await fetch('https://api.stripe.com/v1/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: stripeForm(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Stripe ' + r.status + ': ' + ((j.error && j.error.message) || 'chyba'));
  return j;
}
const locBase = (req) => (process.env.BS2_BASE_URL || ((isHttps(req) ? 'https' : 'http') + '://' + req.get('host'))).replace(/\/+$/, '');
function locParse(b) {
  const t = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
  const name = t(b.name, 255), email = t(b.email, 255).toLowerCase(), phone = t(b.phone, 40).replace(/[^\d+ ()\/-]/g, ''), company = t(b.company, 255);
  const pkg = LOC.PACKAGES[b.variant] ? b.variant : 'basic';
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Vyplňte prosím jméno a e-mail.' };
  if (!b.terms) return { error: 'Před platbou je třeba souhlasit s obchodními podmínkami.' };
  if (!b.consent) return { error: 'Bez potvrzení informací o zpracování osobních údajů nemůžeme objednávku vyřídit.' };
  return { name, email, phone: phone || null, company: company || null, pkg, marketing: !!b.marketing };
}
app.get('/api/location/pay-config', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ stripe: !!process.env.STRIPE_SECRET_KEY, packages: Object.fromEntries(Object.entries(LOC.PACKAGES).map(([k, v]) => [k, v.amount / 100])) }); });
// Platba kartou: založí objednávku (pending) a vrátí URL Stripe Checkout.
app.post('/api/location/checkout', wrap(async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ ok: false, error: 'Online platba není dostupná.' });
  if (rateLimited('loc:' + req.ip, 10, 10 * 60e3)) return res.status(429).json({ ok: false, error: 'Příliš mnoho požadavků. Zkuste to prosím za chvíli.' });
  const d = locParse(req.body || {}); if (d.error) return res.status(400).json({ ok: false, error: d.error });
  const pkg = LOC.PACKAGES[d.pkg];
  const ins = await q('INSERT INTO location_orders (name,email,phone,company,package,amount_czk,status,consent,marketing,ip,terms_version) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10) RETURNING id',
    [d.name, d.email, d.phone, d.company, d.pkg, pkg.amount / 100, 'pending', d.marketing, String(req.ip || '').slice(0, 64), LT.TERMS_VERSION]);
  const oid = ins.rows[0].id; const base = locBase(req);
  notifyVelin('🌐 Nová online objednávka #' + oid, d.name + ' · balíček ' + d.pkg + ' · ' + (pkg.amount / 100) + ' Kč (čeká na platbu)', '/admin/online', 'order');
  const session = await stripePost('checkout/sessions', {
    mode: 'payment', customer_email: d.email, locale: 'cs',
    success_url: base + '/location?paid=1&s={CHECKOUT_SESSION_ID}#objednat', cancel_url: base + '/location?canceled=1#objednat',
    line_items: [{ quantity: 1, price_data: { currency: 'czk', unit_amount: pkg.amount, product_data: { name: pkg.name, description: pkg.desc } } }],
    metadata: { order_id: String(oid), package: d.pkg, source: 'bs2-location' },
    payment_intent_data: { description: pkg.name + ' – ' + d.name, metadata: { order_id: String(oid), package: d.pkg } },
    invoice_creation: { enabled: 'true' },
  });
  await q('UPDATE location_orders SET stripe_session=$1 WHERE id=$2', [session.id, oid]);
  console.log('[bs2] /location checkout #' + oid + ' ' + d.pkg + ' → ' + session.id);
  res.json({ ok: true, url: session.url });
}));
// Náhradní režim bez Stripe: žádost o objednávku (admin pošle platební údaje ručně).
app.post('/api/location/interest', wrap(async (req, res) => {
  if (rateLimited('loc:' + req.ip, 10, 10 * 60e3)) return res.status(429).json({ ok: false, error: 'Příliš mnoho požadavků. Zkuste to prosím za chvíli.' });
  const d = locParse(req.body || {}); if (d.error) return res.status(400).json({ ok: false, error: d.error });
  const pkg = LOC.PACKAGES[d.pkg];
  await q('INSERT INTO location_orders (name,email,phone,company,package,amount_czk,status,consent,marketing,ip,terms_version) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10)',
    [d.name, d.email, d.phone, d.company, d.pkg, pkg.amount / 100, 'request', d.marketing, String(req.ip || '').slice(0, 64), LT.TERMS_VERSION]);
  locNotify('Nová žádost o balíček ' + pkg.label + ' – ' + d.name, 'Žádost (bez online platby): ' + d.name + ', ' + d.email + (d.phone ? ', ' + d.phone : '') + '. Pošlete platební údaje a po úhradě předejte přístup.').catch(() => {});
  res.json({ ok: true });
}));
async function locNotify(subject, body) {
  notifyVelin('🌐 ' + subject, String(body || '').slice(0, 200), '/admin/online', 'order');
  // Admin e-maily jsou volitelné (jen když je nastavené BS2_LOCATION_NOTIFY_EMAIL); výchozí = jen notifikace do Velína výše
  const to = String(process.env.BS2_LOCATION_NOTIFY_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const t of to) { try { await sendBs2Mail({ to: t, subject: '[BS2] ' + subject, body, link: (process.env.BS2_BASE_URL || 'https://www.bestseries2.cz').replace(/\/+$/, '') + '/admin/location', linkLabel: 'Otevřít administraci' }); } catch (e) { console.warn('[bs2] location notify:', e.message); } }
}
// Stripe webhook: ověří podpis (raw body) a označí objednávku jako zaplacenou.
app.post('/api/location/stripe-webhook', wrap(async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    const sig = String(req.get('stripe-signature') || ''); const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=')).filter((a) => a.length === 2));
    if (!parts.t || !parts.v1) return res.status(400).send('Chybí podpis');
    const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + raw).digest('hex');
    const ok = expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
    if (!ok || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return res.status(400).send('Neplatný podpis');
  } else console.warn('[bs2] STRIPE_WEBHOOK_SECRET chybí — webhook bez ověření podpisu');
  let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).send('Bad JSON'); }
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const sess = (ev.data && ev.data.object) || {};
    if (!sess.payment_status || sess.payment_status === 'paid') {
      const oid = Number(sess.metadata && sess.metadata.order_id);
      const r = await q("UPDATE location_orders SET status=CASE WHEN status IN ('pending','request') THEN 'paid' ELSE status END, paid_at=COALESCE(paid_at, now()), stripe_session=COALESCE(stripe_session,$2), stripe_payment_intent=COALESCE($3, stripe_payment_intent), amount_czk=COALESCE($4, amount_czk) WHERE id=$1 OR stripe_session=$2 RETURNING *",
        [oid || 0, sess.id || null, typeof sess.payment_intent === 'string' ? sess.payment_intent : null, sess.amount_total != null ? Math.round(sess.amount_total / 100) : null]);
      const o = r.rows[0];
      if (o) {
        console.log('[bs2] /location ZAPLACENO #' + o.id + ' ' + o.package + ' ' + o.amount_czk + ' Kč');
        const pkg = LOC.PACKAGES[o.package] || LOC.EVAL_PACKS[o.package] || LOC.UPGRADE_PACKS[o.package] || {};
        holyosInvoice('online', { ref: o.id, currency: 'CZK', gross: true, paid_at: o.paid_at, customer: { name: o.company || o.name, email: o.email, phone: o.phone || null }, items: [{ description: (pkg.label || o.package) + ' — Best Series 2.0 online', quantity: 1, unit_price: Number(o.amount_czk) }] });
        try { await locGrantAccess(o, req); } catch (e) { console.error('[bs2] location grant:', e.message); }
        locNotify('Zaplaceno: ' + (pkg.label || o.package) + ' – ' + o.name, o.name + ' (' + o.email + (o.phone ? ', ' + o.phone : '') + ') zaplatil ' + o.amount_czk + ' Kč za balíček ' + (pkg.label || o.package) + '. Předejte přístup do aplikace a označte v administraci.').catch(() => {});
      }
    }
  }
  res.json({ received: true });
}));
// Zpřístupnění aplikace: účet typu 'location' (12 měsíců), aktivační e-mail, objednávka → granted.
async function locGrantAccess(o, req) {
  const base0 = (process.env.BS2_BASE_URL || 'https://www.bestseries2.cz').replace(/\/+$/, '');
  // Přechod na vyšší balíček: změnit balíček účtu (platnost zůstává, dokoupená vyhodnocení zůstávají)
  const upg = LOC.UPGRADE_PACKS[o.package];
  if (upg) {
    const u = o.supporter_id ? (await q('SELECT * FROM supporters WHERE id=$1', [o.supporter_id])).rows[0] : (await q('SELECT * FROM supporters WHERE email=$1', [o.email])).rows[0];
    if (!u) throw new Error('Účet pro přechod nenalezen (' + o.email + ')');
    if ((LOC.PKG_RANK[upg.to] || 0) > (LOC.PKG_RANK[u.location_package] || 0)) await q('UPDATE supporters SET location_package=$2, updated_at=now() WHERE id=$1', [u.id, upg.to]);
    await q("UPDATE location_orders SET supporter_id=$2, status='granted', access_granted_at=COALESCE(access_granted_at, now()) WHERE id=$1", [o.id, u.id]);
    const pl = LOC.PACKAGES[upg.to];
    await sendBs2Mail({ to: u.email, subject: 'Balíček ' + pl.label + ' je aktivní', body: 'Dobrý den, děkujeme za doplatek ' + Number(o.amount_czk).toLocaleString('cs-CZ') + ' Kč. Váš účet v aplikaci Prověření lokality má nyní balíček ' + pl.label + ' (' + pl.desc + '). Platnost přístupu se nemění. Doklad o platbě přijde samostatně ze Stripe.\n\nBest Series s.r.o.', link: base0 + '/lokalita', linkLabel: 'Otevřít aplikaci' }).catch((e) => console.warn('[bs2] upgrade mail:', e.message));
    if (upg.to === 'premium') locNotify('Přechod na Premium – ' + (u.first_name || '') + ' ' + (u.last_name || '') + ' (' + u.email + ')', 'Zákazník doplatil přechod na Premium. Domluvte místní šetření technikem a zapište termín v administraci.').catch(() => {});
    console.log('[bs2] /lokalita přechod na ' + upg.to + ': účet #' + u.id);
    return;
  }
  // Dokoupení vyhodnocení: jen připsat k účtu (balíček ani platnost se nemění)
  const ep = LOC.EVAL_PACKS[o.package];
  if (ep) {
    const u = o.supporter_id ? (await q('SELECT * FROM supporters WHERE id=$1', [o.supporter_id])).rows[0] : (await q('SELECT * FROM supporters WHERE email=$1', [o.email])).rows[0];
    if (!u) throw new Error('Účet pro dokoupení nenalezen (' + o.email + ')');
    const isSearch = !!ep.searches, n = ep.searches || ep.evals;
    await q(isSearch ? 'UPDATE supporters SET location_extra_searches=COALESCE(location_extra_searches,0)+$2, updated_at=now() WHERE id=$1' : 'UPDATE supporters SET location_extra_evals=COALESCE(location_extra_evals,0)+$2, updated_at=now() WHERE id=$1', [u.id, n]);
    await q("UPDATE location_orders SET supporter_id=$2, status='granted', access_granted_at=COALESCE(access_granted_at, now()) WHERE id=$1", [o.id, u.id]);
    await sendBs2Mail({ to: u.email, subject: 'Připsáno: ' + n + (isSearch ? ' vyhledání ve Vyhledávači míst' : ' vyhodnocení lokalit'), body: 'Dobrý den, děkujeme za platbu ' + Number(o.amount_czk).toLocaleString('cs-CZ') + ' Kč. K vašemu účtu v aplikaci Prověření lokality jsme připsali ' + n + (isSearch ? ' vyhledání navíc.' : ' vyhodnocení navíc.') + ' Doklad o platbě přijde samostatně ze Stripe.\n\nBest Series s.r.o.', link: base0 + (isSearch ? '/lokalita/analyza' : '/lokalita'), linkLabel: isSearch ? 'Otevřít Vyhledávač míst' : 'Otevřít Moje lokality' }).catch((e) => console.warn('[bs2] topup mail:', e.message));
    console.log('[bs2] /lokalita dokoupení připsáno: účet #' + u.id + ' +' + n + (isSearch ? ' vyhledání' : ' vyhodnocení'));
    return;
  }
  const pkg = LOC.PACKAGES[o.package] || LOC.PACKAGES.basic;
  const parts = String(o.name || '').trim().split(/\s+/); const first = parts.shift() || null, last = parts.join(' ') || null;
  let u = (await q('SELECT * FROM supporters WHERE email=$1', [o.email])).rows[0];
  if (!u) {
    u = (await q("INSERT INTO supporters (email, first_name, last_name, phone, status, user_type, source, location_package, location_expires_at) VALUES ($1,$2,$3,$4,'invited','location','location',$5, now() + interval '12 months') RETURNING *", [o.email, first, last, o.phone || null, o.package])).rows[0];
  } else {
    // existující účet (např. starý uživatel): typ ponechat, jen přidat balíček a platnost; typ 'new' povýšit na location
    u = (await q("UPDATE supporters SET location_package=$2, location_expires_at=GREATEST(COALESCE(location_expires_at, now()), now()) + interval '12 months', user_type=CASE WHEN user_type IN ('new') THEN 'location' ELSE user_type END, phone=COALESCE(phone,$3), updated_at=now() WHERE id=$1 RETURNING *", [u.id, o.package, o.phone || null])).rows[0];
  }
  await q("UPDATE location_orders SET supporter_id=$2, status='granted', access_granted_at=COALESCE(access_granted_at, now()) WHERE id=$1", [o.id, u.id]);
  const base = (process.env.BS2_BASE_URL || 'https://www.bestseries2.cz').replace(/\/+$/, '');
  const activated = !!u.password_hash;
  const body = 'Dobrý den, děkujeme za platbu ' + Number(o.amount_czk).toLocaleString('cs-CZ') + ' Kč za balíček ' + pkg.label + '.\n\n'
    + (activated ? 'Aplikace Prověření lokality je zpřístupněna ve vašem účtu Best Series 2.0 – po přihlášení ji najdete v záložce Moje lokality.' : 'Váš přístup je připraven. Aktivujte si účet: na stránce Aktivace zadejte tento e-mail (' + o.email + '), zvolte si nick a heslo.')
    + '\n\nPřístup platí 12 měsíců. Doklad o platbě přijde samostatně ze Stripe.\n\nBest Series s.r.o.';
  await sendBs2Mail({ to: o.email, subject: 'Přístup do aplikace Prověření lokality (' + pkg.label + ')', body, link: activated ? base + '/lokalita' : base + '/activate', linkLabel: activated ? 'Otevřít aplikaci' : 'Aktivovat účet' });
  console.log('[bs2] /location přístup předán: účet #' + u.id + ' ' + o.email);
}
async function requireLocation(req, res, next) {
  return requireUser(req, res, async () => {
    const u = req.user;
    if (!u.location_package) return res.status(403).send(V.errorPage('Bez přístupu', 'Aplikace Prověření lokality není součástí vašeho účtu.', '/'));
    if (u.location_expires_at && new Date(u.location_expires_at) < new Date()) return res.send(LAPP.expiredPage(u));
    next();
  });
}
// Limit vyhodnocení = balíček + dokoupená vyhodnocení (supporters.location_extra_evals)
const locLimit = (u) => (LAPP.LIMITS[u.location_package] || 3) + Number(u.location_extra_evals || 0);
const locSearchLimit = (u) => (LAPP.SEARCH_LIMITS[u.location_package] || 3) + Number(u.location_extra_searches || 0);
const locAreaNorm = (t) => { const m = String(t || '').trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/); if (m) return (+m[1]).toFixed(4) + ',' + (+m[2]).toFixed(4); return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
const locIsCoords = (t) => /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.test(String(t || '').trim());
// Špendlík v mapě → čitelný název místa (Nominatim reverse), např. „Praha 4 – Nusle, Křesomyslova"
async function locReverseLabel(area) {
  const m = String(area).trim().split(','); const lat = +m[0], lon = +m[1];
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&lat=' + lat + '&lon=' + lon, { headers: { 'User-Agent': 'BestSeries2/1.0 (+https://www.bestseries2.cz)', Accept: 'application/json', 'Accept-Language': 'cs' }, signal: AbortSignal.timeout(9000) });
    const j = await r.json().catch(() => ({})); const a = j.address || {};
    const town = a.city || a.town || a.village || a.municipality || a.county || ''; const part = a.suburb || a.neighbourhood || a.city_district || a.quarter || ''; const street = a.road || '';
    const label = [town, part && part !== town ? part : '', street].filter(Boolean).join(' – ');
    return (label || (j.display_name || '').split(',').slice(0, 2).join(',').trim() || null);
  } catch (e) { return null; }
}
async function locSearchUsed(uid) { return Number(((await q('SELECT count(*)::int AS c FROM location_searches WHERE supporter_id=$1', [uid])).rows[0] || {}).c || 0); }
const locPacks = (kind) => process.env.STRIPE_SECRET_KEY ? Object.fromEntries(Object.entries(LOC.EVAL_PACKS).filter(([, p]) => p[kind])) : {};
async function locInfo(u, msg) {
  const o = (await q("SELECT survey_date, survey_tech, survey_report FROM location_orders WHERE supporter_id=$1 AND package='premium' ORDER BY id DESC LIMIT 1", [u.id])).rows[0] || {};
  return { package: u.location_package, expires_at: u.location_expires_at, limit: locLimit(u), packs: locPacks('evals'), msg: msg || '', survey_date: o.survey_date, survey_tech: o.survey_tech, survey_report: o.survey_report };
}
// Dokoupení vyhodnocení: objednávka vázaná na účet → Stripe Checkout → webhook připíše vyhodnocení (locGrantAccess)
app.post('/lokalita/dokoupit', wrap(requireLocation), wrap(async (req, res) => {
  const key = String((req.body || {}).pack || ''); let pk = LOC.EVAL_PACKS[key];
  if (!(req.body || {}).terms) return res.redirect((LOC.UPGRADE_PACKS[key] ? '/lokalita/balicek' : LOC.EVAL_PACKS[key] && LOC.EVAL_PACKS[key].searches ? '/lokalita/analyza' : '/lokalita') + '?msg=' + encodeURIComponent('Před platbou je třeba zaškrtnout souhlas s obchodními podmínkami.'));
  const up = LOC.UPGRADE_PACKS[key];
  if (up) {
    // přechod na vyšší balíček: doplatek = cena cílového − cena stávajícího balíčku
    const cur = req.user.location_package || 'basic';
    if ((LOC.PKG_RANK[up.to] || 0) <= (LOC.PKG_RANK[cur] || 0)) return res.redirect('/lokalita/balicek?msg=' + encodeURIComponent('Tento balíček už máte nebo máte vyšší.'));
    const diff = LADM.testMode() ? LADM.TEST_AMOUNT : LOC.PACKAGES[up.to].amount - (LOC.PACKAGES[cur] ? LOC.PACKAGES[cur].amount : 0);
    if (diff <= 0) return res.redirect('/lokalita/balicek');
    pk = { name: up.name, desc: up.desc + ' (' + (LOC.PACKAGES[cur] || {}).label + ' → ' + LOC.PACKAGES[up.to].label + ')', amount: diff, upgrade: true };
  }
  if (!pk) return res.redirect('/lokalita?msg=' + encodeURIComponent('Neznámý balíček.'));
  if (!process.env.STRIPE_SECRET_KEY) return res.redirect('/lokalita?msg=' + encodeURIComponent('Online platba momentálně není dostupná – napište nám přes Podporu.'));
  if (rateLimited('loctop:' + req.user.id, 10, 10 * 60e3)) return res.redirect('/lokalita?msg=' + encodeURIComponent('Příliš mnoho požadavků, zkuste to za chvíli.'));
  const u = req.user, name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.nick || u.email;
  const oid = (await q('INSERT INTO location_orders (name,email,phone,package,amount_czk,status,consent,marketing,ip,supporter_id,terms_version) VALUES ($1,$2,$3,$4,$5,$6,true,false,$7,$8,$9) RETURNING id',
    [name, u.email, u.phone || null, key, pk.amount / 100, 'pending', String(req.ip || '').slice(0, 64), u.id, LT.TERMS_VERSION])).rows[0].id;
  notifyVelin('🌐 Nová online objednávka #' + oid, name + ' · balíček ' + key + ' · ' + (pk.amount / 100) + ' Kč (čeká na platbu)', '/admin/online', 'order');
  const base = locBase(req);
  const session = await stripePost('checkout/sessions', {
    mode: 'payment', customer_email: u.email, locale: 'cs',
    success_url: base + (pk.upgrade ? '/lokalita/balicek' : pk.searches ? '/lokalita/analyza' : '/lokalita') + '?topup=1', cancel_url: base + (pk.upgrade ? '/lokalita/balicek' : pk.searches ? '/lokalita/analyza' : '/lokalita') + '?topup=0',
    line_items: [{ quantity: 1, price_data: { currency: 'czk', unit_amount: pk.amount, product_data: { name: pk.name, description: pk.desc } } }],
    metadata: { order_id: String(oid), package: key, source: 'bs2-location-topup', supporter_id: String(u.id) },
    payment_intent_data: { description: pk.name + ' – ' + name, metadata: { order_id: String(oid), package: key } },
    invoice_creation: { enabled: 'true' },
  });
  await q('UPDATE location_orders SET stripe_session=$1 WHERE id=$2', [session.id, oid]);
  console.log('[bs2] /lokalita dokoupení #' + oid + ' ' + key + ' účet #' + u.id + ' → ' + session.id);
  res.redirect(303, session.url);
}));
app.get('/lokalita', wrap(requireLocation), wrap(async (req, res) => {
  const sites = (await q('SELECT id, name, address, city, calc, result, evaluated_at, study_status, study_error, (study IS NOT NULL) AS has_study FROM location_sites WHERE supporter_id=$1 ORDER BY created_at', [req.user.id])).rows;
  const msg = req.query.topup === '1' ? 'Platba přijata – dokoupená vyhodnocení se připisují k účtu (obvykle do minuty, případně obnovte stránku).' : req.query.topup === '0' ? 'Platba byla zrušena, nic nebylo účtováno.' : req.query.msg;
  const info = await locInfo(req.user, msg); info.used = await locUsed(req.user.id); info.evaluating = Number(req.query.evaluating) || 0;
  res.send(LAPP.listPage(req.user, sites, info));
}));
// Můj balíček: přehled + přechod na vyšší balíček doplatkem rozdílu přes Stripe
app.get('/lokalita/balicek', wrap(requireLocation), wrap(async (req, res) => {
  const u = req.user; const cur = u.location_package || 'basic';
  const msg = req.query.topup === '1' ? 'Platba přijata – balíček se aktivuje během chvíle (případně obnovte stránku).' : req.query.topup === '0' ? 'Platba byla zrušena, nic nebylo účtováno.' : (req.query.msg || '');
  const used = await locUsed(u.id), sUsed = await locSearchUsed(u.id);
  const upgrades = Object.entries(LOC.UPGRADE_PACKS).filter(([, x]) => (LOC.PKG_RANK[x.to] || 0) > (LOC.PKG_RANK[cur] || 0)).map(([k, x]) => ({ key: k, to: x.to, label: LOC.PACKAGES[x.to].label, desc: LOC.PACKAGES[x.to].desc, full: LOC.PACKAGES[x.to].amount / 100, diff: (LOC.PACKAGES[x.to].amount - (LOC.PACKAGES[cur] ? LOC.PACKAGES[cur].amount : 0)) / 100 }));
  res.send(LAPP.packagePage(u, { current: cur, label: (LOC.PACKAGES[cur] || {}).label || cur, desc: (LOC.PACKAGES[cur] || {}).desc || '', expires_at: u.location_expires_at, used, limit: locLimit(u), sUsed, sLimit: locSearchLimit(u), extraEvals: Number(u.location_extra_evals || 0), extraSearches: Number(u.location_extra_searches || 0), upgrades, stripe: !!process.env.STRIPE_SECRET_KEY, msg }));
}));
app.get('/lokalita/checklist', wrap(requireLocation), (req, res) => res.send(LAPP.checklistPage(req.user)));
app.get('/lokalita/analyza', wrap(requireLocation), wrap(async (req, res) => {
  const u = req.user;
  const credits = { used: await locSearchUsed(u.id), limit: locSearchLimit(u), base: LAPP.SEARCH_LIMITS[u.location_package] || 3, packs: locPacks('searches') };
  credits.saved = (await q('SELECT area, label, created_at, (candidates IS NOT NULL) AS has_cands, (SELECT count(*) FROM jsonb_object_keys(contacts)) AS n_contacts FROM location_searches WHERE supporter_id=$1 ORDER BY updated_at DESC', [u.id])).rows;
  // Otevření uloženého vyhledávání: výsledek jde rovnou do stránky, nic se znovu neanalyzuje
  const qq = String(req.query.q || '').trim().slice(0, 80);
  if (qq.length >= 2) { const cur = (await q('SELECT result, candidates, contacts, label FROM location_searches WHERE supporter_id=$1 AND area_norm=$2', [u.id, locAreaNorm(qq)])).rows[0]; if (cur && cur.result) credits.current = { result: Object.assign({}, cur.result, { label: cur.label || null }), candidates: cur.candidates, contacts: cur.contacts || {} }; }
  const msg = req.query.topup === '1' ? 'Platba přijata – dokoupená vyhledání se připisují k účtu (obvykle do minuty, případně obnovte stránku).' : req.query.topup === '0' ? 'Platba byla zrušena, nic nebylo účtováno.' : String(req.query.msg || '').slice(0, 200);
  res.send(LAPP.analyzerPage(u, String(req.query.q || '').slice(0, 80), credits, msg));
}));
// Proxy na veřejné API HolyOS (spádová oblast, provozované prádlomaty) — jen pro přihlášené zákazníky aplikace
async function holyosPublic(path) { try { const r = await fetch(HOLYOS_URL + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; } catch (e) { return { ok: false, status: 502, j: { error: 'Analýza momentálně není dostupná, zkuste to prosím později.' } }; } }
app.get('/api/location/area', wrap(requireLocation), wrap(async (req, res) => {
  const area = String(req.query.area || '').trim().slice(0, 80); if (area.length < 2) return res.status(400).json({ error: 'Zadejte město.' });
  if (rateLimited('area:' + req.user.id, 40, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho analýz, zkuste to za chvíli.' });
  // Kredity: nové město = 1 vyhledání; již hledané město je zdarma
  const norm = locAreaNorm(area), limit = locSearchLimit(req.user);
  const row = (await q('SELECT id, result, label FROM location_searches WHERE supporter_id=$1 AND area_norm=$2', [req.user.id, norm])).rows[0];
  let used = await locSearchUsed(req.user.id);
  // Uložené vyhledávání → vrátit rovnou (zákazník se k výsledku vrací bez dalšího kreditu i bez čekání)
  if (row && row.result && req.query.refresh !== '1') return res.json(Object.assign({}, row.result, { credits: { used, limit }, saved: true, label: row.label || null }));
  if (!row && used >= limit) return res.status(402).json({ error: 'Vyhledání v balíčku jsou vyčerpána (' + used + ' / ' + limit + ').', buy: true, credits: { used, limit } });
  const r = await holyosPublic('/api/pradlomat-spots/public/area-analysis?area=' + encodeURIComponent(area) + '&radius_km=15');
  let label = null;
  if (r.ok && r.j && typeof r.j === 'object') {
    if (locIsCoords(area)) label = (await locReverseLabel(area)) || ('Špendlík ' + area);
    await q('INSERT INTO location_searches (supporter_id, area_norm, area, result, label) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (supporter_id, area_norm) DO UPDATE SET result=EXCLUDED.result, label=COALESCE(EXCLUDED.label, location_searches.label), updated_at=now()', [req.user.id, norm, area, JSON.stringify(r.j), label]);
    used = await locSearchUsed(req.user.id);
  }
  res.status(r.ok ? 200 : (r.status || 502)).json(r.ok && r.j && typeof r.j === 'object' ? Object.assign({}, r.j, { credits: { used, limit }, label }) : r.j);
}));
// Geokódování adresy (Nominatim, server-side, limit 1 req/s per Nominatim pravidla → rate-limit per uživatel)
app.get('/api/location/geocode', wrap(requireLocation), wrap(async (req, res) => {
  const addr = String(req.query.address || req.query.q || '').trim().slice(0, 200), city = String(req.query.city || '').trim().slice(0, 100);
  if (addr.length < 2 && city.length < 2) return res.status(400).json({ error: 'Zadejte adresu.' });
  if (rateLimited('geo:' + req.user.id, 60, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho dotazů, zkuste to za chvíli.' });
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // 1) RÚIAN (ČÚZK) – přesná adresní místa v ČR včetně č.p. bez ulice. Kandidáty seřadíme: adresní místo + shoda obce nahoru.
  try {
    const q1 = [addr, city].filter(Boolean).join(', ');
    const r = await fetch('https://ags.cuzk.cz/arcgis/rest/services/RUIAN/Vyhledavaci_sluzba_nad_daty_RUIAN/MapServer/exts/GeocodeSOE/findAddressCandidates?outSR=4326&maxLocations=10&f=json&SingleLine=' + encodeURIComponent(q1), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    const j = await r.json().catch(() => ({}));
    let cands = Array.isArray(j.candidates) ? j.candidates : [];
    if (cands.length) {
      const cn = norm(city);
      const score = (c) => ((c.attributes && c.attributes.Type) === 'AdresniMisto' ? 2 : 0) + (cn && norm(c.address).includes(cn) ? 4 : 0) + (cn && norm(c.address).endsWith(cn) ? 1 : 0);
      cands = cands.map((c) => ({ lat: c.location.y, lon: c.location.x, display_name: c.address, type: (c.attributes && c.attributes.Type) || '', s: score(c) })).sort((a, b) => b.s - a.s).slice(0, 8);
      const best = cands[0];
      return res.json({ lat: best.lat, lon: best.lon, display_name: best.display_name, level: 'exact', source: 'RÚIAN', candidates: cands.map(({ lat, lon, display_name }) => ({ lat, lon, display_name })) });
    }
  } catch (e) { /* RÚIAN nedostupný → Nominatim */ }
  // 2) Nominatim – záloha (SK, cizí adresy) + obec
  const H = { 'User-Agent': 'BestSeries2/1.0 (+https://www.bestseries2.cz)', Accept: 'application/json', 'Accept-Language': 'cs' };
  async function nom(params) { try { const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,sk&' + params, { headers: H, signal: AbortSignal.timeout(9000) }); const j = await r.json().catch(() => []); return Array.isArray(j) && j.length ? j[0] : null; } catch (e) { return null; } }
  const tries = [];
  if (addr) tries.push(['exact', 'q=' + encodeURIComponent([addr, city].filter(Boolean).join(', '))]);
  if (city) tries.push(['town', 'city=' + encodeURIComponent(city)]);
  for (const [level, params] of tries) { const x = await nom(params); if (x) return res.json({ lat: parseFloat(x.lat), lon: parseFloat(x.lon), display_name: x.display_name, level, source: 'OSM' }); await new Promise((r) => setTimeout(r, 1100)); }
  res.json({ error: 'Adresa nenalezena – přibližte mapu a klikněte na místo ručně.' });
}));
// Místa, kde by prádlomat mohl stát (HolyOS finder). Nestojí další kredit – jen pro město, které už bylo analyzováno.
app.get('/api/location/candidates', wrap(requireLocation), wrap(async (req, res) => {
  const area = String(req.query.area || '').trim().slice(0, 80); if (area.length < 2) return res.status(400).json({ error: 'Zadejte město.' });
  const row = (await q('SELECT id, candidates, contacts FROM location_searches WHERE supporter_id=$1 AND area_norm=$2', [req.user.id, locAreaNorm(area)])).rows[0];
  if (!row) return res.status(402).json({ error: 'Nejdřív spusťte analýzu města.' });
  if (row.candidates && req.query.refresh !== '1') return res.json(Object.assign({}, row.candidates, { contacts: row.contacts || {}, saved: true }));
  if (rateLimited('cand:' + req.user.id, 40, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho dotazů, zkuste to za chvíli.' });
  const r = await holyosPublic('/api/pradlomat-spots/public/candidates?area=' + encodeURIComponent(area));
  if (r.ok && r.j && Array.isArray(r.j.candidates)) await q('UPDATE location_searches SET candidates=$2, updated_at=now() WHERE id=$1', [row.id, JSON.stringify(r.j)]);
  res.status(r.ok ? 200 : (r.status || 502)).json(r.ok && r.j && typeof r.j === 'object' ? Object.assign({}, r.j, { contacts: row.contacts || {} }) : r.j);
}));
// AI dohledání kontaktu na provozovatele místa (HolyOS → Claude web search). Limit 30/h na účet.
app.get('/api/location/contact', wrap(requireLocation), wrap(async (req, res) => {
  const name = String(req.query.name || '').trim().slice(0, 120); if (name.length < 2) return res.status(400).json({ error: 'Chybí název místa.' });
  if (rateLimited('contact:' + req.user.id, 30, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho dotazů, zkuste to za chvíli.' });
  const qs = ['name', 'city', 'lat', 'lon', 'kind', 'address'].filter((k) => req.query[k]).map((k) => k + '=' + encodeURIComponent(String(req.query[k]).slice(0, 200))).join('&');
  const r = await holyosPublic('/api/pradlomat-spots/public/contact?' + qs);
  if (r.ok && r.j && typeof r.j === 'object' && req.query.city && isFinite(+req.query.lat) && isFinite(+req.query.lon)) {
    const key = (+req.query.lat).toFixed(5) + ',' + (+req.query.lon).toFixed(5);
    await q('UPDATE location_searches SET contacts = COALESCE(contacts, \'{}\'::jsonb) || jsonb_build_object($3::text, $4::jsonb), updated_at=now() WHERE supporter_id=$1 AND area_norm=$2', [req.user.id, locAreaNorm(String(req.query.city)), key, JSON.stringify(r.j)]).catch((e) => console.warn('[bs2] contact save:', e.message));
  }
  res.status(r.ok ? 200 : (r.status || 502)).json(r.j);
}));
app.get('/api/location/existing', wrap(requireLocation), wrap(async (req, res) => { const r = await holyosPublic('/api/pradlomat-spots/public/existing-laundromats'); res.json(r.ok && Array.isArray(r.j) ? r.j : []); }));
// Případové studie: 3 anonymizované lokality s živými daty ze SIS (přes HolyOS public API), cache 1 h
let _caseStudies = { at: 0, data: null };
app.get('/lokalita/studie', wrap(requireLocation), wrap(async (req, res) => {
  if (!isAllowedAdmin(req.user)) return res.redirect('/lokalita'); // stránka vypnuta pro zákazníky (jen správce pro kontrolu dat)
  if (!_caseStudies.data || Date.now() - _caseStudies.at > 3600e3) {
    const r = await holyosPublic('/api/pradlomat-spots/public/case-studies');
    if (r.ok && r.j && Array.isArray(r.j.studies)) _caseStudies = { at: Date.now(), data: r.j };
  }
  // Investice = prádlomat z nabídky Best Series 2.0 (cena + obrázek): k verzi stroje (V2/V3) se přiřadí nabízený produkt
  // podle názvu (obsahuje V2/V3), jinak nejbližší cenou k ceníkové ceně verze. Návratnost se přepočítá z této ceny.
  let data = _caseStudies.data;
  if (data && Array.isArray(data.studies)) {
    try {
      const out = await loadProducts(); const set = await offeredSet();
      const prods = (out.items || []).filter((p) => set.has(p.id) && p.price_czk > 0);
      const productImg = (p) => p && p.image_ext ? '/img/product/' + p.id + '?v=' + encodeURIComponent(p.image_updated_at ? new Date(p.image_updated_at).getTime() : '') : null;
      data = Object.assign({}, data, { studies: data.studies.map((x) => {
        const ver = String(x.machine_version || '').toUpperCase();
        let p = prods.find((q0) => new RegExp('\\b' + ver + '\\b', 'i').test(q0.name_cs || q0.name || ''));
        if (!p && x.machine_price_czk) p = prods.slice().sort((a, b) => Math.abs(a.price_czk - x.machine_price_czk) - Math.abs(b.price_czk - x.machine_price_czk))[0];
        if (!p) return x;
        const price = Number(p.price_czk), op = Number(x.operating_month || 0);
        return Object.assign({}, x, { product: { id: p.id, name: p.name_cs || p.name, price_czk: price, img: productImg(p) }, machine_price_czk: price, payback_years: op > 0 ? Math.round(price / (op * 12) * 10) / 10 : null, roi_pct: op > 0 ? Math.round(op * 12 / price * 1000) / 10 : null });
      }) });
    } catch (e) { console.warn('[bs2] studie produkty:', e.message); }
  }
  res.send(LAPP.studiesPage(req.user, data));
}));
app.get('/lokalita/new', wrap(requireLocation), wrap(async (req, res) => {
  const pre = { city: String(req.query.city || '').slice(0, 120), address: String(req.query.address || '').slice(0, 300) };
  if (isFinite(+req.query.lat) && isFinite(+req.query.lng) && +req.query.lat) { pre.lat = String(+req.query.lat); pre.lng = String(+req.query.lng); if (pre.address) pre.name = pre.address; } // předvyplnění z Vyhledávače míst
  res.send(LAPP.siteForm(req.user, null, pre, '', false, false, await locProducts()));
}));
// Nabídka prádlomatů pro výběr v lokalitě = stroje nabízené v BS2 (Produkty → nabízet), cena bez DPH
async function locProducts() {
  try { const out = await loadProducts(); const set = await offeredSet(); return (out.items || []).filter((p) => set.has(p.id)).map((p) => ({ id: p.id, name: p.name_cs || p.name, price_czk: p.price_czk })); } catch (e) { return []; }
}
async function locUsed(uid) { return Number(((await q('SELECT count(*)::int AS c FROM location_sites WHERE supporter_id=$1 AND evaluated_at IS NOT NULL', [uid])).rows[0] || {}).c || 0); }
// Uložit = jen data (koncept). Vyhodnotit = data + výpočet + report; první vyhodnocení adresy odečte lokalitu z balíčku.
async function locSave(req, res, site) {
  const d = LAPP.clean(req.body || {});
  if (!d.name || !d.address) return res.status(400).send(LAPP.siteForm(req.user, site, d, 'Vyplňte název a adresu lokality.', false, false, await locProducts()));
  const mode = String(req.body.goto || 'save'); // 'save' | 'form' | 'eval'
  const evalNow = mode === 'eval' && !(site && site.evaluated_at); // každá lokalita jen jednou
  let c = null, ev = null, calcSummary = null, result = null;
  if (evalNow) {
    c = LAPP.calc(d); ev = LAPP.evaluate(d, c);
    calcSummary = { mid_operating: c.S.mid.operating, mid_cash: c.S.mid.cash, weak_cash: c.S.weak.cash, strong_cash: c.S.strong.cash, be_operating: c.be_operating, be_cash: c.be_cash, invest: c.invest, payment: c.payment };
    result = { result: ev.result, cls: ev.cls, at: new Date().toISOString() };
    const alreadyEvaluated = !!(site && site.evaluated_at);
    if (!alreadyEvaluated) {
      const used = await locUsed(req.user.id), limit = locLimit(req.user);
      if (used >= limit) {
        // uložit data, ale nevyhodnocovat
        if (site) await q('UPDATE location_sites SET name=$2, address=$3, city=$4, data=$5, updated_at=now() WHERE id=$1 AND supporter_id=$6', [site.id, d.name, d.address, d.city || null, JSON.stringify(d), req.user.id]);
        else site = { id: (await q('INSERT INTO location_sites (supporter_id, name, address, city, data) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, d.name, d.address, d.city || null, JSON.stringify(d)])).rows[0].id };
        return res.redirect('/lokalita/' + site.id + '?saved=1&limit=1');
      }
    }
  }
  let id;
  if (site) {
    await q('UPDATE location_sites SET name=$2, address=$3, city=$4, data=$5, calc=COALESCE($6, calc), result=COALESCE($7, result), evaluated_at=CASE WHEN $9 THEN COALESCE(evaluated_at, now()) ELSE evaluated_at END, updated_at=now() WHERE id=$1 AND supporter_id=$8',
      [site.id, d.name, d.address, d.city || null, JSON.stringify(d), calcSummary ? JSON.stringify(calcSummary) : null, result ? JSON.stringify(result) : null, req.user.id, evalNow]);
    id = site.id;
  } else {
    id = (await q('INSERT INTO location_sites (supporter_id, name, address, city, data, calc, result, evaluated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [req.user.id, d.name, d.address, d.city || null, JSON.stringify(d), calcSummary ? JSON.stringify(calcSummary) : null, result ? JSON.stringify(result) : null, evalNow ? new Date() : null])).rows[0].id;
  }
  if (evalNow) {
    // AI studie běží na pozadí; zákazník vidí obrazovku „zpracováváme (cca 15 min)" a v seznamu běžící kolečko
    await locStartStudy(id, req.user);
    return res.redirect('/lokalita?evaluating=' + id);
  }
  return res.redirect('/lokalita/' + id + '?saved=1' + (mode === 'form' ? '#najem' : ''));
}
app.post('/lokalita/new', wrap(requireLocation), wrap(async (req, res) => locSave(req, res, null)));
// Spuštění AI studie na pozadí (jedna lokalita = jedno vyhodnocení). Po dokončení e-mail zákazníkovi.
const locStudyRunning = new Set();
async function locStartStudy(id, user) {
  if (locStudyRunning.has(id)) return;
  await q("UPDATE location_sites SET study_status='running', study_error=NULL WHERE id=$1", [id]);
  locStudyRunning.add(id);
  const base = (process.env.BS2_BASE_URL || 'https://www.bestseries2.cz').replace(/\/+$/, '');
  (async () => {
    const site = (await q('SELECT * FROM location_sites WHERE id=$1', [id])).rows[0];
    const d = site.data || {}; const c = LAPP.calc(d), ev = LAPP.evaluate(d, c);
    try {
      const study = await locBuildStudy(site, d, c, ev);
      await q("UPDATE location_sites SET study=$2, study_at=now(), study_status='done', study_error=NULL WHERE id=$1", [id, JSON.stringify(study)]);
      console.log('[bs2] studie hotova #' + id);
      if (user && user.email) sendBs2Mail({ to: user.email, subject: 'Studie lokality „' + site.name + '" je hotová', body: 'Dobrý den, vyhodnocení lokality „' + site.name + '" je dokončené. Studii s hodnocením, spádovostí, odhadem poptávky a ekonomickými scénáři najdete v aplikaci.\n\nBest Series s.r.o.', link: base + '/lokalita/' + id + '/studie', linkLabel: 'Otevřít studii' }).catch((e) => console.warn('[bs2] studie mail:', e.message));
    } catch (e) {
      console.error('[bs2] studie #' + id + ':', e.message);
      await q("UPDATE location_sites SET study_status='error', study_error=$2 WHERE id=$1", [id, String(e.message || e).slice(0, 500)]).catch(() => {});
    } finally { locStudyRunning.delete(id); }
  })();
}
app.get('/api/location/sites-status', wrap(requireLocation), wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = (await q('SELECT id, study_status FROM location_sites WHERE supporter_id=$1 AND evaluated_at IS NOT NULL', [req.user.id])).rows;
  res.json(rows.map((r) => ({ id: r.id, status: r.study_status || 'done' })));
}));
async function locSite(req) { return (await q('SELECT * FROM location_sites WHERE id=$1 AND supporter_id=$2', [parseInt(req.params.id, 10), req.user.id])).rows[0]; }
app.get('/lokalita/:id(\\d+)', wrap(requireLocation), wrap(async (req, res) => { const site = await locSite(req); if (!site) return res.redirect('/lokalita'); const dd = Object.assign({}, site.data || {}); if (req.query.ai === '1' && site.study && site.study.demand && site.study.demand.washes_per_day) { const w = site.study.demand.washes_per_day; if (w.weak) dd.washes_weak = String(w.weak); if (w.mid) dd.washes_mid = String(w.mid); if (w.strong) dd.washes_strong = String(w.strong); }
  res.send(LAPP.siteForm(req.user, site, dd, req.query.limit === '1' ? 'Uloženo, ale vyhodnocení neproběhlo: vyhodnocení v balíčku jsou vyčerpána. Dokoupit je můžete v Moje lokality.' : '', req.query.saved === '1', req.query.noeval === '1', await locProducts())); }));
app.post('/lokalita/:id(\\d+)', wrap(requireLocation), wrap(async (req, res) => { const site = await locSite(req); if (!site) return res.redirect('/lokalita'); return locSave(req, res, site); }));
app.get('/lokalita/:id(\\d+)/report', wrap(requireLocation), wrap(async (req, res) => { const site = await locSite(req); if (!site) return res.redirect('/lokalita'); if (!site.evaluated_at) return res.redirect('/lokalita/' + site.id + '?noeval=1'); if (site.study_status === 'running') return res.redirect('/lokalita?evaluating=' + site.id); const d = site.data || {}; const c = LAPP.calc(d); res.send(LAPP.reportPage(req.user, site, d, c, LAPP.evaluate(d, c), req.query.study_err ? String(req.query.study_err).slice(0, 300) : '')); }));
async function locBuildStudy(site, d, c, ev) {
  // Spádová oblast: přesně kolem prádlomatu (lat,lng); když HolyOS souřadnice nezpracuje nebo nevrátí obce, zkusit město
  let area = null;
  try { const r = await holyosPublic('/api/pradlomat-spots/public/area-analysis?area=' + encodeURIComponent(d.lat + ',' + d.lng) + '&radius_km=15'); if (r.ok && r.j && (r.j.places || []).length) area = r.j; } catch (e) { area = null; }
  if (!area) { try { const r2 = await holyosPublic('/api/pradlomat-spots/public/area-analysis?area=' + encodeURIComponent((d.city || d.address || '').trim()) + '&radius_km=15'); if (r2.ok && r2.j && !r2.j.error) area = r2.j; } catch (e) { /* bez spádové oblasti */ } }
  const study = await LSTUDY.runStudy({ site, d, c, ev, area });
  // Scénáře kalkulace = odhad AI (zákazníků/den slabý/střední/silný; 1 zákazník = 1 praní vč. sušení), aby studie a ekonomika korespondovaly
  const w = study && study.demand && (study.demand.customers_per_day || study.demand.washes_per_day);
  if (w && Number(w.weak) > 0 && Number(w.mid) > 0 && Number(w.strong) > 0) {
    const nd = Object.assign({}, d, { washes_weak: String(Math.round(Number(w.weak) * 10) / 10), washes_mid: String(Math.round(Number(w.mid) * 10) / 10), washes_strong: String(Math.round(Number(w.strong) * 10) / 10) });
    const nc = LAPP.calc(nd), nev = LAPP.evaluate(nd, nc);
    const calcSummary = { mid_operating: nc.S.mid.operating, mid_cash: nc.S.mid.cash, weak_cash: nc.S.weak.cash, strong_cash: nc.S.strong.cash, be_operating: nc.be_operating, be_cash: nc.be_cash, invest: nc.invest, payment: nc.payment };
    await q('UPDATE location_sites SET data=$2, calc=$3, result=$4, updated_at=now() WHERE id=$1', [site.id, JSON.stringify(nd), JSON.stringify(calcSummary), JSON.stringify({ result: nev.result, cls: nev.cls, at: new Date().toISOString() })]);
    study._applied_washes = { weak: nd.washes_weak, mid: nd.washes_mid, strong: nd.washes_strong };
  }
  return study;
}
// AI studie lokality: sběr OSM + spádová oblast + Claude → uloží se k lokalitě
app.post('/lokalita/:id(\\d+)/studie', wrap(requireLocation), wrap(async (req, res) => {
  const site = await locSite(req); if (!site) return res.redirect('/lokalita');
  if (!site.evaluated_at) return res.redirect('/lokalita/' + site.id + '?noeval=1');
  // Každá lokalita se vyhodnocuje jen jednou; znovu jen po chybě nebo pro správce (Tomáš/Jan)
  if (site.study && site.study_status !== 'error' && !isAllowedAdmin(req.user)) return res.redirect('/lokalita/' + site.id + '/studie');
  if (site.study_status === 'running') return res.redirect('/lokalita?evaluating=' + site.id);
  if (rateLimited('study:' + req.user.id, 6, 3600e3)) return res.redirect('/lokalita?msg=' + encodeURIComponent('Příliš mnoho studií za hodinu, zkuste to později.'));
  await locStartStudy(site.id, req.user);
  res.redirect('/lokalita?evaluating=' + site.id);
}));
app.get('/lokalita/:id(\\d+)/studie', wrap(requireLocation), wrap(async (req, res) => { const site = await locSite(req); if (!site) return res.redirect('/lokalita'); if (!site.study && site.study_status === 'running') return res.redirect('/lokalita?evaluating=' + site.id); if (!site.study) return res.redirect('/lokalita/' + site.id + '/report'); site.can_refresh = isAllowedAdmin(req.user); const d = Object.assign({}, site.data || {});
  // Ekonomické scénáře ve studii vždy odpovídají odhadu poptávky (zákazníků/den slabý/střední/silný)
  const cd = site.study && site.study.demand && (site.study.demand.customers_per_day || site.study.demand.washes_per_day);
  if (cd && Number(cd.weak) > 0 && Number(cd.mid) > 0 && Number(cd.strong) > 0) { d.washes_weak = String(cd.weak); d.washes_mid = String(cd.mid); d.washes_strong = String(cd.strong); if (!site.study._applied_washes) site.study._applied_washes = { weak: d.washes_weak, mid: d.washes_mid, strong: d.washes_strong }; }
  const c = LAPP.calc(d), ev = LAPP.evaluate(d, c); res.send(LSTUDY.studyPage(req.user, site, site.study, LAPP.NAV(req.user), LAPP.reportSections(site, d, c, ev), (d.lat && d.lng) ? { lat: +d.lat, lng: +d.lng } : null, d)); }));
app.get('/lokalita/:id(\\d+)/studie/tisk', wrap(requireLocation), wrap(async (req, res) => { const site = await locSite(req); if (!site) return res.redirect('/lokalita'); if (!site.study) return res.redirect('/lokalita/' + site.id + '/report'); const d = Object.assign({}, site.data || {});
  // Ekonomické scénáře ve studii vždy odpovídají odhadu poptávky (zákazníků/den slabý/střední/silný)
  const cd = site.study && site.study.demand && (site.study.demand.customers_per_day || site.study.demand.washes_per_day);
  if (cd && Number(cd.weak) > 0 && Number(cd.mid) > 0 && Number(cd.strong) > 0) { d.washes_weak = String(cd.weak); d.washes_mid = String(cd.mid); d.washes_strong = String(cd.strong); if (!site.study._applied_washes) site.study._applied_washes = { weak: d.washes_weak, mid: d.washes_mid, strong: d.washes_strong }; }
  const c = LAPP.calc(d), ev = LAPP.evaluate(d, c); res.send(LSTUDY.studyPrintPage(req.user, site, site.study, LAPP.reportSections(site, d, c, ev), (d.lat && d.lng) ? { lat: +d.lat, lng: +d.lng } : null, d)); }));
app.post('/lokalita/:id(\\d+)/delete', wrap(requireLocation), wrap(async (req, res) => { await q('DELETE FROM location_sites WHERE id=$1 AND supporter_id=$2', [parseInt(req.params.id, 10), req.user.id]); res.redirect('/lokalita?msg=' + encodeURIComponent('Lokalita smazána.')); }));
// Admin: objednávky balíčků
// ── Online produkty (admin): přehled, objednávky, zákazníci, ceník ──
app.get('/admin/online', requireAdmin, wrap(async (req, res) => {
  const tab = String(req.query.tab || ''), msg = String(req.query.msg || '');
  if (tab === 'orders') return res.redirect('/admin/location' + (req.query.status ? '?status=' + encodeURIComponent(req.query.status) : ''));
  if (tab === 'customers') {
    const qq = String(req.query.q || '').trim().slice(0, 80);
    const rows = (await q(`SELECT s.id, s.email, s.nick, s.first_name, s.last_name, s.phone, s.status, s.location_package, s.location_expires_at, s.location_extra_evals, s.location_extra_searches,
        (SELECT count(*)::int FROM location_sites ls WHERE ls.supporter_id=s.id) AS sites_count,
        (SELECT count(*)::int FROM location_sites ls WHERE ls.supporter_id=s.id AND ls.evaluated_at IS NOT NULL) AS evals_used,
        (SELECT count(*)::int FROM location_searches x WHERE x.supporter_id=s.id) AS searches_used,
        (SELECT count(*)::int FROM location_orders o WHERE o.supporter_id=s.id) AS orders_count,
        (SELECT COALESCE(sum(o.amount_czk),0) FROM location_orders o WHERE o.supporter_id=s.id AND o.status IN ('paid','granted')) AS paid_sum
      FROM supporters s WHERE s.location_package IS NOT NULL ${qq ? "AND (s.email ILIKE $1 OR s.nick ILIKE $1 OR s.first_name ILIKE $1 OR s.last_name ILIKE $1)" : ''} ORDER BY s.location_expires_at DESC NULLS LAST, s.id DESC LIMIT 500`, qq ? ['%' + qq + '%'] : [])).rows;
    return res.send(LADM.customers({ adminLayout: V.adminLayout, admin: req.admin, holyosUrl: HOLYOS_URL, msg, rows, q: qq }));
  }
  const one = async (sql, p) => (await q(sql, p || [])).rows[0] || {};
  const savedAt = async () => { const r = (await q('SELECT value FROM app_settings WHERE key=$1', [LADM.PRICING_KEY + '_saved_at'])).rows[0]; return r && r.value; };
  const savedPrices = async () => { try { const r = (await q('SELECT value FROM app_settings WHERE key=$1', [LADM.PRICING_KEY])).rows[0]; return JSON.parse((r || {}).value || '{}') || {}; } catch (e) { return {}; } };
  if (tab === 'pricing') return res.send(LADM.pricing({ adminLayout: V.adminLayout, admin: req.admin, holyosUrl: HOLYOS_URL, msg, saved: await savedAt() }));
  if (tab === 'product:location') {
    const stats = {
      customers: Number((await one('SELECT count(*)::int AS v FROM supporters WHERE location_package IS NOT NULL')).v || 0),
      sites: Number((await one('SELECT count(*)::int AS v FROM location_sites')).v || 0),
      sites_eval: Number((await one('SELECT count(*)::int AS v FROM location_sites WHERE evaluated_at IS NOT NULL')).v || 0),
      running: Number((await one("SELECT count(*)::int AS v FROM location_sites WHERE study_status='running'")).v || 0),
      errors: Number((await one("SELECT count(*)::int AS v FROM location_sites WHERE study_status='error'")).v || 0),
      revenue: Number((await one("SELECT COALESCE(sum(amount_czk),0) AS v FROM location_orders WHERE status IN ('paid','granted') AND package NOT LIKE 'search%'")).v || 0),
    };
    return res.send(LADM.productLocation({ adminLayout: V.adminLayout, admin: req.admin, holyosUrl: HOLYOS_URL, msg, saved: await savedAt(), stats, saved_prices: await savedPrices() }));
  }
  if (tab === 'product:finder') {
    const stats = {
      searches: Number((await one('SELECT count(*)::int AS v FROM location_searches')).v || 0),
      searches_30: Number((await one("SELECT count(*)::int AS v FROM location_searches WHERE created_at > now() - interval '30 days'")).v || 0),
      with_cands: Number((await one('SELECT count(*)::int AS v FROM location_searches WHERE candidates IS NOT NULL')).v || 0),
      contacts: Number((await one("SELECT COALESCE(sum((SELECT count(*) FROM jsonb_object_keys(contacts))),0)::int AS v FROM location_searches")).v || 0),
      revenue: Number((await one("SELECT COALESCE(sum(amount_czk),0) AS v FROM location_orders WHERE status IN ('paid','granted') AND package LIKE 'search%'")).v || 0),
    };
    return res.send(LADM.productFinder({ adminLayout: V.adminLayout, admin: req.admin, holyosUrl: HOLYOS_URL, msg, saved: await savedAt(), stats, saved_prices: await savedPrices() }));
  }
  const st = {
    revenue_total: Number((await one("SELECT COALESCE(sum(amount_czk),0) AS v FROM location_orders WHERE status IN ('paid','granted')")).v || 0),
    revenue_30: Number((await one("SELECT COALESCE(sum(amount_czk),0) AS v FROM location_orders WHERE status IN ('paid','granted') AND COALESCE(paid_at, created_at) > now() - interval '30 days'")).v || 0),
    customers: Number((await one('SELECT count(*)::int AS v FROM supporters WHERE location_package IS NOT NULL')).v || 0),
    active: Number((await one("SELECT count(*)::int AS v FROM supporters WHERE location_package IS NOT NULL AND status='active' AND (location_expires_at IS NULL OR location_expires_at > now())")).v || 0),
    pending: Number((await one("SELECT count(*)::int AS v FROM location_orders WHERE status IN ('pending','request')")).v || 0),
    sites_eval: Number((await one('SELECT count(*)::int AS v FROM location_sites WHERE evaluated_at IS NOT NULL')).v || 0),
    searches: Number((await one('SELECT count(*)::int AS v FROM location_searches')).v || 0),
    premium_pending: Number((await one("SELECT count(*)::int AS v FROM location_orders WHERE package IN ('premium','up_premium') AND status='granted' AND (survey_date IS NULL OR survey_date='')")).v || 0),
    by_item: (await q("SELECT package, count(*)::int AS n, COALESCE(sum(amount_czk),0) AS sum FROM location_orders WHERE status IN ('paid','granted') GROUP BY package ORDER BY sum DESC")).rows.map((r) => ({ label: (LOC.PACKAGES[r.package] || LOC.EVAL_PACKS[r.package] || LOC.UPGRADE_PACKS[r.package] || { label: r.package }).label, n: r.n, sum: Number(r.sum) })),
  };
  res.send(LADM.overview({ adminLayout: V.adminLayout, admin: req.admin, holyosUrl: HOLYOS_URL, msg, stats: st, stripeOn: !!process.env.STRIPE_SECRET_KEY, termsVersion: LT.TERMS_VERSION }));
}));
app.post('/admin/online/pricing', requireAdmin, wrap(async (req, res) => {
  let curSaved = {}; try { const r = (await q('SELECT value FROM app_settings WHERE key=$1', [LADM.PRICING_KEY])).rows[0]; curSaved = JSON.parse((r || {}).value || '{}') || {}; } catch (e) { curSaved = {}; }
  const p = req.body.reset ? {} : LADM.parsePricing(Object.assign({}, req.body || {}, { _current: curSaved }));
  await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [LADM.PRICING_KEY, JSON.stringify(p)]);
  await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [LADM.PRICING_KEY + '_saved_at', new Date().toISOString()]);
  LADM.applyPricing(p);
  const back = /^product:(location|finder)$/.test(String(req.query.back || '')) ? String(req.query.back) : 'pricing';
  res.redirect('/admin/online?tab=' + encodeURIComponent(back) + '&msg=' + encodeURIComponent(req.body.reset ? 'Ceník vrácen na výchozí hodnoty.' : ((p.test_loc || p.test_find) ? 'Ceník uložen – TESTOVACÍ CENY ZAPNUTY (' + [p.test_loc ? 'Prověření lokality' : '', p.test_find ? 'Vyhledávač míst' : ''].filter(Boolean).join(' + ') + ', vše za ' + (LADM.TEST_AMOUNT / 100) + ' Kč).' : 'Ceník uložen.')));
}));
app.post('/admin/online/customer/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10); const u = (await q('SELECT * FROM supporters WHERE id=$1', [id])).rows[0]; if (!u) return res.redirect('/admin/online?tab=customers');
  const b = req.body || {}; const changes = [];
  if (b.package && LOC.PACKAGES[b.package] && b.package !== u.location_package) { await q('UPDATE supporters SET location_package=$2, updated_at=now() WHERE id=$1', [id, b.package]); changes.push('balíček ' + LOC.PACKAGES[b.package].label); }
  const ae = parseInt(b.add_evals, 10), as = parseInt(b.add_searches, 10);
  if (Number.isFinite(ae) && ae) { await q('UPDATE supporters SET location_extra_evals=GREATEST(0, COALESCE(location_extra_evals,0)+$2), updated_at=now() WHERE id=$1', [id, ae]); changes.push((ae > 0 ? '+' : '') + ae + ' vyhodnocení'); }
  if (Number.isFinite(as) && as) { await q('UPDATE supporters SET location_extra_searches=GREATEST(0, COALESCE(location_extra_searches,0)+$2), updated_at=now() WHERE id=$1', [id, as]); changes.push((as > 0 ? '+' : '') + as + ' vyhledání'); }
  if (b.extend === 'expire') { await q('UPDATE supporters SET location_expires_at=now(), updated_at=now() WHERE id=$1', [id]); changes.push('přístup ukončen'); }
  else if (['1', '3', '12'].includes(String(b.extend))) { await q("UPDATE supporters SET location_expires_at=GREATEST(COALESCE(location_expires_at, now()), now()) + ($2 || ' months')::interval, updated_at=now() WHERE id=$1", [id, String(b.extend)]); changes.push('platnost +' + b.extend + ' měs.'); }
  try { await q('INSERT INTO admin_log (admin_pid, admin_name, action, detail) VALUES ($1,$2,$3,$4)', [req.admin.pid || null, req.admin.name || '', 'online_customer_update', JSON.stringify({ supporter_id: id, changes })]); } catch (e) { /* log není kritický */ }
  res.redirect('/admin/online?tab=customers&msg=' + encodeURIComponent(changes.length ? 'Uloženo: ' + changes.join(', ') + '.' : 'Beze změny.'));
}));
app.get('/admin/location', requireAdmin, wrap(async (req, res) => {
  const status = Object.keys(LOC.STATUS).includes(req.query.status) ? req.query.status : '';
  const rows = (await q('SELECT o.*, (SELECT count(*)::int FROM location_sites ls WHERE ls.supporter_id=o.supporter_id) AS sites_count FROM location_orders o ' + (status ? 'WHERE o.status=$1 ' : '') + "ORDER BY (o.status='paid') DESC, o.created_at DESC LIMIT 500", status ? [status] : [])).rows;
  const counts = {}; (await q('SELECT status, count(*)::int AS c FROM location_orders GROUP BY status')).rows.forEach((r) => { counts[r.status] = r.c; });
  const wrapLayout = (title, active, admin, body, h) => LADM.shell(V.adminLayout, admin, h, 'orders', '', body.replace(/<h1[\s\S]*?<\/h1>\s*<p class="muted"[\s\S]*?<\/p>/, ''));
  res.send(LOC.adminLocationOrders({ adminLayout: wrapLayout, admin: req.admin, rows, counts, status, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, stripeOn: !!process.env.STRIPE_SECRET_KEY }));
}));
app.post('/admin/location/:id(\\d+)/status', requireAdmin, wrap(async (req, res) => {
  const st = String(req.body.status || ''); if (!Object.keys(LOC.STATUS).includes(st)) return res.redirect('/admin/location');
  const o = (await q('SELECT * FROM location_orders WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0]; if (!o) return res.redirect('/admin/location');
  if (st === 'granted') { try { await locGrantAccess(o, req); } catch (e) { return res.redirect('/admin/location?msg=' + encodeURIComponent('Účet se nepodařilo založit: ' + e.message)); } }
  else await q('UPDATE location_orders SET status=$1 WHERE id=$2', [st, o.id]);
  await log(req.admin, 'location_status', { id: req.params.id, status: st });
  res.redirect('/admin/location?msg=' + encodeURIComponent('Stav objednávky #' + req.params.id + ' změněn.'));
}));
app.post('/admin/location/:id(\\d+)/note', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {}; const t = (k, n) => (b[k] == null ? undefined : (String(b[k]).trim().slice(0, n) || null));
  await q('UPDATE location_orders SET note=$1, survey_date=COALESCE($3, survey_date), survey_tech=COALESCE($4, survey_tech), survey_report=COALESCE($5, survey_report) WHERE id=$2', [t('note', 2000), parseInt(req.params.id, 10), t('survey_date', 100), t('survey_tech', 100), t('survey_report', 8000)]);
  res.redirect('/admin/location?msg=' + encodeURIComponent('Poznámka uložena.'));
}));
// Povinné potvrzení VOP + ochrany údajů po prvním přihlášení
app.get('/souhlas', wrap(requireUserNoConsent), (req, res) => {
  if (req.user.vop_consent_at && req.user.gdpr_consent_at) return res.redirect('/');
  res.send(V.consentPage({ name: req.user.first_name || req.user.nick || '' }));
});
app.post('/souhlas', wrap(requireUserNoConsent), wrap(async (req, res) => {
  if (String(req.body.vop || '') !== '1' || String(req.body.gdpr || '') !== '1') return res.status(400).send(V.consentPage({ name: req.user.first_name || req.user.nick || '', error: 'Pro pokračování je nutné odsouhlasit obě podmínky.' }));
  await q('UPDATE supporters SET vop_consent_at=COALESCE(vop_consent_at, now()), gdpr_consent_at=COALESCE(gdpr_consent_at, now()), updated_at=now() WHERE id=$1', [req.user.id]);
  ST.track(req, req.user.id, 'consent');
  await log({ name: req.user.nick || req.user.email }, 'consent_accepted', { supporter_id: req.user.id, ip: req.ip });
  res.redirect('/');
}));
app.post('/join/:code', wrap(async (req, res) => {
  const seller = await loadSeller(req.params.code);
  if (!seller) return res.status(404).send(V.errorPage('Odkaz neplatí', 'Tenhle registrační odkaz není platný.', '/login'));
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).send(V.joinPage({ code: req.params.code, seller, error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const f = { first_name: String(req.body.first_name || '').trim(), last_name: String(req.body.last_name || '').trim(), email: String(req.body.email || '').trim().toLowerCase(), phone: String(req.body.phone || '').trim(), nick: String(req.body.nick || '').trim() };
  const password = String(req.body.password || ''), password2 = String(req.body.password2 || '');
  const back = (error) => res.status(400).send(V.joinPage({ code: req.params.code, seller, f, error }));
  f.gdpr = String(req.body.gdpr || '') === '1'; f.vop = String(req.body.vop || '') === '1';
  if (!f.first_name || !f.last_name) return back('Vyplň jméno a příjmení.');
  if (!f.vop) return back('Pro registraci je nutné odsouhlasit všeobecné obchodní podmínky.');
  if (!f.gdpr) return back('Pro registraci je nutné odsouhlasit zpracování osobních údajů.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return back('Zadej platný e-mail.');
  if (f.phone && !/^[+0-9 ()./-]{6,25}$/.test(f.phone)) return back('Telefon má neplatný formát.');
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(f.nick)) return back('Nick: 3–30 znaků, jen písmena, čísla, tečka, podtržítko, pomlčka.');
  if (password.length < 8) return back('Heslo musí mít aspoň 8 znaků.');
  if (password !== password2) return back('Hesla se neshodují.');
  if ((await q('SELECT 1 FROM supporters WHERE email=$1', [f.email])).rows.length) return back('Tento e-mail už u nás účet má — přihlas se, nebo použij Zapomenuté heslo.');
  if ((await q('SELECT 1 FROM supporters WHERE lower(nick)=lower($1)', [f.nick])).rows.length) return back('Tenhle nick už někdo má, zvol jiný.');
  // Telefon musí být jedinečný (porovnává se jen podle číslic, posledních 9)
  if (f.phone) { const tail = f.phone.replace(/\D/g, '').slice(-9); if (tail.length >= 9 && (await q("SELECT 1 FROM supporters WHERE phone IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 9)=$1", [tail])).rows.length) return back('Tento telefon už u nás účet má.'); }
  const hash = await bcrypt.hash(password, 11);
  const r = await q(`INSERT INTO supporters (email, first_name, last_name, phone, nick, password_hash, status, user_type, referred_by, source, activated_at, last_login_at, gdpr_consent_at, vop_consent_at)
    VALUES ($1,$2,$3,$4,$5,$6,'active','new',$7,'referral',now(),now(),now(),now()) RETURNING id`, [f.email, f.first_name, f.last_name, f.phone || null, f.nick, hash, seller.id]);
  await log({ name: 'web' }, 'join_via_referral', { id: r.rows[0].id, email: f.email, seller_id: seller.id, seller_nick: seller.nick, ip });
  setCookie(req, res, USER_COOKIE, { kind: 'user', sid: r.rows[0].id, nick: f.nick }, 30 * 24 * 3600);
  res.redirect('/?welcome=1');
}));

// ── Uživatel: domů + heslo ──────────────────────────────────────────────
app.get('/', (req, res, next) => {
  if (isAllowedAdmin(readCookie(req, ADMIN_COOKIE))) return res.redirect('/admin');
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
// Služby (Najít místo, Přípojky): nastavení v app_settings 'services' (admin → Produkty)
const SERVICE_DEFAULTS = [
  { key: 'find_place', name: 'Najít místo', desc: 'Pomůžeme ti najít vhodné místo pro tvůj prádlomat — analýza lokality, oslovení majitelů a doporučení. Na tuto položku nelze uplatnit DC.', price_czk: 25000, quote: false, dc_use_pct: 0, offered: true, no_dc: true },
  { key: 'connections', name: 'Přípojky', desc: 'Zajištění přípojek pro prádlomat (voda, elektřina, odpad). Cena se vytváří podle konkrétní situace — individuální nacenění. Na tuto položku nelze uplatnit DC.', price_czk: null, quote: true, dc_use_pct: 0, offered: true, no_dc: true },
  { key: 'place_free', name: 'Místo zdarma', desc: 'Místo i přípojky zajišťuje Best Series na vlastní smlouvu — zákazník neplatí Najít místo ani Přípojky, ale k místu nemá žádnou právní vazbu.', price_czk: null, quote: true, dc_use_pct: 0, offered: true, no_dc: true, hidden_card: true },
  { key: 'extended_warranty', section: 'warranty', name: 'Prodloužená záruka', desc: 'Záruka na prádlomat celkem 2 až 5 let. První rok je ze zákona zdarma, každý další rok stojí 15 000 Kč bez DPH.', price_czk: 15000, per_year_czk: 15000, years_min: 2, years_max: 5, free_years: 1, quote: false, dc_use_pct: 100, offered: true },
  { key: 'service_contract', section: 'warranty', mode: 'percent', percent: 13, name: 'Servisní smlouva', desc: 'Pravidelný servis a údržba prádlomatu. Cena je procento z obratu stroje (s DPH). Na tuto položku nelze uplatnit DC.', price_czk: null, quote: false, dc_use_pct: 0, offered: true, no_dc: true }
];
async function loadServices() {
  let saved = []; try { const r = await q("SELECT value FROM app_settings WHERE key='services'"); saved = JSON.parse((r.rows[0] || {}).value || '[]'); } catch (e) { saved = []; }
  return SERVICE_DEFAULTS.map(d => { const s = saved.find(x => x && x.key === d.key) || {}; return { ...d, ...s, key: d.key }; });
}
app.get('/pradlomaty', wrap(requireUser), wrap(async (req, res) => {
  let offers = [];
  try { const out = await loadProducts(); const set = await offeredSet(); offers = (out.items || []).filter(p => set.has(p.id)); } catch (e) { /* bez nabídky */ }
  try { const mins = new Map((await q('SELECT holyos_item_id, min_price_czk, min_price_eur, dc_use_pct FROM product_offers')).rows.map(r => [r.holyos_item_id, r])); offers = offers.map(p => { const m = mins.get(p.id) || {}; return { ...p, min_price_czk: m.min_price_czk, min_price_eur: m.min_price_eur, dc_use_pct: m.dc_use_pct }; }); } catch (e) { /* bez minima */ }
  const sum = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).b || 0);
  const balance = sum; // DC jsou vždy stejné (1 DC = 1 Kč) bez ohledu na zobrazenou měnu
  const cur = req.user.currency === 'EUR' ? 'EUR' : 'CZK', rateV = cur === 'EUR' ? await eurRate() : 1;
  const services = (await loadServices()).filter(x => x.offered).map(x => ({ ...x, net: (x.mode === 'percent' || x.quote || x.price_czk == null) ? null : Math.round(Number(x.price_czk) / rateV * 100) / 100, per_year_net: x.per_year_czk ? Math.round(Number(x.per_year_czk) / rateV) : null }));
  // Služby a záruka jdou objednat až po koupi prádlomatu (potvrzený nákup v purchases, nebo typ „Koupil prádlomat")
  const hasMachine = req.user.user_type === 'owner' || Number(((await q('SELECT count(*)::int AS c FROM purchases WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).c || 0) > 0;
  res.send(V.supporterProducts(req.user, offers, { balance, rate: await eurRate(), msg: req.query.msg || '', services, hasMachine }));
}));
// Koupit (+ případně uplatnit DC): vše se přepočítá na serveru, DC se hned odečtou, objednávku potvrdí admin
app.post('/order', wrap(requireUser), wrap(async (req, res) => {
  if (rateLimited('order:' + req.user.id, 5, 60 * 60e3)) return res.redirect('/pradlomaty?msg=' + encodeURIComponent('Příliš mnoho objednávek za hodinu. Zkuste to později.'));
  const back = (m) => res.redirect('/pradlomaty?msg=' + encodeURIComponent(m));
  const cur = req.user.currency === 'EUR' ? 'EUR' : 'CZK';
  if (String(req.body.item || '').startsWith('svc:')) {
    const parts = String(req.body.item).split(':'); const svKey = parts[1], svVariant = parts[2] || '';
    const hasMachineS = req.user.user_type === 'owner' || Number(((await q('SELECT count(*)::int AS c FROM purchases WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).c || 0) > 0;
    if (!hasMachineS) return res.redirect('/pradlomaty?msg=' + encodeURIComponent('Služby a záruku lze objednat až po koupi prádlomatu.'));
    const sv0 = (await loadServices()).find(x => x.key === svKey && x.offered);
    const sv = sv0 && svVariant === 'own' ? Object.assign({}, sv0, { quote: true, name: 'Vlastní místo (Najít místo + Přípojky)' }) : sv0;
    if (!sv) return back('Tuto službu teď nelze objednat.');
    const rateS = cur === 'EUR' ? await eurRate() : 1;
    if (sv.mode === 'percent' || sv.quote || sv.price_czk == null) {
      const ex = await q("SELECT id FROM orders WHERE supporter_id=$1 AND service_key=$2 AND status='new' LIMIT 1", [req.user.id, sv.key]);
      if (ex.rows[0]) return back('Poptávka „' + sv.name + '" už byla odeslána, ozveme se.');
      const ins0 = await q("INSERT INTO orders (supporter_id, product_name, currency, price_net, dc_used, final_net, kind, service_key) VALUES ($1,$2,$3,0,0,0,'service',$4) RETURNING id", [req.user.id, sv.name + (sv.mode === 'percent' ? ' — zájem (' + Number(sv.percent) + ' % z obratu s DPH)' : (sv.key === 'place_free' ? ' — zájem (místo a přípojky zajistí Best Series, bez právní vazby zákazníka)' : ' — poptávka nacenění')), cur, sv.key]);
      await log({ name: req.user.nick }, 'order_new', { id: ins0.rows[0].id, service: sv.key, quote: true, variant: svVariant || null });
      return res.redirect('/moje-pradlomaty?ordered=1');
    }
    // Prodloužená záruka: počet let (2–5) × cena za rok
    let yearsS = null, nameS = sv.name;
    if (sv.per_year_czk) { yearsS = Math.min(sv.years_max || 5, Math.max(sv.years_min || 2, parseInt(req.body.years, 10) || (sv.years_min || 2))); nameS = sv.name + ' — ' + yearsS + ' ' + (yearsS === 1 ? 'rok' : yearsS < 5 ? 'roky' : 'let') + ' (1. rok zdarma, placeno ' + (yearsS - (sv.free_years || 0)) + ')'; }
    const netS = Math.round(Number(yearsS ? sv.per_year_czk * Math.max(0, yearsS - (sv.free_years || 0)) : sv.price_czk) / rateS * 100) / 100;
    const roomS = Math.max(0, Math.floor(netS * (sv.dc_use_pct == null ? 100 : Number(sv.dc_use_pct)) / 100));
    const balS = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).b || 0); // v DC (Kč)
    const dcS = Math.min(Math.max(0, parseInt(req.body.dc, 10) || 0), Math.floor(roomS * rateS), Math.floor(balS)); // uplatněné DC
    const discS = Math.round(dcS / rateS * 100) / 100; // sleva v měně objednávky
    const insS = await q("INSERT INTO orders (supporter_id, product_name, currency, price_net, dc_used, final_net, kind, service_key) VALUES ($1,$2,$3,$4,$5,$6,'service',$7) RETURNING id", [req.user.id, nameS, cur, netS, discS, netS - discS, sv.key]);
    if (dcS > 0) await q('INSERT INTO credits (supporter_id, amount_czk, note, order_id) VALUES ($1,$2,$3,$4)', [req.user.id, -dcS, 'Uplatnění DC: ' + nameS + ' (objednávka #' + insS.rows[0].id + ')', insS.rows[0].id]);
    await log({ name: req.user.nick }, 'order_new', { id: insS.rows[0].id, service: sv.key, dc: dcS });
  holyosInvoice('proforma', { ref: insS.rows[0].id, currency: cur, customer: invCustomer(req.user), items: orderInvItems(nameS, netS, discS), note: 'Objednávka služby.' });
    return res.redirect('/moje-pradlomaty?ordered=1');
  }
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
  const bal = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).b || 0); // v DC (Kč)
  let dc = Math.max(0, parseInt(req.body.dc, 10) || 0); // DC jsou vždy v Kč; v eurech se sleva přepočítá kurzem
  dc = Math.min(dc, Math.floor(room * rate), Math.floor(bal));
  const disc = Math.round(dc / rate * 100) / 100; // sleva v měně objednávky
  const ins = await q('INSERT INTO orders (supporter_id, holyos_item_id, product_name, currency, price_net, dc_used, final_net) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, p.id, p.name_cs, cur, net, disc, net - disc]);
  if (dc > 0) await q('INSERT INTO credits (supporter_id, amount_czk, note, order_id) VALUES ($1,$2,$3,$4)', [req.user.id, -dc, 'Uplatnění DC: ' + p.name_cs + ' (objednávka #' + ins.rows[0].id + ')', ins.rows[0].id]);
  await log({ name: req.user.nick }, 'order_new', { id: ins.rows[0].id, product: p.name_cs, dc });
  holyosInvoice('proforma', { ref: ins.rows[0].id, currency: cur, customer: invCustomer(req.user), items: orderInvItems(p.name_cs, net, disc), note: 'Objednávka prádlomatu.' });
  res.redirect('/moje-pradlomaty?ordered=1');
}));
app.get('/moje-pradlomaty', wrap(requireUser), wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM purchases WHERE supporter_id=$1 ORDER BY purchased_at DESC, id DESC', [req.user.id])).rows;
  let byId = new Map(); try { byId = new Map(((await loadProducts()).items || []).map(p => [p.id, p])); } catch (e) { /* bez parametrů stroje */ }
  rows.forEach(r => { r.machine = byId.get(r.holyos_item_id) || null; });
  const orders = (await q('SELECT * FROM orders WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100', [req.user.id])).rows;
  // Doklady k objednávkám; po zobrazení stránky se označí jako viděné (zelená tečka v menu zmizí)
  let docs = []; try { docs = await userDocs(req.user, true); } catch (e) { docs = []; }
  orders.forEach(o => { o.docs = {}; docs.filter(d => d.ref === o.id).forEach(d => { o.docs[d.which] = d; }); });
  const unseen = docs.filter(d => !d.seen);
  if (unseen.length) { for (const d of unseen) await q('INSERT INTO doc_seen (supporter_id, invoice_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, d.id]).catch(() => {}); _docCache.delete(req.user.id); req.user.new_docs = 0; }
  req.user.unpaid_docs = docs.filter(d => d.unpaid).length;
  res.send(V.supporterMine(req.user, { rows, orders, msg: req.query.ordered ? 'Objednávka odeslána. Ozveme se s potvrzením.' : '' }));
}));
// Stažení dokladu (faktury) uživatelem — jen doklady k jeho vlastním objednávkám, které už byly odeslány
app.get('/moje-pradlomaty/doklad/:id(\\d+)/pdf', wrap(requireUser), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const docs = await userDocs(req.user);
  if (!docs.some(d => d.id === id)) return res.status(404).send(V.errorPage('Doklad', 'Doklad nenalezen.', '/moje-pradlomaty'));
  const r = await holyosFetch('GET', '/api/auth/bs2/invoice/' + id + '/pdf');
  if (!r.ok) return res.status(502).send(V.errorPage('Doklad', 'Doklad se teď nepodařilo načíst. Zkuste to prosím za chvíli.', '/moje-pradlomaty'));
  const d = docs.find(x => x.id === id);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + String(d.number || 'doklad').replace(/[^\w.-]/g, '_') + '.pdf"' }).send(Buffer.from(await r.arrayBuffer()));
}));
app.get('/discount-credit', wrap(requireUser), wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM credits WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC LIMIT 500', [req.user.id])).rows;
  let sellable = [];
  try {
    const items = (await loadProducts()).items || [];
    const off = new Map((await q('SELECT holyos_item_id, offered, credit_pct FROM product_offers')).rows.map(r => [r.holyos_item_id, r]));
    sellable = items.filter(p => off.get(p.id) && off.get(p.id).offered).map(p => ({ ...p, credit_pct: Number(off.get(p.id).credit_pct) }));
  } catch (e) { /* bez tabulky */ }
  const transfers = (await q('SELECT * FROM support_transfers WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC LIMIT 50', [req.user.id])).rows;
  res.send(V.supporterCredit(req.user, { rows, sellable, rate: await eurRate(), transfers, msg: req.query.msg || '', tfEv: await tfEventsFor(transfers.map(t => t.id)) }));
}));
app.get('/sit', wrap(requireUser), wrap(async (req, res) => {
  if (!['seller', 'standard'].includes(req.user.user_type)) return res.redirect('/');
  const [rows, line] = await Promise.all([loadNetwork(req.user), loadFirstLine(req.user)]);
  res.send(V.supporterNetwork(req.user, { rows, lineCount: line.length }));
}));
app.get('/team', wrap(requireUser), wrap(async (req, res) => {
  if (!['seller', 'standard'].includes(req.user.user_type)) return res.redirect('/');
  const code = await ensureRefCode(req.user);
  res.send(V.supporterTeam(req.user, { team: await loadFirstLine(req.user), refUrl: PUBLIC_URL + '/join/' + code }));
}));
// ── Živá podpora (uživatel) ──────────────────────────────────────────────
async function supportAgents() { try { const r = await q("SELECT value FROM app_settings WHERE key='support_agents'"); const a = JSON.parse((r.rows[0] || {}).value || '[]'); return Array.isArray(a) ? a.filter(x => x && x.name) : []; } catch (e) { return []; } }
async function supportAgent() { try { const r = await q("SELECT value FROM app_settings WHERE key='support_agent'"); return (r.rows[0] || {}).value || ''; } catch (e) { return ''; } }
async function supportOnline() { try { const r = await q("SELECT value FROM app_settings WHERE key='support_online'"); return (r.rows[0] || {}).value === '1'; } catch (e) { return false; } }
app.get('/podpora', wrap(requireUser), wrap(async (req, res) => {
  const online = await supportOnline();
  const msgs = (await q('SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 ORDER BY created_at, id', [req.user.id])).rows;
  await q('UPDATE support_messages SET read_by_user=true WHERE supporter_id=$1 AND sender=$2 AND read_by_user=false', [req.user.id, 'agent']);
  res.send(V.supportPage(req.user, { online, msgs, agent: await supportAgent() }));
}));
app.get('/api/support/state', wrap(async (req, res) => {
  const s = readCookie(req, USER_COOKIE); if (!s || s.kind !== 'user') return res.status(401).json({});
  const online = await supportOnline();
  const unread = Number(((await q("SELECT count(*)::int AS c FROM support_messages WHERE supporter_id=$1 AND sender='agent' AND read_by_user=false", [s.sid])).rows[0] || {}).c || 0);
  const after = parseInt(req.query.after, 10);
  let msgs = [];
  if (Number.isFinite(after)) { msgs = (await q('SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 AND id>$2 ORDER BY id', [s.sid, after])).rows; if (msgs.length) await q('UPDATE support_messages SET read_by_user=true WHERE supporter_id=$1 AND sender=$2', [s.sid, 'agent']); }
  res.set('Cache-Control', 'no-store').json({ online, unread, msgs, agent: await supportAgent() });
}));
const SUP_COLS = 'id, supporter_id, sender, agent_name, body, read_by_agent, read_by_user, created_at, file_name, file_type, file_size, order_id';
const supUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
// Skutečný typ souboru podle hlavičky (magic bytes) — nevěříme příponě ani MIME od prohlížeče
function sniffType(buf) {
  if (!buf || buf.length < 4) return null;
  const h = buf.subarray(0, 12);
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png';
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return 'image/gif';
  if (h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (h.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04) return 'application/zip'; // zip / docx / xlsx
  if (h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0) return 'application/msoffice'; // doc / xls
  const txt = buf.subarray(0, 512).toString('utf8'); if (!/[\x00-\x08\x0e-\x1f]/.test(txt)) return 'text/plain';
  return null;
}
function checkedFile(f) {
  if (!f) return { ok: true, f: null };
  const real = sniffType(f.buffer); if (!real) return { ok: false, error: 'Tento typ souboru nelze přiložit (povoleno: obrázky, PDF, Word, Excel, TXT, ZIP).' };
  const name = String(f.originalname || 'soubor').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
  const safeType = real.startsWith('image/') || real === 'application/pdf' ? real : 'application/octet-stream'; // ostatní jen ke stažení
  return { ok: true, f: { originalname: name, mimetype: safeType, size: f.size, buffer: f.buffer } };
}
app.post('/api/support/send', wrap(requireUser), supUpload.single('file'), wrap(async (req, res) => {
  if (rateLimited('support:' + req.user.id, 30, 10 * 60e3)) return res.status(429).json({ error: 'Příliš mnoho zpráv za sebou. Zkuste to za chvíli.' });
  if (!(await supportOnline())) return res.status(403).json({ error: 'Podpora je momentálně offline.' });
  const body = String((req.body || {}).body || '').trim().slice(0, 2000);
  const chk = checkedFile(req.file || null); if (!chk.ok) return res.status(400).json({ error: chk.error }); const f = chk.f;
  if (!body && !f) return res.status(400).json({ error: 'Prázdná zpráva.' });
  const r = await q('INSERT INTO support_messages (supporter_id, sender, body, file_name, file_type, file_size, file_data) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ' + SUP_COLS, [req.user.id, 'user', body || (f ? '📎 ' + f.originalname : ''), f ? f.originalname.slice(0, 200) : null, f ? f.mimetype : null, f ? f.size : null, f ? f.buffer : null]);
  notifyVelin('💬 Nová zpráva v podpoře', (req.user.nick || req.user.email) + ': ' + (body || 'příloha').slice(0, 120), '/admin/podpora?u=' + req.user.id, 'support');
  res.json({ ok: true, msg: r.rows[0] });
}));
// Stažení přílohy — uživatel jen své, admin vše
app.get('/support/file/:id(\\d+)', wrap(async (req, res) => {
  const a = readCookie(req, ADMIN_COOKIE), u = readCookie(req, USER_COOKIE);
  const isAdmin = !!(a && a.kind === 'admin' && isAllowedAdmin(a)), uid = u && u.kind === 'user' ? u.sid : null;
  if (!isAdmin && !uid) return res.status(401).end();
  const r = await q('SELECT supporter_id, file_name, file_type, file_data FROM support_messages WHERE id=$1', [parseInt(req.params.id, 10)]);
  const m = r.rows[0]; if (!m || !m.file_data) return res.status(404).end();
  if (!isAdmin && m.supporter_id !== uid) return res.status(403).end();
  const inlineOk = /^image\/(png|jpeg|gif|webp)$/.test(m.file_type || '') || m.file_type === 'application/pdf';
  res.set('Content-Type', inlineOk ? m.file_type : 'application/octet-stream').set('X-Content-Type-Options', 'nosniff').set('Content-Security-Policy', "default-src 'none'; sandbox").set('Content-Disposition', (req.query.dl || !inlineOk ? 'attachment' : 'inline') + '; filename*=UTF-8\'\'' + encodeURIComponent(m.file_name || 'soubor')).set('Cache-Control', 'private, max-age=86400').send(m.file_data);
}));

app.get('/ai-chat', wrap(requireUser), (req, res) => { if (!req.user.ai_chat_on) return res.redirect('/'); res.send(V.aiChatPage(req.user)); });
// Historie nákupů aplikace Prověření lokality (balíčky, dokupy, přechody) – jen u účtů, které balíček mají
async function locPurchases(u) {
  if (!u || !u.location_package) return null;
  const rows = (await q("SELECT id, package, amount_czk, status, created_at, paid_at, stripe_payment_intent FROM location_orders WHERE supporter_id=$1 OR (supporter_id IS NULL AND email=$2) ORDER BY created_at DESC LIMIT 100", [u.id, u.email])).rows;
  return rows.map((o) => { const p = LOC.PACKAGES[o.package], e = LOC.EVAL_PACKS[o.package], up = LOC.UPGRADE_PACKS[o.package];
    const item = p ? 'Balíček ' + p.label : e ? (e.evals ? 'Dokoupení vyhodnocení – ' + e.evals + ' ks' : 'Dokoupení vyhledání – ' + e.searches + ' ks') : up ? 'Přechod na balíček ' + LOC.PACKAGES[up.to].label : o.package;
    const detail = p ? p.desc : e ? e.desc : up ? up.desc : '';
    return { id: o.id, item, detail, amount_czk: o.amount_czk, status: o.status, created_at: o.created_at, paid_at: o.paid_at, receipt_url: null }; });
}
app.get('/password', wrap(requireUser), wrap(async (req, res) => res.send(V.passwordPage({ s: req.user, purchases: await locPurchases(req.user) }))));
app.post('/password', wrap(requireUser), wrap(async (req, res) => {
  const { old = '', password = '', password2 = '' } = req.body;
  const back = async (error, ok) => res.send(V.passwordPage({ s: req.user, error, ok, purchases: await locPurchases(req.user) }));
  if (!(await bcrypt.compare(String(old), req.user.password_hash))) return back('Současné heslo nesouhlasí.');
  if (String(password).length < 8) return back('Nové heslo musí mít aspoň 8 znaků.');
  if (password !== password2) return back('Nová hesla se neshodují.');
  await q('UPDATE supporters SET password_hash=$1, updated_at=now() WHERE id=$2', [await bcrypt.hash(String(password), 11), req.user.id]);
  await back('', 'Heslo změněno.');
}));

// ── Správa (SSO) ───────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, wrap(async (req, res) => {
  const st = (await q("SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='invited')::int AS invited, count(*) FILTER (WHERE status='blocked')::int AS blocked, count(*) FILTER (WHERE last_login_at IS NOT NULL)::int AS logged, count(*) FILTER (WHERE last_login_at > now() - interval '30 days')::int AS logged30 FROM supporters")).rows[0];
  const recent = (await q('SELECT nick, email, last_login_at FROM supporters WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 8')).rows;
  // Historie aktivních uživatelů po dnech: noví (první přihlášení ten den), přihlášení ten den (unikátní) a kumulativně celkem
  let history = [];
  try {
    history = (await q(`WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '59 days', date_trunc('day', now()), interval '1 day')::date AS d),
      first AS (SELECT s.id AS supporter_id, LEAST(COALESCE((SELECT min(e.created_at) FROM user_events e WHERE e.type='login' AND e.supporter_id=s.id), s.last_login_at), COALESCE(s.activated_at, s.last_login_at))::date AS d FROM supporters s WHERE s.last_login_at IS NOT NULL),
      daily AS (SELECT created_at::date AS d, count(DISTINCT supporter_id)::int AS n FROM user_events WHERE type='login' AND supporter_id IS NOT NULL AND created_at > now() - interval '60 days' GROUP BY 1)
      SELECT to_char(days.d,'YYYY-MM-DD') AS d, COALESCE((SELECT count(*)::int FROM first WHERE first.d=days.d),0) AS new_users, COALESCE(daily.n,0) AS logins,
        (SELECT count(*)::int FROM first WHERE first.d<=days.d) AS cumulative FROM days LEFT JOIN daily ON daily.d=days.d ORDER BY days.d`)).rows;
  } catch (e) { history = []; }
  res.send(V.adminDash({ admin: req.admin, stats: st, recent, history, holyosUrl: HOLYOS_URL }));
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
const USER_TYPES = ['new', 'standard', 'owner', 'seller', 'location'];
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
// Obrázek produktu — proxy z HolyOS (uživatel BS2 nemá do HolyOS přístup), cache v paměti 1 h
const productImgCache = new Map(); // id → { at, buf, type }
app.get('/img/product/:id(\\d+)', wrap(async (req, res) => {
  const id = req.params.id, key = id + '|' + (req.query.v || '');
  const c = productImgCache.get(key);
  if (c && Date.now() - c.at < 3600e3) return res.set('Content-Type', c.type).set('Cache-Control', 'public, max-age=86400').send(c.buf);
  const secret = process.env.BS2_SSO_SECRET; if (!secret) return res.status(404).end();
  const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + '/api/auth/bs2/products/' + id + '/image', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return res.status(404).end();
  const buf = Buffer.from(await r.arrayBuffer()), type = r.headers.get('content-type') || 'image/png';
  productImgCache.set(key, { at: Date.now(), buf, type });
  res.set('Content-Type', type).set('Cache-Control', 'public, max-age=86400').send(buf);
}));
async function offeredSet() { const r = await q('SELECT holyos_item_id FROM product_offers WHERE offered'); return new Set(r.rows.map(x => x.holyos_item_id)); }
app.get('/admin/products', requireAdmin, wrap(async (req, res) => {
  if (req.query.refresh) productsCache = { at: 0, items: null };
  let out; try { out = await loadProducts(); } catch (e) { out = { error: 'Nepodařilo se načíst ceník z HolyOS: ' + e.message }; }
  const offered = await offeredSet();
  const po = new Map((await q('SELECT holyos_item_id, credit_pct, min_price_czk, min_price_eur, dc_use_pct FROM product_offers')).rows.map(r => [r.holyos_item_id, r]));
  const rows = (out.items || []).map(p => { const o = po.get(p.id) || {}; return { ...p, offered: offered.has(p.id), credit_pct: Number(o.credit_pct || 0), min_price_czk: o.min_price_czk, min_price_eur: o.min_price_eur, dc_use_pct: o.dc_use_pct }; });
  res.send(V.adminProducts({ admin: req.admin, rows, error: out.error || '', msg: req.query.msg || '', holyosUrl: HOLYOS_URL, rate: await eurRate(), services: await loadServices() }));
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
app.post('/admin/services/save', requireAdmin, wrap(async (req, res) => {
  const b = req.body, out = [];
  for (const d of SERVICE_DEFAULTS) {
    const t = String(b['price_' + d.key] == null ? '' : b['price_' + d.key]).replace(/\s/g, '').replace(',', '.'), n = Number(t);
    const quote = b['quote_' + d.key] === '1' || t === '' || !isFinite(n) || n <= 0;
    const dp = Number(String(b['dc_' + d.key] || '').replace(',', '.'));
    if (d.mode === 'percent') { const pc = Number(String(b['percent_' + d.key] || '').replace(',', '.')); out.push({ key: d.key, name: String(b['name_' + d.key] || d.name).trim().slice(0, 80) || d.name, desc: String(b['desc_' + d.key] || '').trim().slice(0, 600), percent: isFinite(pc) && pc > 0 ? Math.min(100, pc) : d.percent, offered: b['offered_' + d.key] === '1' }); continue; }
    out.push({ key: d.key, name: String(b['name_' + d.key] || d.name).trim().slice(0, 80) || d.name, desc: String(b['desc_' + d.key] || '').trim().slice(0, 600), price_czk: quote ? null : n, quote, dc_use_pct: isFinite(dp) ? Math.min(100, Math.max(0, dp)) : 100, offered: b['offered_' + d.key] === '1' });
  }
  await q("INSERT INTO app_settings (key, value) VALUES ('services', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(out)]);
  await log(req.admin, 'services_save', out);
  res.redirect('/admin/products?msg=' + encodeURIComponent('Služby uloženy.'));
}));

// Evidence pohybů žádosti o převod podpory
async function tfEvent(tid, event, actor, detail) { try { await q('INSERT INTO support_transfer_events (transfer_id, event, actor, detail) VALUES ($1,$2,$3,$4)', [tid, event, actor || null, detail || null]); } catch (e) { /* evidence není kritická */ } }
async function tfEventsFor(ids) {
  const out = {}; if (!ids.length) return out;
  (await q('SELECT * FROM support_transfer_events WHERE transfer_id = ANY($1::int[]) ORDER BY created_at, id', [ids])).rows.forEach(e => { (out[e.transfer_id] = out[e.transfer_id] || []).push(e); });
  return out;
}
// Žádost o převod podpory ze starého systému (jen uživatelé typu Stávající) — zpracovává admin ručně
app.post('/discount-credit/transfer', wrap(requireUser), wrap(async (req, res) => {
  const back = (m) => res.redirect('/discount-credit?msg=' + encodeURIComponent(m));
  if (req.user.user_type !== 'standard') return back('Převod podpory je dostupný jen pro uživatele typu Stávající.');
  if (String(req.body.confirm || '') !== '1') return back('Potvrď, že rozumíš, že je žádost závazná a nelze ji zrušit.');
  const amount = Math.round(Number(String(req.body.amount || '').replace(/\s/g, '').replace(',', '.')) * 100) / 100;
  if (!(amount > 0) || amount > 100000000) return back('Zadej částku větší než 0.');
  const cur = req.body.cur === 'EUR' ? 'EUR' : 'CZK';
  const kind = req.body.kind === 'withdrawal' ? 'withdrawal' : 'support'; // zdroj částky ve starém systému; vždy se převádí na DC
  const pending = (await q("SELECT count(*)::int AS c FROM support_transfers WHERE supporter_id=$1 AND status='pending'", [req.user.id])).rows[0].c;
  if (pending >= 5) return back('Máš už několik nevyřízených žádostí. Počkej prosím na jejich zpracování.');
  const rate = cur === 'EUR' ? await eurRate() : 1;
  const dc = Math.round(amount * rate * 100) / 100;
  const note = String(req.body.note || '').trim().slice(0, 300) || null;
  const ins = await q('INSERT INTO support_transfers (supporter_id, amount, currency, rate, dc_amount, note, kind) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, amount, cur, rate, dc, note, kind]);
  await tfEvent(ins.rows[0].id, 'created', req.user.nick || req.user.email, (kind === 'withdrawal' ? 'z výběru ' : 'z podpory ') + amount.toLocaleString('cs-CZ') + ' ' + (cur === 'EUR' ? '€' : 'Kč') + ' = ' + dc.toLocaleString('cs-CZ') + ' DC (kurz ' + rate + ')');
  notifyVelin('💸 Nová žádost o převod podpory', (req.user.nick || req.user.email) + ' · ' + amount.toLocaleString('cs-CZ') + ' ' + (cur === 'EUR' ? '€' : 'Kč') + ' = ' + dc.toLocaleString('cs-CZ') + ' DC', '/admin/transfers', 'transfer');
  try { await q('INSERT INTO admin_log (admin_pid, admin_name, action, detail) VALUES ($1,$2,$3,$4)', [null, req.user.nick || req.user.email, 'support_transfer_request', JSON.stringify({ id: ins.rows[0].id, supporter_id: req.user.id, kind, amount, cur, dc })]); } catch (e) { /* log není kritický */ }
  back('Žádost o převod ' + (kind === 'withdrawal' ? 'z výběru ' : 'z podpory ') + amount.toLocaleString('cs-CZ') + ' ' + (cur === 'EUR' ? '€' : 'Kč') + ' (' + dc.toLocaleString('cs-CZ') + ' DC) byla odeslána a je ve stavu zpracovává se. Dáme Ti vědět.');
}));
// Admin: Převody podpory
// ── Živá podpora (admin) ─────────────────────────────────────────────────
// 2FA správce: nastavení (QR) a ověření kódu
app.get('/admin/2fa', wrap(async (req, res) => {
  const s = readCookie(req, ADMIN_COOKIE); if (!s || s.kind !== 'admin' || !isAllowedAdmin(s)) return res.redirect('/login');
  if (!ADMIN_2FA || s.tfa) return res.redirect('/admin');
  let secret = await adminTotpSecret(s.pid); let setup = false;
  if (!secret) { secret = b32enc(crypto.randomBytes(20)); setup = true; await q("INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", ['admin_totp_pending_' + s.pid, secret]); }
  const uri = 'otpauth://totp/' + encodeURIComponent('Best Series 2.0:' + (s.name || s.username || 'admin')) + '?secret=' + secret + '&issuer=' + encodeURIComponent('Best Series 2.0') + '&digits=6&period=30';
  res.send(V.admin2faPage({ setup, secret, uri, error: req.query.err ? 'Kód nesedí. Zkuste to znovu.' : '' }));
}));
app.post('/admin/2fa', wrap(async (req, res) => {
  const s = readCookie(req, ADMIN_COOKIE); if (!s || s.kind !== 'admin' || !isAllowedAdmin(s)) return res.redirect('/login');
  if (rateLimited('2fa:' + s.pid, 10, 15 * 60e3)) return res.status(429).send(V.errorPage('Příliš mnoho pokusů', 'Zkuste to za 15 minut.', '/admin/2fa'));
  let secret = await adminTotpSecret(s.pid); let pending = false;
  if (!secret) { const r = await q("SELECT value FROM app_settings WHERE key=$1", ['admin_totp_pending_' + s.pid]); secret = (r.rows[0] || {}).value || null; pending = true; }
  if (!secret || !totpOk(secret, req.body.code)) return res.redirect('/admin/2fa?err=1');
  if (pending) { await q("INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", ['admin_totp_' + s.pid, secret]); await q("DELETE FROM app_settings WHERE key=$1", ['admin_totp_pending_' + s.pid]); await log(s, '2fa_setup', { pid: s.pid }); }
  setCookie(req, res, ADMIN_COOKIE, Object.assign({}, s, { tfa: true, iat: undefined, exp: undefined }), 12 * 3600);
  res.redirect('/admin');
}));

app.get('/admin/podpora', requireAdmin, wrap(async (req, res) => {
  const online = await supportOnline();
  const threads = (await q(`SELECT s.id, s.nick, s.first_name, s.last_name, s.email,
      (SELECT count(*)::int FROM support_messages m WHERE m.supporter_id=s.id AND m.sender='user' AND m.read_by_agent=false) AS unread,
      (SELECT max(created_at) FROM support_messages m WHERE m.supporter_id=s.id) AS last_at,
      (SELECT body FROM support_messages m WHERE m.supporter_id=s.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_body
    FROM supporters s WHERE EXISTS (SELECT 1 FROM support_messages m WHERE m.supporter_id=s.id) ORDER BY unread DESC, last_at DESC LIMIT 200`)).rows;
  const sid = parseInt(req.query.u, 10) || (threads[0] && threads[0].id) || null;
  let msgs = [], who = null;
  if (sid) {
    who = (await q('SELECT id, nick, first_name, last_name, email, phone FROM supporters WHERE id=$1', [sid])).rows[0] || null;
    msgs = (await q('SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 ORDER BY created_at, id', [sid])).rows;
    await q("UPDATE support_messages SET read_by_agent=true WHERE supporter_id=$1 AND sender='user' AND read_by_agent=false", [sid]);
  }
  let ord = null; const oid = parseInt(req.query.order, 10);
  if (sid && Number.isFinite(oid)) ord = (await q('SELECT id, product_name FROM orders WHERE id=$1 AND supporter_id=$2', [oid, sid])).rows[0] || null;
  res.send(V.adminSupport({ admin: req.admin, online, threads, who, msgs, holyosUrl: HOLYOS_URL, msg: req.query.msg || '', agents: await supportAgents(), agent: await supportAgent(), order: ord }));
}));
app.post('/admin/podpora/agents', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {}; let agents = await supportAgents();
  if (b.add) { const n = String(b.add).trim().slice(0, 60); if (n && !agents.some(a => a.name === n)) agents.push({ name: n }); }
  if (b.remove) agents = agents.filter(a => a.name !== String(b.remove));
  await q("INSERT INTO app_settings (key,value) VALUES ('support_agents',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(agents)]);
  if (b.current !== undefined) await q("INSERT INTO app_settings (key,value) VALUES ('support_agent',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [String(b.current || '').slice(0, 60)]);
  res.redirect('/admin/podpora?msg=' + encodeURIComponent('Profily podpory uloženy.'));
}));
app.post('/admin/podpora/online', requireAdmin, wrap(async (req, res) => {
  const on = String((req.body || {}).online) === '1';
  if (on && (req.body || {}).agent !== undefined) await q("INSERT INTO app_settings (key,value) VALUES ('support_agent',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [String(req.body.agent || '').slice(0, 60)]);
  await q("INSERT INTO app_settings (key,value) VALUES ('support_online',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [on ? '1' : '0']);
  await log(req.admin, 'support_online', { online: on });
  res.redirect('/admin/podpora?msg=' + encodeURIComponent(on ? 'Podpora je ONLINE — uživatelé mohou psát.' : 'Podpora je OFFLINE.'));
}));
// Odeslání zprávy podpory uživateli (společné pro web admin i Velín): uloží zprávu + e-mail, když uživatel není online
async function agentSend(sid, body, oidIn, f, fallbackName) {
  let row = null;
  // Zpráva k objednávce (tlačítko Chat v Objednávkách): ověř, že objednávka patří uživateli, a předřaď číslo objednávky
  let ord = null;
  if (Number.isFinite(oidIn)) ord = (await q('SELECT id, product_name FROM orders WHERE id=$1 AND supporter_id=$2', [oidIn, sid])).rows[0] || null;
  const bodyOut = ord && body ? 'K objednávce č. ' + ord.id + ' (' + ord.product_name + '): ' + body : body;
  if (bodyOut || f) row = (await q('INSERT INTO support_messages (supporter_id, sender, agent_name, body, read_by_agent, file_name, file_type, file_size, file_data, order_id) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9) RETURNING ' + SUP_COLS, [sid, 'agent', (await supportAgent()) || fallbackName || 'Podpora', bodyOut || (f ? '📎 ' + f.originalname : ''), f ? f.originalname.slice(0, 200) : null, f ? f.mimetype : null, f ? f.size : null, f ? f.buffer : null, ord ? ord.id : null])).rows[0];
  // E-mail uživateli o nové zprávě v chatu — vždy, když není právě online na webu (nejvýš 1× za 10 min na uživatele, ať se nespamuje)
  if (row) {
    try {
      const online = ST.isOnline(sid);
      const recent = (await q("SELECT count(*)::int AS c FROM support_messages WHERE supporter_id=$1 AND sender='agent' AND created_at > now() - interval '10 minutes' AND id<>$2", [sid, row.id])).rows[0].c;
      const u = (await q('SELECT email, first_name FROM supporters WHERE id=$1', [sid])).rows[0];
      if (!online && !recent && u && u.email) {
        const hello = u.first_name ? 'Dobrý den ' + u.first_name + ',' : 'Dobrý den,';
        sendBs2Mail({ to: u.email, subject: ord ? 'Nová zpráva k objednávce č. ' + ord.id + ' — Best Series 2.0' : 'Nová zpráva z podpory — Best Series 2.0', link: PUBLIC_URL + '/podpora', linkLabel: 'Otevřít chat',
          body: hello + '\n\n' + (ord ? 'máte novou zprávu v chatu, která se týká vaší objednávky č. ' + ord.id + ' (' + ord.product_name + ').' : 'máte novou zprávu z podpory Best Series 2.0.') + '\n\nPřihlaste se do aplikace a odpovězte v chatu.\n\nBest Series s.r.o.' })
          .catch((e) => console.warn('[bs2] chat mail:', e.message));
      }
    } catch (e) { console.warn('[bs2] chat mail:', e.message); }
  }
  return row;
}
app.post('/admin/podpora/:id(\\d+)/send', requireAdmin, supUpload.single('file'), wrap(async (req, res) => {
  const sid = parseInt(req.params.id, 10); const body = String((req.body || {}).body || '').trim().slice(0, 4000);
  const chk = checkedFile(req.file || null); if (!chk.ok) return res.status(400).json({ error: chk.error }); const f = chk.f;
  const row = await agentSend(sid, body, parseInt((req.body || {}).order_id, 10), f, req.admin.name);
  if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true, msg: row });
  res.redirect('/admin/podpora?u=' + sid);
}));

// ── Servisní API podpory pro Velín (volá jen HolyOS; Bearer JWT podepsaný BS2_SSO_SECRET, aud 'bs2-api', iss 'holyos') ──
function requireSvc(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!SSO_SECRET || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { req.svc = jwt.verify(m[1], SSO_SECRET, { audience: 'bs2-api', issuer: 'holyos' }); next(); } catch (e) { res.status(401).json({ error: 'Neplatný token' }); }
}
app.get('/api/svc/support/threads', requireSvc, wrap(async (req, res) => {
  const threads = (await q(`SELECT s.id, s.nick, s.first_name, s.last_name, s.email,
      (SELECT count(*)::int FROM support_messages m WHERE m.supporter_id=s.id AND m.sender='user' AND m.read_by_agent=false) AS unread,
      (SELECT max(created_at) FROM support_messages m WHERE m.supporter_id=s.id) AS last_at,
      (SELECT body FROM support_messages m WHERE m.supporter_id=s.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_body,
      (SELECT sender FROM support_messages m WHERE m.supporter_id=s.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_sender
    FROM supporters s WHERE EXISTS (SELECT 1 FROM support_messages m WHERE m.supporter_id=s.id) ORDER BY unread DESC, last_at DESC LIMIT 200`)).rows;
  res.set('Cache-Control', 'no-store').json({ online: await supportOnline(), agent: await supportAgent(), agents: await supportAgents(), threads });
}));
app.get('/api/svc/support/threads/:id(\\d+)', requireSvc, wrap(async (req, res) => {
  const sid = parseInt(req.params.id, 10); const after = parseInt(req.query.after, 10);
  const who = (await q('SELECT id, nick, first_name, last_name, email, phone, created_at FROM supporters WHERE id=$1', [sid])).rows[0];
  if (!who) return res.status(404).json({ error: 'Uživatel neexistuje' });
  const msgs = Number.isFinite(after)
    ? (await q('SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 AND id>$2 ORDER BY id', [sid, after])).rows
    : (await q('SELECT ' + SUP_COLS + ' FROM (SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 ORDER BY id DESC LIMIT 200) t ORDER BY id', [sid])).rows;
  await q("UPDATE support_messages SET read_by_agent=true WHERE supporter_id=$1 AND sender='user' AND read_by_agent=false", [sid]);
  const orders = Number(((await q('SELECT count(*)::int AS c FROM orders WHERE supporter_id=$1', [sid])).rows[0] || {}).c || 0);
  res.set('Cache-Control', 'no-store').json({ who, msgs, orders, online: ST.isOnline(sid), supportOnline: await supportOnline(), agent: await supportAgent() });
}));
app.post('/api/svc/support/threads/:id(\\d+)/send', requireSvc, wrap(async (req, res) => {
  const sid = parseInt(req.params.id, 10); const body = String((req.body || {}).body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'Prázdná zpráva' });
  const row = await agentSend(sid, body, parseInt((req.body || {}).order_id, 10), null, req.svc.name);
  res.json({ ok: true, msg: row });
}));
app.post('/api/svc/support/online', requireSvc, wrap(async (req, res) => {
  const on = !!(req.body || {}).online;
  if (on && (req.body || {}).agent !== undefined) await q("INSERT INTO app_settings (key,value) VALUES ('support_agent',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [String(req.body.agent || '').slice(0, 60)]);
  await q("INSERT INTO app_settings (key,value) VALUES ('support_online',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [on ? '1' : '0']);
  await log({ pid: null, name: req.svc.name || 'Velín' }, 'support_online', { online: on, via: 'velin' });
  res.json({ ok: true, online: on });
}));
app.get('/api/svc/support/file/:id(\\d+)', requireSvc, wrap(async (req, res) => {
  const r = (await q('SELECT file_name, file_type, file_data FROM support_messages WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
  if (!r || !r.file_data) return res.status(404).end();
  res.set('Content-Type', r.file_type || 'application/octet-stream').set('Cache-Control', 'private, max-age=3600').send(r.file_data);
}));
app.get('/admin/podpora/poll', requireAdmin, wrap(async (req, res) => {
  const unread = Number(((await q("SELECT count(*)::int AS c FROM support_messages WHERE sender='user' AND read_by_agent=false")).rows[0] || {}).c || 0);
  const sid = parseInt(req.query.u, 10) || 0; const after = parseInt(req.query.after, 10); let msgs = [];
  if (sid && Number.isFinite(after)) { msgs = (await q('SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 AND id>$2 ORDER BY id', [sid, after])).rows; if (msgs.length) await q("UPDATE support_messages SET read_by_agent=true WHERE supporter_id=$1 AND sender='user'", [sid]); }
  res.set('Cache-Control', 'no-store').json({ unread, msgs });
}));

// ── Podněty na vylepšení ──────────────────────────────────────────────
app.post('/api/suggestion', wrap(async (req, res) => {
  const s = readCookie(req, USER_COOKIE);
  if (!s || s.kind !== 'user') return res.status(401).json({ error: 'Přihlas se prosím.' });
  const text = String((req.body || {}).text || '').trim();
  if (text.length < 3) return res.status(400).json({ error: 'Napiš prosím alespoň pár slov.' });
  if (text.length > 3000) return res.status(400).json({ error: 'Text je příliš dlouhý (max. 3000 znaků).' });
  if (rateLimited('sug:' + s.sid, 10, 60 * 60e3)) return res.status(429).json({ error: 'Příliš mnoho podnětů za hodinu. Zkus to později.' });
  const page = String((req.body || {}).page || '').slice(0, 200) || null;
  const r = await q('INSERT INTO suggestions (supporter_id, body, page, device) VALUES ($1,$2,$3,$4) RETURNING id', [s.sid, text, page, ST.deviceOf(req.get('user-agent'))]);
  ST.track(req, s.sid, 'suggestion', { path: page, label: text.slice(0, 80) });
  await log({ name: s.nick || String(s.sid) }, 'suggestion_new', { id: r.rows[0].id, supporter_id: s.sid });
  res.json({ ok: true });
}));
app.get('/admin/suggestions', requireAdmin, wrap(async (req, res) => {
  const status = ['new', 'done', 'dismissed'].includes(req.query.status) ? req.query.status : '';
  const rows = (await q(`SELECT g.*, s.email, s.nick, s.first_name, s.last_name FROM suggestions g LEFT JOIN supporters s ON s.id=g.supporter_id ${status ? 'WHERE g.status=$1' : ''} ORDER BY (g.status='new') DESC, g.created_at DESC LIMIT 500`, status ? [status] : [])).rows;
  const counts = Object.fromEntries((await q('SELECT status, count(*)::int n FROM suggestions GROUP BY status')).rows.map(r => [r.status, r.n]));
  res.send(V.adminSuggestions({ admin: req.admin, rows, status, counts, msg: req.query.msg || '', holyosUrl: HOLYOS_URL }));
}));
app.post('/admin/suggestions/:id(\\d+)/status', requireAdmin, wrap(async (req, res) => {
  const st = ['new', 'done', 'dismissed'].includes(req.body.status) ? req.body.status : null;
  if (!st) return res.redirect('/admin/suggestions');
  await q('UPDATE suggestions SET status=$2, admin_note=$3, handled_at=CASE WHEN $2=\'new\' THEN NULL ELSE now() END, handled_by=CASE WHEN $2=\'new\' THEN NULL ELSE $4 END WHERE id=$1', [parseInt(req.params.id, 10), st, String(req.body.admin_note || '').trim().slice(0, 1000) || null, req.admin.name || req.admin.username || 'admin']);
  res.redirect('/admin/suggestions' + (req.body.back ? '?status=' + encodeURIComponent(req.body.back) : '') + (req.body.back ? '&' : '?') + 'msg=' + encodeURIComponent('Uloženo.'));
}));
app.post('/admin/suggestions/:id(\\d+)/delete', requireAdmin, wrap(async (req, res) => {
  await q('DELETE FROM suggestions WHERE id=$1', [parseInt(req.params.id, 10)]);
  res.redirect('/admin/suggestions?msg=' + encodeURIComponent('Podnět smazán.'));
}));
app.get('/admin/stats/live', requireAdmin, (req, res) => res.send(V.adminLive({ admin: req.admin, holyosUrl: HOLYOS_URL })));
app.get('/admin/stats/live.json', requireAdmin, wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await ST.loadLive(req.query.since)); }));
app.get('/admin/stats', requireAdmin, wrap(async (req, res) => {
  const days = req.query.days === 'all' ? 3650 : Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 3650));
  res.send(V.adminStats({ admin: req.admin, data: await ST.loadOverview(days), days, holyosUrl: HOLYOS_URL }));
}));
app.get('/admin/stats/user/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
  const days = req.query.days === 'all' ? 3650 : Math.max(1, Math.min(parseInt(req.query.days, 10) || 90, 3650));
  const data = await ST.loadUser(Number(req.params.id), days);
  if (!data) return res.status(404).send(V.errorPage('Uživatel nenalezen', 'Takový uživatel neexistuje.', '/admin/stats'));
  res.send(V.adminStatsUser({ admin: req.admin, data, days, holyosUrl: HOLYOS_URL }));
}));
app.get('/admin/transfers', requireAdmin, wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const rows = (await q("SELECT t.*, s.first_name, s.last_name, s.email, s.nick FROM support_transfers t JOIN supporters s ON s.id=t.supporter_id " + (status ? 'WHERE t.status=$1 ' : '') + "ORDER BY (t.status='pending') DESC, t.created_at DESC LIMIT 500", status ? [status] : [])).rows;
  const counts = {}; (await q('SELECT status, count(*)::int AS c FROM support_transfers GROUP BY status')).rows.forEach(r => { counts[r.status] = r.c; });
  res.send(V.adminTransfers({ admin: req.admin, rows, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, status, counts, rate: await eurRate(), tfEv: await tfEventsFor(rows.map(t => t.id)) }));
}));
app.post('/admin/transfers/:id(\\d+)/approve', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const adminNote = String(req.body.admin_note || '').trim().slice(0, 300) || null;
  const who = req.admin.name || req.admin.username || null;
  const cur0 = (await q("SELECT kind, dc_amount FROM support_transfers WHERE id=$1 AND status='pending'", [id])).rows[0];
  if (!cur0) return res.redirect('/admin/transfers?msg=' + encodeURIComponent('Žádost už byla zpracována.'));
  const dc = Math.round(Number(String(req.body.dc || '').replace(/\s/g, '').replace(',', '.')) * 100) / 100;
  if (!(dc > 0)) return res.redirect('/admin/transfers?msg=' + encodeURIComponent('Zadej počet DC větší než 0.'));
  const t = (await q("UPDATE support_transfers SET status='approved', dc_amount=$2, admin_note=$3, processed_at=now(), processed_by=$4 WHERE id=$1 AND status='pending' RETURNING *", [id, dc, adminNote, who])).rows[0];
  if (!t) return res.redirect('/admin/transfers?msg=' + encodeURIComponent('Žádost už byla zpracována.'));
  const cr = await q('INSERT INTO credits (supporter_id, amount_czk, note) VALUES ($1,$2,$3) RETURNING id', [t.supporter_id, dc, 'Převod ' + (t.kind === 'withdrawal' ? 'z výběru' : 'z podpory') + ' ze starého systému (žádost #' + t.id + ')']);
  await q('UPDATE support_transfers SET credit_id=$2 WHERE id=$1', [t.id, cr.rows[0].id]);
  if (Number(cur0.dc_amount) !== dc) await tfEvent(t.id, 'amount_changed', who, Number(cur0.dc_amount).toLocaleString('cs-CZ') + ' → ' + dc.toLocaleString('cs-CZ') + ' DC');
  await tfEvent(t.id, 'approved', who, 'připsáno ' + dc.toLocaleString('cs-CZ') + ' DC' + (adminNote ? ' — ' + adminNote : ''));
  await log(req.admin, 'support_transfer_approve', { id: t.id, supporter_id: t.supporter_id, dc });
  res.redirect('/admin/transfers?msg=' + encodeURIComponent('Převod #' + t.id + ' schválen, připsáno ' + dc.toLocaleString('cs-CZ') + ' DC.'));
}));
app.post('/admin/transfers/:id(\\d+)/reject', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const adminNote = String(req.body.admin_note || '').trim().slice(0, 300) || null;
  const t = (await q("UPDATE support_transfers SET status='rejected', admin_note=$2, processed_at=now(), processed_by=$3 WHERE id=$1 AND status='pending' RETURNING id, supporter_id", [id, adminNote, req.admin.name || req.admin.username || null])).rows[0];
  if (t) { await log(req.admin, 'support_transfer_reject', { id: t.id, supporter_id: t.supporter_id }); await tfEvent(t.id, 'rejected', req.admin.name || req.admin.username || null, adminNote); }
  res.redirect('/admin/transfers?msg=' + encodeURIComponent(t ? 'Žádost #' + t.id + ' zamítnuta.' : 'Žádost už byla zpracována.'));
}));
app.get('/admin/orders', requireAdmin, wrap(async (req, res) => {
  const status = ['new', 'confirmed', 'cancelled'].includes(req.query.status) ? req.query.status : '';
  const pctKeys = new Set((await loadServices()).filter(x => x.mode === 'percent').map(x => x.key));
  const rows = (await q("SELECT o.*, s.first_name, s.last_name, s.email, s.nick FROM orders o JOIN supporters s ON s.id=o.supporter_id " + (status ? 'WHERE o.status=$1 ' : '') + "ORDER BY (o.status='new') DESC, o.created_at DESC LIMIT 500", status ? [status] : [])).rows;
  rows.forEach(o => { o.no_price = pctKeys.has(o.service_key); });
  // Faktury k objednávkám (záloha + finální) z HolyOS: stav, odeslání e-mailem
  let invErr = '';
  try {
    const r = await holyosFetch('GET', '/api/auth/bs2/invoices?refs=' + rows.map(o => o.id).join(','));
    if (r.ok) {
      const m = await r.json(); rows.forEach(o => { o.inv = m[String(o.id)] || {}; });
      // Sjednocení: zrušená objednávka v BS2 nesmí mít aktivní zálohu v HolyOS (zruší se nezaplacená záloha)
      for (const o of rows) {
        const pf = o.inv && o.inv.proforma;
        if (o.status === 'cancelled' && pf && pf.status !== 'cancelled' && pf.status !== 'paid') {
          try { const rc = await holyosFetch('POST', '/api/auth/bs2/invoice/cancel', { ref: o.id }, 8000); if (rc.ok) pf.status = 'cancelled'; } catch (e) { /* zkusí se příště */ }
        }
      }
    } else invErr = 'HolyOS ' + r.status;
  } catch (e) { invErr = e.message; }
  const counts = {}; (await q('SELECT status, count(*)::int AS c FROM orders GROUP BY status')).rows.forEach(r => { counts[r.status] = r.c; });
  res.send(V.adminOrders({ admin: req.admin, rows, msg: req.query.msg || (invErr ? 'Faktury se nepodařilo načíst z HolyOS (' + invErr + ').' : ''), holyosUrl: HOLYOS_URL, status, counts }));
}));
// PDF faktury z HolyOS (proxy s tokenem BS2)
app.get('/admin/orders/invoice/:id(\\d+)/pdf', requireAdmin, wrap(async (req, res) => {
  const r = await holyosFetch('GET', '/api/auth/bs2/invoice/' + parseInt(req.params.id, 10) + '/pdf');
  if (!r.ok) return res.status(502).send(V.errorPage('Faktura', 'Fakturu se nepodařilo načíst z HolyOS (' + r.status + ').', '/admin/orders'));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': r.headers.get('content-disposition') || 'inline' }).send(Buffer.from(await r.arrayBuffer()));
}));
// Ruční odeslání faktury e-mailem odběrateli
app.post('/admin/orders/invoice/:id(\\d+)/send', requireAdmin, wrap(async (req, res) => {
  let msg = '';
  try { const r = await holyosFetch('POST', '/api/auth/bs2/invoice/' + parseInt(req.params.id, 10) + '/send'); const j = await r.json().catch(() => ({})); msg = r.ok ? 'Faktura odeslána na ' + (j.to || 'e-mail odběratele') + '.' : 'Odeslání selhalo: ' + (j.error || r.status); }
  catch (e) { msg = 'Odeslání selhalo: ' + e.message; }
  await log(req.admin, 'invoice_send', { invoice_id: req.params.id });
  res.redirect('/admin/orders?msg=' + encodeURIComponent(msg));
}));
// Vystavení zálohové faktury ručně (objednávky vzniklé před zapnutím fakturace)
app.post('/admin/orders/:id(\\d+)/invoice', requireAdmin, wrap(async (req, res) => {
  const o = (await q('SELECT o.*, s.first_name, s.last_name, s.email, s.nick, s.phone FROM orders o JOIN supporters s ON s.id=o.supporter_id WHERE o.id=$1', [parseInt(req.params.id, 10)])).rows[0];
  let msg = 'Objednávka nenalezena.';
  if (o) {
    try {
      const r = await holyosFetch('POST', '/api/auth/bs2/invoice/proforma', { ref: o.id, currency: o.currency, customer: invCustomer(o), items: orderInvItems(o.product_name, o.price_net, o.dc_used), note: 'Objednávka produktu.', send: false });
      const j = await r.json().catch(() => ({}));
      msg = r.ok ? 'Zálohová faktura ' + (j.invoice_number || '') + (j.existing ? ' už existovala.' : ' je vystavena a ještě NEODESLANÁ — zkontroluj ji (ikona 📄) a pak ji odešli tlačítkem Odeslat.') : 'Vystavení selhalo: ' + (j.error || j.reason || r.status);
    } catch (e) { msg = 'Vystavení selhalo: ' + e.message; }
  }
  res.redirect('/admin/orders?msg=' + encodeURIComponent(msg));
}));
app.post('/admin/orders/:id(\\d+)/confirm', requireAdmin, wrap(async (req, res) => {
  const oid = parseInt(req.params.id, 10);
  const cur0 = (await q("SELECT * FROM orders WHERE id=$1 AND status='new'", [oid])).rows[0];
  if (!cur0) return res.redirect('/admin/orders');
  if (cur0.kind === 'service') {
    // Služba: žádný stroj ani provize. U poptávky (cena 0) admin zadá cenu a případné DC.
    const num = (x) => { const t = String(x == null ? '' : x).replace(/\s/g, '').replace(',', '.'); const n = Number(t); return t !== '' && isFinite(n) && n >= 0 ? n : null; };
    let price = Number(cur0.price_net), dc = Number(cur0.dc_used);
    const svc = (await loadServices()).find(x => x.key === cur0.service_key) || {};
    if (svc.mode === 'percent') {
      // cena = % z obratu (nevyčísluje se); admin může uplatnit DC, která uživatel zaplatil kreditem
      const rate = cur0.currency === 'EUR' ? await eurRate() : 1;
      const bal = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [cur0.supporter_id])).rows[0] || {}).b || 0) / rate;
      dc = Math.min(Math.floor(num(req.body.dc) || 0), Math.floor(bal));
      if (dc > 0) await q('INSERT INTO credits (supporter_id, amount_czk, note, order_id) VALUES ($1,$2,$3,$4)', [cur0.supporter_id, -Math.round(dc * rate * 100) / 100, 'Uplatnění DC: ' + cur0.product_name + ' (objednávka #' + oid + ')', oid]);
      await q("UPDATE orders SET status='confirmed', decided_at=now(), dc_used=$2 WHERE id=$1", [oid, dc]);
      await log(req.admin, 'order_confirm', { id: oid, service: cur0.service_key, dc });
      return res.redirect('/admin/orders?msg=' + encodeURIComponent('Služba #' + oid + ' potvrzena.'));
    }
    else if (!(price > 0)) {
      const pr = num(req.body.price);
      if (!(pr > 0)) return res.redirect('/admin/orders?msg=' + encodeURIComponent('Zadej cenu bez DPH pro nacenění (číslo větší než 0).'));
      price = pr;
      const rate = cur0.currency === 'EUR' ? await eurRate() : 1;
      const bal = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [cur0.supporter_id])).rows[0] || {}).b || 0) / rate;
      dc = Math.min(Math.floor(num(req.body.dc) || 0), Math.floor(price), Math.floor(bal));
      if (dc > 0) await q('INSERT INTO credits (supporter_id, amount_czk, note, order_id) VALUES ($1,$2,$3,$4)', [cur0.supporter_id, -Math.round(dc * rate * 100) / 100, 'Uplatnění DC: ' + cur0.product_name + ' (objednávka #' + oid + ')', oid]);
    }
    await q("UPDATE orders SET status='confirmed', decided_at=now(), price_net=$2, dc_used=$3, final_net=$4 WHERE id=$1", [oid, price, dc, price - dc]);
    await log(req.admin, 'order_confirm', { id: oid, service: cur0.service_key, price, dc });
    return res.redirect('/admin/orders?msg=' + encodeURIComponent('Služba #' + oid + ' potvrzena.'));
  }
  const o = (await q("UPDATE orders SET status='confirmed', decided_at=now() WHERE id=$1 AND status='new' RETURNING *", [oid])).rows[0];
  if (!o) return res.redirect('/admin/orders');
  const s = await loadSupporter(o.supporter_id);
  const rate = o.currency === 'EUR' ? await eurRate() : 1;
  const priceCzk = Math.round(Number(o.final_net) * rate * 100) / 100;
  let m = null; try { m = ((await loadProducts()).items || []).find(p => p.id === o.holyos_item_id) || null; } catch (e) { /* bez parametrů */ }
  const ins = await q('INSERT INTO purchases (supporter_id, holyos_item_id, product_name, price_czk, note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [s.id, o.holyos_item_id, o.product_name, priceCzk, 'Objednávka #' + o.id + (Number(o.dc_used) > 0 ? ' · uplatněno ' + Number(o.dc_used).toLocaleString('cs-CZ') + ' DC' : '')]);
  const creditMsg = await grantSellerCredit(s, m ? { id: m.id } : (o.holyos_item_id ? { id: o.holyos_item_id } : null), priceCzk, o.product_name, ins.rows[0].id);
  if (['standard', 'new'].includes(s.user_type)) await q("UPDATE supporters SET user_type='owner', updated_at=now() WHERE id=$1", [s.id]);
  await log(req.admin, 'order_confirm', { id: o.id });
  res.redirect('/admin/orders?msg=' + encodeURIComponent('Objednávka #' + o.id + ' potvrzena, nákup zapsán.' + creditMsg));
}));
app.post('/admin/orders/:id(\\d+)/cancel', requireAdmin, wrap(async (req, res) => {
  const o = (await q("UPDATE orders SET status='cancelled', decided_at=now() WHERE id=$1 AND status='new' RETURNING id", [parseInt(req.params.id, 10)])).rows[0];
  if (o) { await q('DELETE FROM credits WHERE order_id=$1', [o.id]); await log(req.admin, 'order_cancel', { id: o.id }); holyosFetch('POST', '/api/auth/bs2/invoice/cancel', { ref: o.id }, 10000).catch((e) => console.warn('[bs2] zrušení zálohy:', e.message)); }
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
  let timeline = []; try { timeline = await loadTimeline(s); } catch (e) { console.warn('[bs2] timeline:', e.message); }
  res.send(V.adminSupporterDetail({ admin: req.admin, s, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, firstLine, purchases, machines, credits, timeline }));
}));
// Kompletní časová osa aktivity uživatele: přihlášení, chování na webu, chat, e-maily, objednávky, převody, DC, podněty, zásahy admina
const EV_TXT = { login: 'Přihlášení', login_fail: 'Neúspěšné přihlášení', logout: 'Odhlášení', consent: 'Souhlas s VOP a GDPR', reset_request: 'Žádost o obnovu hesla', suggestion: 'Podnět na vylepšení', pageview: 'Zobrazil stránku', click: 'Klikl', section: 'Četl sekci', interact: 'Použil prvek' };
async function loadTimeline(s) {
  const id = s.id, T = [];
  const add = (at, kind, text, extra) => { if (at) T.push(Object.assign({ at, kind, text }, extra || {})); };
  (await q("SELECT type, path, label, device, ip, created_at FROM user_events WHERE supporter_id=$1 AND type NOT IN ('ping','time','scroll') ORDER BY created_at DESC LIMIT 600", [id])).rows.forEach(e => {
    const login = ['login', 'login_fail', 'logout', 'consent', 'reset_request'].includes(e.type);
    add(e.created_at, login ? 'login' : 'web', (EV_TXT[e.type] || e.type) + (e.label ? ': ' + e.label : '') + (e.path && !login ? ' (' + e.path + ')' : ''), { meta: [e.device, login ? e.ip : null].filter(Boolean).join(' · ') });
  });
  (await q('SELECT sender, agent_name, body, file_name, order_id, created_at FROM support_messages WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 300', [id])).rows.forEach(m =>
    add(m.created_at, 'chat', (m.sender === 'agent' ? 'Podpora' + (m.agent_name ? ' (' + m.agent_name + ')' : '') + ' → uživateli: ' : 'Uživatel → podpoře: ') + String(m.body || '').slice(0, 300) + (m.file_name ? ' 📎 ' + m.file_name : '')));
  (await q('SELECT subject, status, error, to_email, created_at FROM mail_log WHERE supporter_id=$1 OR lower(to_email)=lower($2) ORDER BY created_at DESC LIMIT 200', [id, s.email || ''])).rows.forEach(m =>
    add(m.created_at, 'mail', 'E-mail ' + (m.status === 'sent' ? 'odeslán' : 'NEODESLÁN') + ': ' + (m.subject || '(bez předmětu)'), { meta: m.to_email + (m.error ? ' · ' + m.error : '') }));
  (await q('SELECT id, product_name, status, created_at, decided_at, final_net, currency FROM orders WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows.forEach(o => {
    add(o.created_at, 'order', 'Objednávka #' + o.id + ': ' + o.product_name + ' (' + Number(o.final_net).toLocaleString('cs-CZ') + ' ' + (o.currency === 'EUR' ? '€' : 'Kč') + ')');
    if (o.decided_at) add(o.decided_at, 'order', 'Objednávka #' + o.id + ' ' + (o.status === 'confirmed' ? 'potvrzena' : o.status === 'cancelled' ? 'zrušena' : o.status));
  });
  (await q('SELECT id, kind, dc_amount, status, created_at, processed_at, processed_by FROM support_transfers WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows.forEach(t => {
    add(t.created_at, 'transfer', 'Žádost o převod #' + t.id + ': ' + Number(t.dc_amount).toLocaleString('cs-CZ') + ' DC (' + (t.kind === 'withdrawal' ? 'z výběru' : 'z podpory') + ')');
    if (t.processed_at) add(t.processed_at, 'transfer', 'Převod #' + t.id + ' ' + (t.status === 'approved' ? 'schválen' : 'zamítnut') + (t.processed_by ? ' (' + t.processed_by + ')' : ''));
  });
  (await q('SELECT amount_czk, note, created_at FROM credits WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 150', [id])).rows.forEach(c =>
    add(c.created_at, 'dc', 'DC ' + (Number(c.amount_czk) > 0 ? '+' : '') + Number(c.amount_czk).toLocaleString('cs-CZ') + ': ' + (c.note || '—')));
  (await q('SELECT body, status, created_at FROM suggestions WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 50', [id])).rows.forEach(x => add(x.created_at, 'suggestion', 'Podnět: ' + String(x.body).slice(0, 300)));
  (await q('SELECT created_at, used_at FROM password_resets WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 30', [id])).rows.forEach(r => { add(r.created_at, 'login', 'Odkaz na obnovu hesla vygenerován'); if (r.used_at) add(r.used_at, 'login', 'Heslo změněno přes odkaz'); });
  (await q("SELECT package, status, amount_czk, created_at, paid_at FROM location_orders WHERE supporter_id=$1 ORDER BY created_at DESC LIMIT 50", [id])).rows.forEach(o => { add(o.created_at, 'order', 'Online objednávka: balíček ' + o.package + ' (' + o.amount_czk + ' Kč)'); if (o.paid_at) add(o.paid_at, 'order', 'Online objednávka zaplacena: ' + o.package); });
  (await q("SELECT admin_name, action, detail, created_at FROM admin_log WHERE detail->>'supporter_id' = $1 ORDER BY created_at DESC LIMIT 100", [String(id)])).rows.forEach(a => add(a.created_at, 'admin', 'Správa: ' + a.action + (a.admin_name ? ' (' + a.admin_name + ')' : '')));
  if (s.created_at) add(s.created_at, 'login', 'Účet založen'); if (s.activated_at) add(s.activated_at, 'login', 'Účet aktivován');
  T.sort((x, y) => new Date(y.at) - new Date(x.at));
  return T.slice(0, 1000);
}
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
  if (['standard', 'new'].includes(s.user_type)) await q("UPDATE supporters SET user_type='owner', updated_at=now() WHERE id=$1", [s.id]);
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
    // Balíček Prověření lokality (ruční nastavení/testování): zvolený balíček → platnost 12 měsíců, pokud chybí nebo vypršela
    if (req.body.location_package !== undefined) {
      const lp = ['basic', 'plus', 'premium'].includes(String(req.body.location_package)) ? String(req.body.location_package) : null;
      if (lp) await q("UPDATE supporters SET location_package=$2, location_expires_at=CASE WHEN location_expires_at IS NULL OR location_expires_at < now() THEN now() + interval '12 months' ELSE location_expires_at END WHERE id=$1", [s.id, lp]);
      else await q('UPDATE supporters SET location_package=NULL WHERE id=$1', [s.id]);
    }
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
// ── AI chat (admin nastavení + zkušební chat) ─────────────────────────────
async function aiProductsText() {
  try {
    const out = await loadProducts(); const set = await offeredSet();
    return (out.items || []).filter(p => set.has(p.id)).map(p => {
      const parts = [];
      if (p.price_czk != null) parts.push(Number(p.price_czk).toLocaleString('cs-CZ') + ' Kč');
      if (p.price_eur != null) parts.push(Number(p.price_eur).toLocaleString('cs-CZ') + ' €');
      return '- ' + p.name + (parts.length ? ': ' + parts.join(' / ') : '');
    }).join('\n');
  } catch (e) { return ''; }
}
async function renderAiPage(req, cfg, extra) {
  return V.adminAiChat({ admin: req.admin, cfg, models: AI.MODELS, tones: AI.TONES, limits: AI.LIMITS, holyosUrl: HOLYOS_URL, keyOk: !!process.env.ANTHROPIC_API_KEY, preview: AI.buildSystem(cfg, await aiProductsText()), ...extra });
}
app.get('/admin/ai-chat', requireAdmin, wrap(async (req, res) => {
  res.send(await renderAiPage(req, await AI.loadConfig(), { msg: req.query.msg || '' }));
}));
app.post('/admin/ai-chat', requireAdmin, wrap(async (req, res) => {
  const { cfg, errors } = AI.sanitize(req.body || {});
  // Překročený limit = nic se neuloží ani neořízne; stránka se vrátí s vyplněnými hodnotami a seznamem chyb
  if (errors.length) return res.status(400).send(await renderAiPage(req, cfg, { errors }));
  await AI.saveConfig(cfg);
  await log(req.admin, 'ai_chat_save', null);
  res.redirect('/admin/ai-chat?msg=' + encodeURIComponent('Nastavení AI chatu uloženo.'));
}));
// ── AI chat pro uživatele (plovoucí okno na stránkách) ──
const aiHits = new Map(); // sid → časy zpráv (limit 30 / 10 min)
async function aiChatUser(req, res) {
  const s = readCookie(req, USER_COOKIE);
  if (!s || s.kind !== 'user') { res.status(401).json({ error: 'Pro chat se prosím přihlas.' }); return null; }
  const r = await q('SELECT id, status FROM supporters WHERE id=$1', [s.sid]);
  if (!r.rows[0] || r.rows[0].status !== 'active') { res.status(401).json({ error: 'Pro chat se prosím přihlas.' }); return null; }
  return s;
}
app.get('/api/ai-chat/config', wrap(async (req, res) => {
  const s = readCookie(req, USER_COOKIE);
  if (!s || s.kind !== 'user') return res.status(401).json({ enabled: false });
  const cfg = await AI.loadConfig();
  const keyOk = !!process.env.ANTHROPIC_API_KEY, enabled = !!cfg.enabled && keyOk;
  // Správce (platné přihlášení do adminu) vidí tlačítko i když chat nejede — a v něm důvod, ať ví, co zapnout
  const a = readCookie(req, ADMIN_COOKIE), isAdmin = !!(a && a.kind === 'admin' && isAllowedAdmin(a));
  const reason = enabled ? '' : (!cfg.enabled ? 'Chat je zatím vypnutý. Zapni ho v Admin → AI chat (políčko „Chat je zapnutý na stránkách") a ulož.' : 'Na serveru BS2 chybí proměnná ANTHROPIC_API_KEY (Railway → projekt BS2 → Variables).');
  res.set('Cache-Control', 'no-store').json({ enabled, name: cfg.name, greeting: cfg.greeting, reason: isAdmin ? reason : '' });
}));
app.post('/api/ai-chat', wrap(async (req, res) => {
  const s = await aiChatUser(req, res); if (!s) return;
  const cfg = await AI.loadConfig();
  if (!cfg.enabled) return res.status(403).json({ error: 'Chat je momentálně vypnutý.' });
  const now = Date.now(), hits = (aiHits.get(s.sid) || []).filter(t => now - t < 10 * 60e3);
  if (hits.length >= 30) return res.status(429).json({ error: 'Příliš mnoho zpráv, zkus to prosím za několik minut.' });
  const msgs = (Array.isArray(req.body && req.body.messages) ? req.body.messages : []).slice(-12)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift(); // historie musí začínat dotazem uživatele
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Prázdný dotaz.' });
  hits.push(now); aiHits.set(s.sid, hits);
  // Osobní údaje (zůstatek DC, objednávky) chat nemá → odkáže na sekce, nevymýšlí si
  const system = AI.buildSystem(cfg, await aiProductsText()) +
    '\n\nKONTEXT: Mluvíš s přihlášeným uživatelem. Jeho osobní údaje (zůstatek Discount Creditu, objednávky, doporučení) NEMÁŠ k dispozici — nikdy je neuváděj ani neodhaduj, odkaž ho na sekce Discount Credit, Moje svoboda, Moje doporučení nebo Můj účet.';
  try {
    const out = await AI.chat(cfg, system, msgs);
    if (out.error) { console.warn('[bs2] AI chat:', out.error); return res.status(502).json({ error: 'Chat je teď nedostupný, zkus to prosím za chvíli.' }); }
    res.json({ reply: out.reply });
  } catch (e) { console.warn('[bs2] AI chat výjimka:', e.message); res.status(502).json({ error: 'Chat je teď nedostupný, zkus to prosím za chvíli.' }); }
}));
app.post('/admin/ai-chat/test', requireAdmin, wrap(async (req, res) => {
  const cfg = await AI.loadConfig();
  const msgs = (Array.isArray(req.body && req.body.messages) ? req.body.messages : []).slice(-20)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.json({ error: 'Prázdný dotaz.' });
  try { res.json(await AI.chat(cfg, AI.buildSystem(cfg, await aiProductsText()), msgs)); }
  catch (e) { res.json({ error: 'Chyba volání AI: ' + e.message }); }
}));
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

migrate().then(() => loadPricing()).then(() => BUILD.init().then(b => V.setBuild(b)).catch(e => console.warn('[bs2] verze:', e.message))).then(() => app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT}`)))
  .catch((e) => { console.error('[bs2] DB migrace selhala:', e.message); app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT} (BEZ DB — nastav DATABASE_URL)`)); });
