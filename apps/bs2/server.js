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
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false, limit: '8mb' }));
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isHttps(req)) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CSP: cizí skripty se nespustí, formuláře nejdou odeslat jinam, stránku nelze vložit do iframe. Inline skripty/handlery aplikace jsou povoleny ('unsafe-inline').
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
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
  req.user = u; next();
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
  try { const r = await q("SELECT count(*)::int AS n FROM supporters WHERE status='active'"); _members = { n: r.rows[0].n, at: Date.now() }; } catch (e) { _members = { n: null, at: Date.now() }; }
  return _members.n;
}
// Favicon / logo (SVG, cache 1 den)
app.get('/favicon.svg', (req, res) => { res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(require('./logo').logoSvg(64, 'f')); });
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.get('/img/pradlomat.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(require('path').join(__dirname, 'pradlomat.webp')));
app.get('/img/pradlomat-mini.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(require('path').join(__dirname, 'pradlomat-mini.webp')));
app.get('/login', wrap(async (req, res) => {
  if (readCookie(req, USER_COOKIE)) return res.redirect('/');
  res.send(V.loginPage({ members: await memberCount(), info: req.query.activated ? 'Účet je aktivní, můžeš se přihlásit.' : req.query.reset ? 'Heslo je změněné, můžeš se přihlásit.' : req.query.out ? 'Byl jsi odhlášen.' : '' }));
}));
// Zapomenuté heslo — zatím bez automatického e-mailu: žádost se zapíše do admin_log, Tomáš/Jan ji vyřídí ručně (reset v adminu)
app.get('/forgot', (req, res) => res.send(V.forgotPage()));
// Odeslání e-mailu přes HolyOS (Graph send-as); BS2 samo e-maily neodesílá.
async function sendBs2Mail({ to, subject, body, link, linkLabel }) {
  const secret = process.env.BS2_SSO_SECRET; if (!secret) throw new Error('Chybí BS2_SSO_SECRET');
  const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, secret, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + '/api/auth/bs2/send-mail', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body, link, linkLabel }), signal: AbortSignal.timeout(20000) });
  console.log('[bs2] HolyOS send-mail odpověď ' + r.status);
  if (!r.ok) throw new Error('HolyOS send-mail ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
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
  if (tooMany(ip)) return res.status(429).send(V.loginPage({ error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' }));
  const login = String(req.body.login || '').trim(), password = String(req.body.password || '');
  const r = await q('SELECT * FROM supporters WHERE lower(email)=lower($1) OR lower(nick)=lower($1) LIMIT 1', [login]);
  const u = r.rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) return res.status(429).send(V.loginPage({ error: 'Účet je dočasně zamčený po opakovaných neúspěšných pokusech. Zkus to za ' + Math.ceil((new Date(u.locked_until) - Date.now()) / 60000) + ' min.', login }));
  if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
    noteFail(ip);
    ST.track(req, u && u.id, 'login_fail', { meta: { known: !!u, activated: !!(u && u.password_hash) } });
    if (u) await q("UPDATE supporters SET failed_logins=COALESCE(failed_logins,0)+1, locked_until=CASE WHEN COALESCE(failed_logins,0)+1>=10 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1", [u.id]).catch(() => {});
    const hint = u && !u.password_hash ? 'Účet ještě není aktivovaný. Otevři bestseries2.cz/activate a nastav si heslo.' : 'Nesprávný nick/e-mail nebo heslo.';
    return res.status(401).send(V.loginPage({ error: hint, login, members: await memberCount() }));
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
app.get('/logout', (req, res) => { try { const ls = readCookie(req, USER_COOKIE); if (ls && ls.kind === 'user') ST.track(req, ls.sid, 'logout'); } catch (e) {} res.clearCookie(USER_COOKIE); res.clearCookie(ADMIN_COOKIE); res.redirect('/login?out=1'); });

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
const TRACK_TYPES = ['pageview', 'click', 'time', 'scroll', 'section', 'interact'];
app.post('/api/track', (req, res) => {
  try {
    const s = readCookie(req, USER_COOKIE); const b = req.body || {};
    if (!s || s.kind !== 'user' || !TRACK_TYPES.includes(b.type) || rateLimited('trk:' + s.sid, 900, 60e3)) return res.status(204).end();
    let meta = b.meta && typeof b.meta === 'object' ? b.meta : null; if (meta && JSON.stringify(meta).length > 1200) meta = null;
    ST.track(req, s.sid, b.type, { sid: b.sid, path: b.path, label: b.label, meta });
  } catch (e) { /* ignoruj */ }
  res.status(204).end();
});
app.get('/vop', (req, res) => res.send(V.vopPage()));
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
  const balance = req.user.currency === 'EUR' ? sum / (await eurRate()) : sum;
  const cur = req.user.currency === 'EUR' ? 'EUR' : 'CZK', rateV = cur === 'EUR' ? await eurRate() : 1;
  const services = (await loadServices()).filter(x => x.offered).map(x => ({ ...x, net: (x.mode === 'percent' || x.quote || x.price_czk == null) ? null : Math.round(Number(x.price_czk) / rateV * 100) / 100, per_year_net: x.per_year_czk ? Math.round(Number(x.per_year_czk) / rateV) : null }));
  // Služby a záruka jdou objednat až po koupi prádlomatu (potvrzený nákup v purchases, nebo typ „Koupil prádlomat")
  const hasMachine = req.user.user_type === 'owner' || Number(((await q('SELECT count(*)::int AS c FROM purchases WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).c || 0) > 0;
  res.send(V.supporterProducts(req.user, offers, { balance, msg: req.query.msg || '', services, hasMachine }));
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
    const balS = Number(((await q('SELECT COALESCE(SUM(amount_czk),0) AS b FROM credits WHERE supporter_id=$1', [req.user.id])).rows[0] || {}).b || 0) / rateS;
    const dcS = Math.min(Math.max(0, parseInt(req.body.dc, 10) || 0), roomS, Math.floor(balS));
    const insS = await q("INSERT INTO orders (supporter_id, product_name, currency, price_net, dc_used, final_net, kind, service_key) VALUES ($1,$2,$3,$4,$5,$6,'service',$7) RETURNING id", [req.user.id, nameS, cur, netS, dcS, netS - dcS, sv.key]);
    if (dcS > 0) await q('INSERT INTO credits (supporter_id, amount_czk, note, order_id) VALUES ($1,$2,$3,$4)', [req.user.id, -Math.round(dcS * rateS * 100) / 100, 'Uplatnění DC: ' + nameS + ' (objednávka #' + insS.rows[0].id + ')', insS.rows[0].id]);
    await log({ name: req.user.nick }, 'order_new', { id: insS.rows[0].id, service: sv.key, dc: dcS });
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
const SUP_COLS = 'id, supporter_id, sender, agent_name, body, read_by_agent, read_by_user, created_at, file_name, file_type, file_size';
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
const USER_TYPES = ['new', 'standard', 'owner', 'seller'];
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
  res.send(V.adminSupport({ admin: req.admin, online, threads, who, msgs, holyosUrl: HOLYOS_URL, msg: req.query.msg || '', agents: await supportAgents(), agent: await supportAgent() }));
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
app.post('/admin/podpora/:id(\\d+)/send', requireAdmin, supUpload.single('file'), wrap(async (req, res) => {
  const sid = parseInt(req.params.id, 10); const body = String((req.body || {}).body || '').trim().slice(0, 4000);
  const chk = checkedFile(req.file || null); if (!chk.ok) return res.status(400).json({ error: chk.error }); const f = chk.f;
  let row = null;
  if (body || f) row = (await q('INSERT INTO support_messages (supporter_id, sender, agent_name, body, read_by_agent, file_name, file_type, file_size, file_data) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8) RETURNING ' + SUP_COLS, [sid, 'agent', (await supportAgent()) || req.admin.name || 'Podpora', body || (f ? '📎 ' + f.originalname : ''), f ? f.originalname.slice(0, 200) : null, f ? f.mimetype : null, f ? f.size : null, f ? f.buffer : null])).rows[0];
  if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true, msg: row });
  res.redirect('/admin/podpora?u=' + sid);
}));
app.get('/admin/podpora/poll', requireAdmin, wrap(async (req, res) => {
  const unread = Number(((await q("SELECT count(*)::int AS c FROM support_messages WHERE sender='user' AND read_by_agent=false")).rows[0] || {}).c || 0);
  const sid = parseInt(req.query.u, 10) || 0; const after = parseInt(req.query.after, 10); let msgs = [];
  if (sid && Number.isFinite(after)) { msgs = (await q('SELECT ' + SUP_COLS + ' FROM support_messages WHERE supporter_id=$1 AND id>$2 ORDER BY id', [sid, after])).rows; if (msgs.length) await q("UPDATE support_messages SET read_by_agent=true WHERE supporter_id=$1 AND sender='user'", [sid]); }
  res.set('Cache-Control', 'no-store').json({ unread, msgs });
}));

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
  const counts = {}; (await q('SELECT status, count(*)::int AS c FROM orders GROUP BY status')).rows.forEach(r => { counts[r.status] = r.c; });
  res.send(V.adminOrders({ admin: req.admin, rows, msg: req.query.msg || '', holyosUrl: HOLYOS_URL, status, counts }));
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

migrate().then(() => BUILD.init().then(b => V.setBuild(b)).catch(e => console.warn('[bs2] verze:', e.message))).then(() => app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT}`)))
  .catch((e) => { console.error('[bs2] DB migrace selhala:', e.message); app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT} (BEZ DB — nastav DATABASE_URL)`)); });
