// BS2 — soukromá sekce Best Series. Samostatná aplikace (vlastní Railway služba, vlastní doména),
// mechanicky oddělená od HolyOS: žádná sdílená DB ani kód. S HolyOS ji pojí jen SSO:
//   HolyOS → GET /api/auth/sso/bs2 → redirect sem na /sso?t=<JWT podepsaný BS2_SSO_SECRET, 2 min>
//   zde se token ověří a založí vlastní cookie session (BS2_SESSION_SECRET, 12 h).
// Env: PORT, BS2_SSO_SECRET (stejný jako v HolyOS), BS2_SESSION_SECRET, HOLYOS_URL (odkaz zpět),
//      BS2_ALLOWED_PIDS (volitelné — čárkami person id z HolyOS, druhá pojistka na této straně)

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');

const PORT = process.env.PORT || 3100;
const SSO_SECRET = process.env.BS2_SSO_SECRET;
const SESSION_SECRET = process.env.BS2_SESSION_SECRET || SSO_SECRET;
const HOLYOS_URL = (process.env.HOLYOS_URL || 'https://app.holyos.cz').replace(/\/$/, '');
const ALLOWED_PIDS = String(process.env.BS2_ALLOWED_PIDS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
const COOKIE = 'bs2_session';

if (!SSO_SECRET) console.warn('[bs2] POZOR: BS2_SSO_SECRET není nastaven — SSO nebude fungovat.');

const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json());

// ── Session helpers ─────────────────────────────────────────────────────────
function readSession(req) {
  const t = req.cookies && req.cookies[COOKIE];
  if (!t || !SESSION_SECRET) return null;
  try { return jwt.verify(t, SESSION_SECRET); } catch (e) { return null; }
}
function requireSession(req, res, next) {
  const s = readSession(req);
  if (!s) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nepřihlášen' });
    return res.redirect('/login');
  }
  req.session = s;
  next();
}

// ── SSO vstup z HolyOS ──────────────────────────────────────────────────────
app.get('/sso', (req, res) => {
  if (!SSO_SECRET) return res.status(500).send('SSO není nakonfigurováno.');
  try {
    const p = jwt.verify(String(req.query.t || ''), SSO_SECRET, { audience: 'bs2', issuer: 'holyos' });
    if (ALLOWED_PIDS.length && !ALLOWED_PIDS.includes(Number(p.pid))) return res.status(403).send('Do této sekce nemáš přístup.');
    const session = jwt.sign({ uid: p.uid, pid: p.pid, name: p.name, username: p.username }, SESSION_SECRET, { expiresIn: '12h' });
    res.cookie(COOKIE, session, { httpOnly: true, secure: req.secure || req.get('x-forwarded-proto') === 'https', sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
    res.redirect('/');
  } catch (e) {
    res.status(401).send(page('Přihlášení vypršelo', '<p>Odkaz z HolyOS je neplatný nebo vypršel (platí 2 minuty).</p><p><a class="btn" href="' + HOLYOS_URL + '/api/auth/sso/bs2">Přihlásit znovu přes HolyOS</a></p>'));
  }
});
app.get('/login', (req, res) => {
  res.send(page('BS2 — přihlášení', '<p>Tahle sekce je soukromá. Přihlášení probíhá přes HolyOS.</p><p><a class="btn" href="' + HOLYOS_URL + '/api/auth/sso/bs2">Přihlásit přes HolyOS</a></p>'));
});
app.post('/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
app.get('/logout', (req, res) => { res.clearCookie(COOKIE); res.redirect('/login'); });

// ── API ─────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'bs2', time: new Date().toISOString() }));
app.get('/api/me', requireSession, (req, res) => res.json({ user: req.session }));

// ── Aplikace (zatím kostra) ─────────────────────────────────────────────────
app.use('/static', express.static(path.join(__dirname, 'public')));
app.get('/', requireSession, (req, res) => {
  res.send(page('BS2', `
    <p class="muted">Přihlášen: <b>${esc(req.session.name || req.session.username || '')}</b> · <a href="/logout">Odhlásit</a> · <a href="${HOLYOS_URL}">← zpět do HolyOS</a></p>
    <div class="grid">
      <div class="card"><h3>🔒 Soukromá sekce</h3><p>Samostatná aplikace oddělená od HolyOS (vlastní server, doména i data). Obsah doplníme podle zadání.</p></div>
    </div>`));
});

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function page(title, body) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  :root{--bg:#0f1220;--card:#181c2e;--border:#2a2f45;--text:#e8eaf2;--text2:#9aa0b4;--accent:#f59e0b}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:14px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
  header b{font-size:16px} header .tag{font-size:11px;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:1px 8px}
  main{padding:22px;max-width:1100px} .muted{color:var(--text2)} a{color:#4aa3ea}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:14px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px} .card h3{margin:0 0 6px;font-size:15px}
  .btn{display:inline-block;background:var(--accent);color:#1a1a1a;font-weight:700;padding:10px 16px;border-radius:10px;text-decoration:none}
</style></head><body><header><b>BS2</b><span class="tag">soukromé</span><span class="muted" style="margin-left:auto">Best Series</span></header><main>${body}</main></body></html>`;
}

app.listen(PORT, () => console.log(`[bs2] běží na portu ${PORT}`));
