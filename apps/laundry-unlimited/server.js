// Laundry Unlimited — veřejný web pro hledání regionálních partnerů + administrace poptávek.
// Samostatná Railway služba s vlastní databází (PostgreSQL). Admin se otevírá přes SSO z HolyOS (LU_SSO_SECRET).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { LANGS, NAMES, T, QSEC } = require('./i18n');
const QS_FIELDS = QSEC.en.flatMap((sec) => sec.f.filter(Array.isArray));
const QS_KEYS = QS_FIELDS.map((f) => f[0]); const QS_LABELS = QS_FIELDS.map((f) => f[2]);

const PORT = process.env.PORT || 8080;
const HOLYOS_URL = String(process.env.HOLYOS_URL || 'https://app.holyos.cz').replace(/\/$/, '');
const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://laundry-unlimited.com').replace(/\/$/, '');
const LU_SECRET = process.env.LU_SSO_SECRET || '';
const SESSION_KEY = LU_SECRET ? crypto.createHmac('sha256', LU_SECRET).update('lu-admin-session').digest('hex') : '';
const COOKIE = 'lu_admin';

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: /railway\.internal/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } }) : null;
const q = (sql, params) => { if (!pool) throw new Error('DATABASE_URL není nastaven'); return pool.query(sql, params); };

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// Async obslužné funkce: chyby se předají error handleru (Express 4 je jinak neodchytí → request by visel)
for (const m of ['get', 'post']) {
  const orig = app[m].bind(app);
  app[m] = (p, ...hs) => (typeof p === 'string' && hs.length ? orig(p, ...hs.map((h) => (typeof h === 'function' && h.constructor.name === 'AsyncFunction' ? (req, res, next) => h(req, res, next).catch(next) : h))) : orig(p, ...hs));
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const readCookie = (req, name) => { const m = String(req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find((p) => p[0] === name); return m ? decodeURIComponent(m.slice(1).join('=')) : ''; };
const rate = new Map();
function limited(key, max, windowMs) { const now = Date.now(); const a = (rate.get(key) || []).filter((t) => now - t < windowMs); a.push(now); rate.set(key, a); return a.length > max; }
setInterval(() => { const now = Date.now(); for (const [k, a] of rate) if (!a.some((t) => now - t < 3600e3)) rate.delete(k); }, 600e3).unref();

// ── Databáze ───────────────────────────────────────────────────────────────
async function initDb() {
  if (!pool) { console.warn('[lu] DATABASE_URL chybí — poptávky se neukládají'); return; }
  await q(`CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    lang TEXT NOT NULL DEFAULT 'en',
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    country TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    note TEXT,
    answers JSONB,
    answered_at TIMESTAMPTZ,
    ip TEXT,
    user_agent TEXT,
    utm JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q('CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries (status, created_at DESC)');
  // Uživatelé administrace (týmové účty) — odděleně od leadů
  await q(`CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
  )`);
  await q('CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users (lower(email))');
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS first_name TEXT');
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_name TEXT');
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone TEXT');
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash TEXT');
  // Modelace business modelu: plátna (myšlenkové mapy) sdílená v administraci
  await q(`CREATE TABLE IF NOT EXISTS model_boards (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    rev INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
  )`);
  // Rozdělení financí: jedna sdílená tabulka (řádky = co se dělí, sloupce = pozice, buňky = podíl v %)
  await q(`CREATE TABLE IF NOT EXISTS finance_split (
    id INT PRIMARY KEY,
    data JSONB NOT NULL,
    rev INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
  )`);
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMPTZ');
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS invite_count INT NOT NULL DEFAULT 0');
  await q('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS invite_error TEXT');
  // Partnerský portál: přístup a viditelné sekce nastavuje admin v detailu leadu
  await q('ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS portal_access BOOLEAN NOT NULL DEFAULT false');
  await q("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS portal_sections JSONB NOT NULL DEFAULT '[]'::jsonb");
  await q('ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS portal_login_at TIMESTAMPTZ');
  await q('ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS portal_link_at TIMESTAMPTZ');
}

// ── Notifikace do HolyOS (Velín) ───────────────────────────────────────────
function notifyHolyos(title, body, p) {
  try {
    if (!LU_SECRET) return;
    const token = jwt.sign({ aud: 'holyos-api', iss: 'laundry-unlimited' }, LU_SECRET, { expiresIn: '1m' });
    fetch(HOLYOS_URL + '/api/auth/lu/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, path: p }) })
      .then((r) => { if (!r.ok) console.warn('[lu] notify ' + r.status); }).catch((e) => console.warn('[lu] notify:', e.message));
  } catch (e) { console.warn('[lu] notify:', e.message); }
}

// ── Logo ───────────────────────────────────────────────────────────────────
// Pokud existuje public/logo.png (nebo .svg / .webp), použije se; jinak vektorová náhrada.
function logoHtml(h) {
  for (const ext of ['png', 'svg', 'webp', 'jpg']) if (fs.existsSync(path.join(__dirname, 'public', 'logo.' + ext))) return `<img src="/logo.${ext}" alt="Laundry Unlimited" style="height:${h}px;width:auto;display:block">`;
  return `<svg height="${h}" viewBox="0 0 580 140" role="img" aria-label="Laundry Unlimited" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c4d2"/></linearGradient></defs>
  <path d="M89 17.4 A56 56 0 1 0 124 84.5" fill="none" stroke="#00e5ff" stroke-width="8"/>
  <path d="M79.3 35.2 A36 36 0 0 0 46.9 97.6" fill="none" stroke="#1e7cff" stroke-width="8"/>
  <rect x="94" y="8" width="11" height="11" fill="#00e5ff"/>
  <text x="152" y="78" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="52" font-weight="300" letter-spacing="5" fill="url(#lg)">LAUNDRY</text>
  <text x="156" y="116" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="17" font-weight="300" letter-spacing="13" fill="#a9b6c7">UNLIMITED</text></svg>`;
}

// ── Šablona stránek ────────────────────────────────────────────────────────
// Veřejný web: světlý „papírový“ vzhled s fotkami reálných prádlomatů (serif nadpisy, tenké linky, plochá tlačítka).
// Administrace má vlastní tmavé CSS (ADMIN_CSS) níž.
const ADMIN_CSS = `
:root{--bg:#050a14;--bg2:#0a1424;--card:#0d1b30;--line:#1b2d4a;--text:#e8eef7;--mut:#9fb0c6;--cy:#00e5ff;--bl:#1e7cff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 Inter,"Segoe UI",system-ui,-apple-system,Arial,sans-serif}
a{color:var(--cy)}h2{font-size:24px;margin:0;font-weight:700}
.btn{display:inline-block;background:linear-gradient(135deg,var(--bl),var(--cy));color:#03101f;font-weight:800;border:0;border-radius:10px;padding:11px 20px;font-size:15px;text-decoration:none;cursor:pointer}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}.btn.sm{padding:7px 13px;font-size:13px;border-radius:9px}
input,select,textarea{width:100%;background:#07111f;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 12px;font:inherit}
`;
const SITE_CSS = `
:root{--bg:#050a18;--card:rgba(255,255,255,.045);--card2:rgba(255,255,255,.08);--line:rgba(255,255,255,.12);--txt:#eaf1ff;--mut:#9fb0cc;--blue:#2f7bff;--cy:#22e6ff;--vio:#7a5cff;--grad:linear-gradient(110deg,#2f7bff,#22e6ff);--ease:cubic-bezier(.16,1,.3,1);--sys:"Inter","Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--txt);font:17px/1.7 var(--sys);font-weight:300;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit}.wrap{max-width:1240px;margin:0 auto;padding:0 32px;position:relative}
::selection{background:rgba(34,230,255,.35)}
.aur{position:fixed;inset:0;z-index:-1;overflow:hidden;background:radial-gradient(1200px 700px at 80% -10%,#0d2155,transparent 60%),var(--bg)}
.aur i{position:absolute;border-radius:50%;filter:blur(90px);opacity:.55;will-change:transform}
.aur i:nth-child(1){width:60vmax;height:60vmax;left:-18vmax;top:10vh;background:radial-gradient(circle,#1f5cff,transparent 65%);animation:fl1 26s ease-in-out infinite alternate}
.aur i:nth-child(2){width:50vmax;height:50vmax;right:-14vmax;top:-12vmax;background:radial-gradient(circle,#18d6ff,transparent 65%);opacity:.38;animation:fl2 31s ease-in-out infinite alternate}
.aur i:nth-child(3){width:46vmax;height:46vmax;left:30vw;bottom:-22vmax;background:radial-gradient(circle,#7a5cff,transparent 65%);opacity:.34;animation:fl3 36s ease-in-out infinite alternate}
@keyframes fl1{to{transform:translate(14vw,-8vh) scale(1.15)}}@keyframes fl2{to{transform:translate(-12vw,16vh) scale(.9)}}@keyframes fl3{to{transform:translate(-18vw,-10vh) scale(1.2)}}
.prog{position:fixed;left:0;top:0;height:3px;width:0;background:linear-gradient(90deg,#7a5cff,#2f7bff,#22e6ff);z-index:70;box-shadow:0 0 14px rgba(34,230,255,.8)}
.bar{position:fixed;top:14px;left:0;right:0;z-index:60;pointer-events:none}
.bar .wrap{display:flex;align-items:center;gap:26px;height:68px;padding:0 12px 0 26px;max-width:1240px;border-radius:999px;background:rgba(10,18,42,.55);backdrop-filter:blur(22px) saturate(1.4);-webkit-backdrop-filter:blur(22px) saturate(1.4);border:1px solid var(--line);box-shadow:0 20px 60px -24px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.08);pointer-events:auto}
.bar nav{margin-left:auto;display:flex;align-items:center;gap:30px;font-size:13.5px;font-weight:400}
.bar nav a{color:var(--mut);text-decoration:none;position:relative;transition:color .25s}.bar nav a:not(.btn):hover{color:#fff}.bar nav a.btn{color:#03101c;font-weight:700}
.bar nav a.hide:after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:2px;border-radius:2px;background:var(--grad);transform:scaleX(0);transform-origin:left;transition:transform .35s var(--ease)}.bar nav a.hide:hover:after{transform:scaleX(1)}
.lang{display:flex;gap:4px;font-size:11px;letter-spacing:.12em;padding:4px;border-radius:999px;background:rgba(255,255,255,.05)}.lang a{padding:6px 10px;border-radius:999px;opacity:.6;text-decoration:none}.lang a.on{opacity:1;color:#04101f!important;background:var(--grad);font-weight:600}
.chev{display:inline-block;width:1.15em;height:1.15em;vertical-align:-.2em;margin-left:.6em;transition:transform .35s var(--ease)}
.btn{display:inline-flex;align-items:center;justify-content:center;background:var(--grad);color:#03101c;font:600 14px/1 var(--sys);letter-spacing:.02em;border:0;padding:19px 32px;border-radius:999px;text-decoration:none;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 14px 44px -12px rgba(34,230,255,.6),inset 0 1px 0 rgba(255,255,255,.45);transition:transform .4s var(--ease),box-shadow .4s var(--ease)}
.btn>span{position:relative;display:inline-flex;align-items:center;z-index:1}
.btn:before{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);transition:left .8s var(--ease)}
.btn:hover{transform:translateY(-3px);box-shadow:0 22px 60px -14px rgba(34,230,255,.8),inset 0 1px 0 rgba(255,255,255,.5)}.btn:hover:before{left:130%}.btn:hover .chev{transform:translateX(6px)}
.btn.line{background:var(--card);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.26);backdrop-filter:blur(10px)}.btn.line:hover{box-shadow:inset 0 0 0 1px var(--cy),0 16px 50px -18px rgba(34,230,255,.5)}
.btn.dark,.btn.o{background:var(--grad);color:#03101c}
.bar .btn{padding:14px 24px;font-size:12.5px}
.lbl,.tag{display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border:1px solid var(--line);border-radius:999px;background:var(--card);backdrop-filter:blur(10px);font:500 11.5px/1 var(--sys);letter-spacing:.2em;text-transform:uppercase;color:#bfeeff}
.lbl:before,.tag:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--cy);box-shadow:0 0 0 0 rgba(34,230,255,.7);animation:pulse 2.2s infinite}
@keyframes pulse{70%{box-shadow:0 0 0 10px rgba(34,230,255,0)}100%{box-shadow:0 0 0 0 rgba(34,230,255,0)}}
h1,h2,h3{margin:0;font-weight:300;letter-spacing:-.03em;color:#fff;font-family:var(--sys)}
h1{font-size:clamp(40px,6.2vw,96px);line-height:1.03;margin:30px 0 30px;max-width:980px;letter-spacing:-.04em;background:linear-gradient(100deg,#fff 0%,#fff 38%,#8eeaff 50%,#fff 62%,#fff 100%);background-size:260% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sheen 7s ease-in-out infinite}
@keyframes sheen{0%{background-position:120% 0}60%,100%{background-position:-60% 0}}
h2{font-size:clamp(32px,4.4vw,64px);line-height:1.06;margin:24px 0 0;background:linear-gradient(180deg,#fff,#b6cdf5);-webkit-background-clip:text;background-clip:text;color:transparent}
h3{font-size:clamp(19px,1.7vw,24px);line-height:1.25;font-weight:400;margin-bottom:10px;letter-spacing:-.015em}
p{margin:0 0 14px}.lead{font-size:clamp(18px,1.5vw,22px);line-height:1.6;color:var(--mut);max-width:600px;margin-bottom:44px}
.cta{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.gl{position:relative;border-radius:26px;background:linear-gradient(160deg,rgba(255,255,255,.075),rgba(255,255,255,.02));border:1px solid var(--line);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 30px 80px -40px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.07);overflow:hidden;transition:border-color .4s,transform .5s var(--ease)}
.gl:before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(420px circle at var(--mx,50%) var(--my,0%),rgba(34,230,255,.2),transparent 60%);opacity:0;transition:opacity .4s;pointer-events:none}
.gl:hover{border-color:rgba(34,230,255,.45)}.gl:hover:before{opacity:1}
.hero{position:relative;padding:200px 0 70px;overflow:hidden}
.drum{position:absolute;right:-9%;top:46%;width:min(68vw,860px);aspect-ratio:1;transform:translateY(-50%);pointer-events:none}
.ring{position:absolute;border-radius:50%;inset:0;background:conic-gradient(from 0deg,transparent 0,rgba(34,230,255,.95) 14%,transparent 34%,rgba(47,123,255,.9) 56%,transparent 74%,rgba(122,92,255,.8) 90%,transparent);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1px));mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1px));animation:spin 24s linear infinite;filter:drop-shadow(0 0 14px rgba(34,230,255,.55))}
.ring.r2{inset:9%;animation-duration:17s;animation-direction:reverse;opacity:.85}.ring.r3{inset:20%;animation-duration:11s;opacity:.7}
.core{position:absolute;inset:30%;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(120,200,255,.35),rgba(30,90,255,.12) 55%,transparent 70%);box-shadow:inset 0 0 80px rgba(34,230,255,.18),0 0 120px rgba(47,123,255,.25);animation:breathe 7s ease-in-out infinite}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes breathe{50%{transform:scale(1.07);opacity:.8}}
.bb{position:absolute;bottom:-60px;border-radius:50%;border:1px solid rgba(160,235,255,.55);background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.75),rgba(120,220,255,.12) 45%,transparent 70%);animation:rise linear infinite;opacity:0;z-index:1}
@keyframes rise{0%{transform:translate(0,0) scale(.6);opacity:0}12%{opacity:.9}50%{transform:translate(18px,-45vh) scale(1)}100%{transform:translate(-14px,-105vh) scale(1.1);opacity:0}}
.hw{z-index:2}
.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:90px}
.facts .gl{padding:26px 28px 24px;font-size:17px;line-height:1.5;color:#dfe9fb}
.mach .mimg{margin:-6px -8px 14px;height:220px;display:flex;align-items:center;justify-content:center;border-radius:18px;background:radial-gradient(60% 60% at 50% 55%,rgba(79,209,255,.16),transparent 70%)}.mach .mimg img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 18px 30px rgba(0,0,0,.45))}
.ic{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:var(--grad);color:#03101c;margin-bottom:18px;box-shadow:0 10px 30px -10px rgba(34,230,255,.7)}.ic svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.tick{overflow:hidden;border-block:1px solid var(--line);padding:26px 0;background:rgba(255,255,255,.02);-webkit-mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.tick div{display:flex;gap:44px;width:max-content;align-items:center;animation:mq 46s linear infinite}
.tick span{font:200 clamp(26px,3.2vw,44px)/1 var(--sys);letter-spacing:-.02em;color:#dce8ff;white-space:nowrap}.tick i{width:12px;height:12px;border-radius:50%;background:var(--grad);box-shadow:0 0 16px rgba(34,230,255,.8);flex:none}
@keyframes mq{to{transform:translateX(-50%)}}
section{padding:130px 0;position:relative}
.sec-h{display:flex;justify-content:space-between;align-items:flex-end;gap:60px;margin-bottom:64px;flex-wrap:wrap}.sec-h p{max-width:460px;font-size:18px;margin:0;color:var(--mut)}
.brands{display:grid;grid-template-columns:1.25fr .8fr 1.25fr;gap:20px;align-items:stretch}
.brands figure{margin:0;position:relative;border-radius:30px;overflow:hidden;border:1px solid var(--line);box-shadow:0 40px 90px -40px rgba(0,0,0,.9)}
.brands figure:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(5,10,24,.75)),linear-gradient(120deg,rgba(47,123,255,.18),transparent 50%);pointer-events:none}
.brands img{display:block;width:100%;height:100%;min-height:420px;object-fit:cover;transition:transform 1.4s var(--ease)}.brands figure:hover img{transform:scale(1.07)}
.brands figure:nth-child(2){margin-top:44px;margin-bottom:-44px}
.mgrid{display:grid;grid-template-columns:5fr 6fr;gap:22px;align-items:stretch}
.flow{display:flex;flex-direction:column}
.node{padding:30px 32px}.node small{display:block;font:200 14px/1 var(--sys);letter-spacing:.3em;color:var(--cy);margin-bottom:16px}.node p{margin:0;color:var(--mut);font-size:16.5px}
.node.hot{background:linear-gradient(150deg,rgba(47,123,255,.34),rgba(34,230,255,.1));border-color:rgba(34,230,255,.4)}
.wire{height:46px;width:2px;margin:0 auto;background:linear-gradient(180deg,transparent,var(--cy),transparent);background-size:100% 200%;animation:wire 2.2s linear infinite;border-radius:2px}
@keyframes wire{to{background-position:0 -200%}}
.big{padding:44px 46px}.big h3{font-size:clamp(26px,2.6vw,38px);font-weight:200;margin-bottom:8px}.big small{display:block;color:var(--cy);letter-spacing:.14em;text-transform:uppercase;font-size:12px;margin-bottom:26px;font-weight:500}
.ck{list-style:none;margin:0;padding:0}.ck li{display:grid;grid-template-columns:34px 1fr;gap:14px;padding:17px 0;border-top:1px solid var(--line);color:#d3dff4;font-size:17px;line-height:1.5}
.ck li svg{width:26px;height:26px;padding:5px;border-radius:50%;background:rgba(34,230,255,.14);stroke:var(--cy);fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
.bento{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}
.b{padding:36px 36px 34px;min-height:240px;display:flex;flex-direction:column}.b0{grid-column:span 4}.b1{grid-column:span 2}.b2{grid-column:span 2}.b3{grid-column:span 4}.b4,.b5{grid-column:span 3}
.num{font:200 clamp(48px,5vw,76px)/1 var(--sys);letter-spacing:-.04em;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:auto;padding-bottom:28px}
.b p{margin:0;color:var(--mut);font-size:16.5px;max-width:520px}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.pan{padding:44px 46px 28px}.pan:after{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:var(--grad)}
.pan h3.col{font:500 12px/1 var(--sys);letter-spacing:.26em;text-transform:uppercase;color:var(--cy);margin-bottom:12px}
.it{display:grid;grid-template-columns:48px 1fr;gap:12px;padding:24px 0;border-top:1px solid var(--line)}.it:first-of-type{border-top:0}
.it .n{font:200 22px/1.3 var(--sys);color:var(--cy);letter-spacing:.06em}.it h3{font-size:22px;margin-bottom:6px}.it p{margin:0;color:var(--mut);font-size:16.5px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;position:relative;padding-top:34px}
.steps .line{position:absolute;left:0;right:0;top:0;height:3px;border-radius:3px;background:var(--line)}.steps .line i{display:block;height:100%;width:var(--p,0%);border-radius:3px;background:var(--grad);box-shadow:0 0 18px rgba(34,230,255,.9);transition:width .2s linear}
.st{padding:34px 34px 30px}.st .big{display:block;font:200 clamp(80px,8vw,130px)/.9 var(--sys);letter-spacing:-.05em;color:transparent;-webkit-text-stroke:1.5px rgba(34,230,255,.75);margin-bottom:22px;padding:0}.st p{margin:0;color:var(--mut);font-size:16.5px}
.fin{padding:60px 0 130px}.cta-card{padding:80px 70px;display:flex;justify-content:space-between;align-items:center;gap:50px;flex-wrap:wrap;background:radial-gradient(800px 360px at 80% 0,rgba(47,123,255,.55),transparent 60%),linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02))}
.cta-card h2{max-width:760px;margin:0;position:relative;z-index:1}.cta-card .btn{position:relative;z-index:1}
.cta-card .ring{width:520px;height:520px;inset:auto;right:-140px;top:-170px;opacity:.55;pointer-events:none}.cta-card .ring.r2{width:380px;height:380px;right:-70px;top:-100px}
form.box{max-width:820px;padding:50px 52px;border-radius:30px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid var(--line);backdrop-filter:blur(18px);position:relative;box-shadow:0 40px 100px -50px #000}
form.box:before{content:"";position:absolute;left:0;top:0;height:2px;width:100%;background:var(--grad);border-radius:30px 30px 0 0}
label{display:block;font:500 11px/1.2 var(--sys);letter-spacing:.18em;text-transform:uppercase;margin:28px 0 10px;color:var(--mut)}
input,select,textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#fff;padding:17px 20px;font:300 16px/1.4 var(--sys);border-radius:16px;transition:border-color .25s,background .25s,box-shadow .25s}
input:focus,select:focus,textarea:focus{outline:0;border-color:var(--cy);background:rgba(34,230,255,.06);box-shadow:0 0 0 4px rgba(34,230,255,.12)}
textarea{min-height:130px;resize:vertical}.row2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.chk{display:flex;gap:14px;align-items:flex-start;font-weight:300;text-transform:none;letter-spacing:0;font-size:15px;margin:30px 0 6px;color:var(--mut)}.chk input{width:auto;margin-top:6px;accent-color:#22e6ff}
.opts{display:flex;flex-wrap:wrap;gap:10px}.opts label{margin:0;border:1px solid rgba(255,255,255,.18);padding:13px 20px;font:300 15px/1.2 var(--sys);letter-spacing:0;text-transform:none;cursor:pointer;display:flex;gap:10px;align-items:center;color:#d8e1ee;border-radius:999px;background:var(--card);transition:all .25s}
.opts label:hover{border-color:var(--cy)}.opts label:has(input:checked){border-color:var(--cy);background:rgba(34,230,255,.15);color:#fff;box-shadow:0 0 24px -6px rgba(34,230,255,.6)}.opts input{width:auto;accent-color:#22e6ff}
.err{background:rgba(255,90,90,.12);border:1px solid rgba(255,120,120,.6);padding:14px 18px;margin:0 0 8px;color:#ffd6d6;border-radius:14px}.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
.page{padding:190px 0 140px;position:relative}.page .sub{max-width:660px;margin:22px 0 50px;font-size:20px;color:var(--mut)}
footer{padding:46px 0;color:#7f8fab;font-size:13.5px;border-top:1px solid var(--line);background:rgba(2,5,12,.6);backdrop-filter:blur(10px)}footer b{color:#fff;font-weight:500}
.js .rv{opacity:0;transform:translateY(50px) scale(.98);transition:opacity .9s var(--ease),transform 1.1s var(--ease);transition-delay:calc(var(--i,0)*90ms)}.js .rv.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.aur i,.ring,.core,.bb,.tick div,.wire,h1,.lbl:before,.tag:before{animation:none}.js .rv{opacity:1;transform:none;transition:none}}
/* Horní lišta na menších obrazovkách: odkazy se nikdy nelámou na dva řádky, postupně se zkracuje a skrývá */
.bar nav a,.lang a{white-space:nowrap}.bar .wrap>a{flex:none}.bar nav{flex-wrap:nowrap}
@media(max-width:1340px){.bar .wrap{gap:16px;padding-left:20px}.bar nav{gap:18px;font-size:13px}.bar .btn{padding:12px 18px}.lang a{padding:6px 8px}}
@media(max-width:1140px){.bar nav a.hide{display:none}.bar nav{gap:12px}}
@media(max-width:600px){.bar{top:8px}.bar .wrap{height:54px;padding:0 6px 0 14px;gap:8px}.bar .wrap>a img,.bar .wrap>a svg{height:34px!important;width:auto}.lang{padding:3px}.lang a{padding:5px 6px;font-size:10px;letter-spacing:.06em}.bar .btn{padding:10px 13px;font-size:12px}.bar .btn svg{display:none}.lgi{width:36px;height:36px;margin-left:2px}.lgi svg{width:18px;height:18px}}
@media(max-width:430px){.bar nav a.btn{display:none}.bar .wrap>a img,.bar .wrap>a svg{height:30px!important}}
@media(max-width:900px){.facts,.mgrid,.duo,.steps,.brands,.row2{grid-template-columns:1fr}.bento{grid-template-columns:1fr}.bento>.b{grid-column:auto!important;min-height:0}
section{padding:80px 0}.hero{padding:140px 0 40px}.facts{margin-top:50px}.sec-h{margin-bottom:36px;gap:18px}.bar{top:10px}.bar .wrap{height:58px;padding:0 8px 0 18px;gap:12px}.bar nav a.hide{display:none}.bar nav{gap:10px}
.drum{right:-45%;top:22%;width:120vw;opacity:.55}.big,.pan{padding:30px 24px 16px}.cta-card{padding:44px 28px}form.box{padding:32px 22px}.page{padding:120px 0 80px}.brands figure:nth-child(2){margin:0}.brands img{min-height:280px}.tick span{font-size:26px}.steps .line{display:none}.steps{padding-top:0}}
`;

const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h17M14 5l7 7-7 7"/></svg>';

const LGI_CSS = `.lgi{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;margin-left:10px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#e8f0ff;transition:.2s;flex:none}.lgi svg{width:20px;height:20px}.lgi:hover{border-color:#22e6ff;color:#22e6ff;box-shadow:0 0 18px rgba(34,230,255,.35)}.lgmsg{padding:12px 14px;border-radius:12px;border:1px solid rgba(34,230,255,.4);background:rgba(34,230,255,.08);margin:0 0 16px}.lgalt{margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.1);font-size:14px;opacity:.85}.lgalt a{color:#22e6ff}`;
// Texty přihlašovací stránky (společné přihlášení pro partnery i tým)
const LG = {
  en: { h: 'Sign in', lead: 'Enter your e-mail. We will send you a sign-in link — it works for partners and for the team.', email: 'E-mail', send: 'Send sign-in link', sent: 'If this e-mail has access, we have sent you a sign-in link. It is valid for 1 hour.', team: 'Team member?', holyos: 'Sign in with HolyOS' },
  cs: { h: 'Přihlášení', lead: 'Zadejte e-mail. Pošleme vám přihlašovací odkaz — platí pro partnery i pro tým.', email: 'E-mail', send: 'Poslat přihlašovací odkaz', sent: 'Pokud k e-mailu existuje přístup, poslali jsme vám přihlašovací odkaz. Platí 1 hodinu.', team: 'Člen týmu?', holyos: 'Přihlásit přes HolyOS' },
  pl: { h: 'Logowanie', lead: 'Podaj e-mail. Wyślemy Ci link do logowania — dla partnerów i zespołu.', email: 'E-mail', send: 'Wyślij link', sent: 'Jeśli ten e-mail ma dostęp, wysłaliśmy link do logowania. Ważny 1 godzinę.', team: 'Członek zespołu?', holyos: 'Zaloguj przez HolyOS' },
  de: { h: 'Anmelden', lead: 'E-Mail eingeben. Wir senden Ihnen einen Anmeldelink — für Partner und Team.', email: 'E-Mail', send: 'Anmeldelink senden', sent: 'Wenn diese E-Mail Zugang hat, haben wir Ihnen einen Anmeldelink gesendet. Gültig 1 Stunde.', team: 'Teammitglied?', holyos: 'Mit HolyOS anmelden' },
};
function page({ lang, title, desc, body, canonicalPath, noindex }) {
  const t = T[lang];
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${PUBLIC_URL}${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? '' : canonicalPath}">`).join('');
  const sw = LANGS.map((l) => `<a class="${l === lang ? 'on' : ''}" href="${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? (l === 'en' ? '/' : '') : canonicalPath}" hreflang="${l}">${NAMES[l]}</a>`).join('');
  const base = lang === 'en' ? '' : '/' + lang;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || t.title)}</title><meta name="description" content="${esc(desc || t.desc)}">
${noindex ? '<meta name="robots" content="noindex">' : alts}<meta name="theme-color" content="#04080f">
<meta property="og:title" content="${esc(title || t.title)}"><meta property="og:description" content="${esc(desc || t.desc)}"><meta property="og:type" content="website"><meta property="og:image" content="${PUBLIC_URL}/img/ireland.webp">
<script>document.documentElement.className+=' js'</script><style>${SITE_CSS}${LGI_CSS}</style></head><body>
<div class="aur"><i></i><i></i><i></i></div><div class="prog" id="prog"></div>
<div class="bar"><div class="wrap"><a href="${base || '/'}" style="display:block">${logoHtml(50)}</a>
<nav><a class="hide" href="${base}/#about">${esc(t.nav_about)}</a><a class="hide" href="${base}/#machines">${esc(t.nav_machines)}</a><a class="hide" href="${base}/#model">${esc(t.nav_model)}</a><a class="hide" href="${base}/#offer">${esc(t.nav_offer)}</a><a class="hide" href="${base}/#who">${esc(t.nav_who)}</a>
<div class="lang">${sw}</div><a class="btn" href="${base}/apply"><span>${esc(t.nav_apply)}${CHEV}</span></a><a class="lgi" href="${base}/login" rel="nofollow" aria-label="${esc((LG[lang] || LG.en).h)}" title="${esc((LG[lang] || LG.en).h)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg></a></nav></div></div>
${body}
<footer><div class="wrap"><b>Laundry Unlimited</b> — ${esc(t.foot.replace(/^Laundry Unlimited\s*·\s*/, ''))}</div></footer>
<script>(function(){var els=[].slice.call(document.querySelectorAll('.rv')),pg=document.getElementById('prog'),sf=document.getElementById('sfill'),st=document.getElementById('steps');
function up(){var h=document.documentElement.scrollHeight-innerHeight;pg.style.width=(h>0?scrollY/h*100:0)+'%';if(sf&&st){var r=st.getBoundingClientRect(),p=Math.max(0,Math.min(1,(innerHeight*.75-r.top)/(r.height+innerHeight*.2)));st.style.setProperty('--p',(p*100)+'%')}}
addEventListener('scroll',up,{passive:true});up();
if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in')})}else{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});els.forEach(function(e){io.observe(e)})}
var fine=matchMedia('(hover:hover) and (pointer:fine)').matches&&!matchMedia('(prefers-reduced-motion:reduce)').matches;
if(fine){document.addEventListener('pointermove',function(e){var g=e.target.closest&&e.target.closest('.gl');if(g){var r=g.getBoundingClientRect();g.style.setProperty('--mx',(e.clientX-r.left)+'px');g.style.setProperty('--my',(e.clientY-r.top)+'px')}
var t=e.target.closest&&e.target.closest('.tilt');if(t){var q=t.getBoundingClientRect(),x=(e.clientX-q.left)/q.width-.5,y=(e.clientY-q.top)/q.height-.5;t.style.transition='transform .1s';t.style.transform='perspective(900px) rotateY('+(x*7)+'deg) rotateX('+(-y*7)+'deg) translateZ(0)'}});
document.addEventListener('pointerout',function(e){var t=e.target.closest&&e.target.closest('.tilt');if(t&&!t.contains(e.relatedTarget)){t.style.transition='transform .6s cubic-bezier(.16,1,.3,1)';t.style.transform=''}})}
})()</script>
</body></html>`;
}

const ICO = {
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[n]}</svg>`;

function landing(lang) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const nn = (i) => String(i + 1).padStart(2, '0');
  const li = (a) => a.map((x) => `<li>${ico('check')}<span>${esc(x)}</span></li>`).join('');
  let sd = 21; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  let bub = '';
  for (let i = 0; i < 18; i++) {
    const z = (8 + rnd() * 34).toFixed(0);
    bub += `<i class="bb" style="left:${(rnd() * 100).toFixed(1)}%;width:${z}px;height:${z}px;animation-duration:${(9 + rnd() * 12).toFixed(1)}s;animation-delay:-${(rnd() * 16).toFixed(1)}s"></i>`;
  }
  const words = [...t.offer.map((o) => o[0]), ...t.who.map((o) => o[0]), ...t.exp.map((o) => o[0])];
  const tk = words.map((w) => `<span>${esc(w)}</span><i></i>`).join('');
  const icons = ['pin', 'sliders', 'globe'];
  const stats = [t.stat1, t.stat2, t.stat3].map((s, i) => `<div class="gl tilt rv" style="--i:${i}"><span class="ic">${ico(icons[i])}</span>${esc(s)}</div>`).join('');
  const item = (o, i) => `<div class="it"><span class="n">${nn(i)}</span><div><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div></div>`;
  const body = `
<div class="hero"><div class="drum"><i class="ring"></i><i class="ring r2"></i><i class="ring r3"></i><i class="core"></i></div>${bub}
<div class="wrap hw"><span class="lbl">${esc(t.hero_kicker)}</span><h1>${esc(t.hero_h)}</h1><p class="lead"><b>${esc(t.hero_sub)}</b><br>${esc(t.hero_p)}</p>
<div class="cta"><a class="btn" href="${base}/apply"><span>${esc(t.hero_cta)}${CHEV}</span></a><a class="btn line" href="#model"><span>${esc(t.hero_cta2)}</span></a></div>
<div class="facts">${stats}</div></div></div>
<div class="tick"><div>${tk}${tk}</div></div>
<section id="about"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_about)}</span><h2>${esc(t.about_h)}</h2></div><p>${esc(t.about_p)}</p></div>
<div class="facts" style="margin-top:0">${t.about_facts.map((f, i) => `<div class="gl tilt rv" style="--i:${i % 3}"><h3 style="font-size:44px;margin:0 0 8px">${esc(f[0])}</h3>${esc(f[1])}</div>`).join('')}</div>
<div class="gl rv" style="padding:34px 38px;margin-top:16px"><h3>${esc(t.about_prod)}</h3><p>${esc(t.about_prod_p)}</p></div>
${t.perf && t.perf.length ? `<div class="gl rv" style="padding:34px 38px;margin-top:16px"><h3>${esc(t.perf_h)}</h3><ul class="ck">${li(t.perf)}</ul></div>` : ''}</div></section>
<section id="machines"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.mach_lbl)}</span><h2>${esc(t.mach_h)}</h2></div><p>${esc(t.mach_p)}</p></div>
<div class="facts" style="margin-top:0">${t.machines.map((m, i) => `<div class="gl tilt rv mach" style="--i:${i}"><div class="mimg"><img src="/img/stroj/${['mini', 'midi', 'max'][i]}" alt="${esc(m[0])}" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></div><h3 style="font-size:38px;margin:0 0 4px">${esc(m[0])}</h3><small>${esc(m[1])}</small><p>${esc(m[2])}</p></div>`).join('')}</div>
<div class="duo" style="margin-top:16px"><div class="gl pan rv"><h3 class="col">${esc(t.feat_h)}</h3><ul class="ck">${li(t.feat)}</ul></div>
<div class="gl pan rv" style="--i:1"><h3 class="col">${esc(t.ben_h)}</h3><ul class="ck">${li(t.ben)}</ul><p>${esc(t.mach_cmp)}</p></div></div>
<div class="sec-h rv" style="margin-top:70px"><div><h2 style="font-size:clamp(26px,3vw,40px)">${esc(t.inst_h)}</h2></div><p>${esc(t.inst_p)}</p></div>
<div class="brands rv"><figure class="tilt"><img src="/img/ireland.webp" alt="" loading="lazy" width="1200" height="900"></figure><figure class="tilt"><img src="/img/blue.webp" alt="" loading="lazy" width="900" height="1200"></figure><figure class="tilt"><img src="/img/orlen.webp" alt="" loading="lazy" width="1200" height="900"></figure></div></div></section>
<section id="model"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_model)}</span><h2>${esc(t.model_h)}</h2></div><p>${esc(t.model_p)}</p></div>
<div class="facts" style="margin-top:0">${t.fr_cols.map((c, i) => `<div class="gl rv${i === 1 ? ' node hot' : ''}" style="--i:${i};padding:34px 30px"><h3>${esc(c[0])}</h3><p>${esc(c[1])}</p><ul class="ck">${li(c[2])}</ul></div>`).join('')}</div>
<div class="duo" style="margin-top:16px"><div class="gl node hot rv"><small>${esc(t.market_h)}</small><h3>${esc(t.market_h)}</h3><p>${esc(t.market_p)}</p></div>
<div class="gl pan rv" style="--i:1"><h3 class="col">${esc(t.rev_h)}</h3><ul class="ck">${li(t.rev)}</ul></div></div></div></section>
<section id="offer"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_offer)}</span><h2>${esc(t.offer_h)}</h2></div></div>
<div class="bento">${t.offer.map((o, i) => `<div class="gl b b${i} rv" style="--i:${i % 3}"><span class="num">${nn(i)}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section id="who"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_who)}</span><h2>${esc(t.who_h)}</h2></div></div>
<div class="duo"><div class="gl pan rv"><h3 class="col">${esc(t.who_do)}</h3>${t.who.map(item).join('')}</div>
<div class="gl pan rv" style="--i:1"><h3 class="col">${esc(t.who_exp)}</h3>${t.exp.map(item).join('')}</div></div></div></section>
<section><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.steps_h)}</span><h2>${esc(t.steps_h)}</h2></div></div>
<div class="steps" id="steps"><div class="line"><i id="sfill"></i></div>${t.steps.map((o, i) => `<div class="gl st rv" style="--i:${i}"><span class="big">${i + 1}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section class="fin"><div class="wrap"><div class="gl cta-card rv"><i class="ring"></i><i class="ring r2"></i><h2>${esc(t.cta_h)}</h2><a class="btn" href="${base}/apply"><span>${esc(t.hero_cta)}${CHEV}</span></a></div></div></section>`;
  return page({ lang, body, canonicalPath: '/' });
}

function applyPage(lang, err, v) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang; v = v || {};
  const body = `<div class="page"><div class="wrap"><span class="tag w">${esc(t.nav_apply)}</span><h2>${esc(t.form_h)}</h2><p class="sub">${esc(t.form_p)}</p>
<form class="box" method="post" action="${base}/apply" id="f">${err ? `<div class="err">${esc(err)}</div>` : ''}
<div class="hp"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label style="margin-top:0">${esc(t.f_name)} *</label><input name="name" required maxlength="120" value="${esc(v.name)}" autocomplete="name">
<div class="row2"><div><label>${esc(t.f_email)} *</label><input name="email" type="email" required maxlength="160" value="${esc(v.email)}" autocomplete="email"></div>
<div><label>${esc(t.f_phone)}</label><input name="phone" maxlength="40" value="${esc(v.phone)}" autocomplete="tel"></div></div>
<div class="row2"><div><label>${esc(t.f_company)}</label><input name="company" maxlength="160" value="${esc(v.company)}" autocomplete="organization"></div>
<div><label>${esc(t.f_country)}</label><input name="country" maxlength="80" value="${esc(v.country)}" autocomplete="country-name"></div></div>
${QSTYLE}<div class="qwrap">${qFields(lang)}</div>
<label class="chk" style="margin-top:34px"><input type="checkbox" name="consent" value="1" required> <span>${esc(t.f_consent)}</span></label>
<input type="hidden" name="utm" id="utm" value=""><div style="margin-top:26px"><button class="btn o" type="submit"><span>${esc(t.f_submit)}${CHEV}</span></button></div></form></div></div>
<script>try{var u={},p=new URLSearchParams(location.search);['utm_source','utm_medium','utm_campaign','gclid','fbclid'].forEach(function(k){if(p.get(k))u[k]=p.get(k)});if(document.referrer)u.ref=document.referrer.slice(0,200);document.getElementById('utm').value=JSON.stringify(u)}catch(e){}</script>`;
  return page({ lang, title: t.form_h + ' — Laundry Unlimited', body, canonicalPath: '/apply' });
}

const QSTYLE = `<style>.qs{font-size:26px;margin:46px 0 4px;padding-top:26px;border-top:1px solid var(--line)}.qs:first-of-type{margin-top:0;border:0;padding:0}.qg{font-size:17px;color:var(--cy);margin:26px 0 0}.qh{color:var(--mut);text-transform:none;letter-spacing:0;font-weight:300}.qi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0 6px;color:#d8e1ee;font-size:15px;line-height:1.7}</style>`;
function qFields(lang) {
  const fld = (f) => f.group ? `<h3 class="qg">${esc(f.group)}</h3>` : `<label>${esc(f[2])}${f[3] ? ` <span class="qh">· ${esc(f[3])}</span>` : ''}</label>` + (f[1] === 'area' ? `<textarea name="f_${f[0]}" maxlength="2000"></textarea>` : `<input name="f_${f[0]}" maxlength="300"${f[1] === 'num' ? ' inputmode="decimal"' : ''}>`);
  return QSEC[lang].map((sec) => `<h3 class="qs">${esc(sec.h)}</h3>${sec.intro ? `<div class="qi">${sec.intro.map((x) => `<div>${esc(x)}</div>`).join('')}</div>` : ''}${sec.f.map(fld).join('')}`).join('');
}
function qAnswers(b) {
  const s = (x, n) => String(x == null ? '' : x).slice(0, n); const answers = {};
  for (const sec of QSEC.en) for (const f of sec.f) if (Array.isArray(f)) { const v = s(b['f_' + f[0]], f[1] === 'area' ? 2000 : 300).trim(); if (v) answers[f[0]] = v; }
  return answers;
}
function questionnairePage(lang, token, err) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const radios = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="radio" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const checks = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const qfields = qFields(lang);
  const body = `<style>.qs{font-size:26px;margin:46px 0 4px;padding-top:26px;border-top:1px solid var(--line)}.qs:first-of-type{margin-top:0;border:0;padding:0}.qg{font-size:17px;color:var(--cy);margin:26px 0 0}.qh{color:var(--mut);text-transform:none;letter-spacing:0;font-weight:300}.qi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0 6px;color:#d8e1ee;font-size:15px;line-height:1.7}</style><div class="page"><div class="wrap"><span class="tag w">${esc(t.nav_apply)}</span><h2>${esc(t.q_h)}</h2><p class="sub">${esc(t.q_p)}</p>
<form class="box" method="post" action="${base}/questionnaire/${esc(token)}">${err ? `<div class="err">${esc(err)}</div>` : ''}
${qfields}
<div style="margin-top:28px;display:flex;gap:14px;flex-wrap:wrap;align-items:center"><button class="btn o" type="submit"><span>${esc(t.q_submit)}${CHEV}</span></button><a class="btn line" href="${base}/thanks"><span>${esc(t.q_skip)}</span></a></div></form></div></div>`;
  return page({ lang, title: t.q_h + ' — Laundry Unlimited', body, canonicalPath: '/questionnaire', noindex: true });
}

function simplePage(lang, h, p, path0, noindex) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  return page({ lang, title: h + ' — Laundry Unlimited', body: `<div class="page"><div class="wrap"><h2>${esc(h)}</h2><p class="sub">${esc(p)}</p><a class="btn dark" href="${base || '/'}"><span>${esc(t.back)}</span></a></div></div>`, canonicalPath: path0, noindex: noindex !== false });
}

// ── Jazyk: / = EN, /cs /pl /de ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => { let db = false; try { await q('SELECT 1'); db = true; } catch (e) { /* bez DB */ } res.json({ ok: true, app: 'laundry-unlimited', db }); });
// HTML stránky se nikdy necachují, aby se po nasazení hned projevily změny
app.use((req, res, next) => { if (!/\.(webp|png|jpe?g|svg|ico|css|js|woff2?)$/i.test(req.path)) res.set('Cache-Control', 'no-cache'); next(); });
// Fotky strojů MINI / MIDI / MAX z Best Series 2.0 (BS2 je bere z ceníku HolyOS). Id položek ceníku jde přenastavit
// v env LU_MACHINE_IMG="mini,midi,max" (výchozí 11,12,20). V paměti drží 6 h; při chybě se vrátí 404 a karta zůstane bez fotky.
const BS2_URL = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
const MACH_IDS = (() => { const a = String(process.env.LU_MACHINE_IMG || '11,12,20').split(',').map((x) => parseInt(x, 10)); return { mini: a[0] || 11, midi: a[1] || 12, max: a[2] || 20 }; })();
const machImg = new Map();
app.get('/img/stroj/:kind(mini|midi|max)', async (req, res) => {
  const k = req.params.kind, c = machImg.get(k);
  if (c && Date.now() - c.at < 6 * 3600e3) return res.set('Content-Type', c.type).set('Cache-Control', 'public, max-age=86400').send(c.buf);
  try {
    const r = await fetch(BS2_URL + '/img/product/' + MACH_IDS[k], { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('BS2 ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer()), type = r.headers.get('content-type') || 'image/png';
    machImg.set(k, { at: Date.now(), buf, type });
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=86400').send(buf);
  } catch (e) { if (c) return res.set('Content-Type', c.type).send(c.buf); res.status(404).end(); }
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));
// Finanční report master franšízy (z „fin report master franchise.xlsx", všechny listy) — neindexuje se
// Záložka „Ekonomika prádlomatu" v /tabulka01 = kalkulačka z laundromats.eu (skripty se načítají odtamtud);
// její relativní volání API a fotky přeposíláme na laundromats.eu
const LM_URL = String(process.env.LM_URL || 'https://laundromats.eu').replace(/\/$/, '');
const lmJson = (p) => async (req, res) => {
  try { const r = await fetch(LM_URL + p, { signal: AbortSignal.timeout(15000) }); const j = await r.json();
    (j.machines || []).forEach((m) => { if (m && m.photo && m.photo.charAt(0) === '/') m.photo = LM_URL + m.photo; });
    res.set('Cache-Control', 'public, max-age=1800').json(j);
  } catch (e) { res.json({}); }
};
app.get('/api/ekonomika/fx', lmJson('/api/ekonomika/fx'));
app.get('/api/compounder/portal/machines', lmJson('/api/compounder/portal/machines'));
app.get('/media/:f([\\w.-]+)', (req, res) => res.redirect(302, LM_URL + '/media/' + req.params.f));
// Finanční report je jen v administraci (dřív veřejně na /tabulka01)
app.get('/tabulka01', (req, res) => res.redirect(302, '/admin/m/report'));
const BEZ_JAZYKA = /^\/(api|admin|portal|login|sso|robots\.txt|sitemap\.xml)/;
app.use((req, res, next) => {
  const m = /^\/(en|cs|pl|de)(\/|$)/.exec(req.path);
  if (m) { req.lang = m[1]; req.url = req.url.slice(m[0].length - (m[2] === '/' ? 1 : 0)) || '/'; if (req.url.charAt(0) === '?') req.url = '/' + req.url; return next(); }
  req.lang = 'en';
  if (req.method === 'GET' && !BEZ_JAZYKA.test(req.path) && req.path === '/' && !req.query.l) {
    const al = String(req.headers['accept-language'] || '').toLowerCase();
    const first = /^\s*([a-z]{2})/.exec(al);
    const want = first && ['cs', 'sk'].includes(first[1]) ? 'cs' : first && LANGS.includes(first[1]) ? first[1] : 'en';
    const bot = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview/i.test(req.headers['user-agent'] || '');
    if (!bot && want !== 'en') return res.redirect(302, '/' + want);
  }
  next();
});

// ── Veřejné stránky ────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send(landing(req.lang)));
app.get('/apply', (req, res) => res.send(applyPage(req.lang)));
app.get('/thanks', (req, res) => res.send(simplePage(req.lang, T[req.lang].thanks_h, T[req.lang].thanks_p, '/thanks')));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ' + PUBLIC_URL + '/sitemap.xml\n'));
app.get('/sitemap.xml', (req, res) => {
  const urls = []; LANGS.forEach((l) => { const b = l === 'en' ? '' : '/' + l; urls.push(PUBLIC_URL + (b || '/'), PUBLIC_URL + b + '/apply'); });
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map((u) => '<url><loc>' + u + '</loc></url>').join('') + '</urlset>');
});

const form = express.urlencoded({ extended: false, limit: '40kb' });
app.post('/apply', form, async (req, res) => {
  const lang = req.lang; const t = T[lang]; const b = req.body || {};
  const v = { name: String(b.name || '').trim().slice(0, 120), email: String(b.email || '').trim().slice(0, 160), phone: String(b.phone || '').trim().slice(0, 40), company: String(b.company || '').trim().slice(0, 160), country: String(b.country || '').trim().slice(0, 80) };
  if (b.website) return res.redirect(303, (lang === 'en' ? '' : '/' + lang) + '/thanks'); // honeypot (roboti)
  if (limited('apply:' + req.ip, 6, 3600e3)) return res.status(429).send(applyPage(lang, t.f_err_server, v));
  if (!v.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) || !b.consent) return res.status(400).send(applyPage(lang, t.f_err, v));
  try {
    const token = crypto.randomBytes(18).toString('base64url');
    const ans = qAnswers(b); const hasAns = Object.keys(ans).length > 0;
    let utm = null; try { const u = JSON.parse(String(b.utm || '{}')); if (u && typeof u === 'object') utm = JSON.stringify(u).slice(0, 1000); } catch (e) { /* bez UTM */ }
    await q('INSERT INTO inquiries (token, lang, name, email, phone, company, country, ip, user_agent, utm, answers, answered_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)', [token, lang, v.name, v.email, v.phone || null, v.company || null, v.country || null, req.ip, String(req.headers['user-agent'] || '').slice(0, 300), utm, hasAns ? JSON.stringify(ans) : null, hasAns ? new Date() : null]);
    notifyHolyos('🧺 Nová poptávka (územní exkluzivita)', v.name + (v.country ? ' · ' + v.country : '') + ' · ' + v.email, '/');
    res.redirect(303, (lang === 'en' ? '' : '/' + lang) + (hasAns ? '/thanks' : '/questionnaire/' + token));
  } catch (e) { console.error('[lu] apply:', e.message); res.status(500).send(applyPage(lang, t.f_err_server, v)); }
});
async function byToken(token) { if (!/^[\w-]{10,40}$/.test(String(token))) return null; return (await q('SELECT id, lang, answers FROM inquiries WHERE token=$1', [token])).rows[0] || null; }
app.get('/questionnaire/:token', async (req, res) => {
  const row = await byToken(req.params.token).catch(() => null);
  if (!row) return res.status(404).send(simplePage(req.lang, T[req.lang].err_h, T[req.lang].err_p, '/questionnaire'));
  res.send(questionnairePage(req.lang, req.params.token));
});
app.post('/questionnaire/:token', form, async (req, res) => {
  const lang = req.lang; const b = req.body || {};
  try {
    const row = await byToken(req.params.token);
    if (!row) return res.status(404).send(simplePage(lang, T[lang].err_h, T[lang].err_p, '/questionnaire'));
    const s = (x, n) => String(x == null ? '' : x).slice(0, n);
    const answers = {};
    for (const sec of QSEC.en) for (const f of sec.f) if (Array.isArray(f)) { const v = s(b['f_' + f[0]], f[1] === 'area' ? 2000 : 300).trim(); if (v) answers[f[0]] = v; }
    await q("UPDATE inquiries SET answers=$2::jsonb, answered_at=now(), updated_at=now() WHERE id=$1", [row.id, JSON.stringify(answers)]);
    notifyHolyos('🧺 Dotazník vyplněn', (answers.territory || '—') + (answers.capital ? ' · kapitál ' + answers.capital : ''), '/');
    res.redirect(303, (lang === 'en' ? '' : '/' + lang) + '/thanks');
  } catch (e) { console.error('[lu] questionnaire:', e.message); res.status(500).send(questionnairePage(lang, req.params.token, T[lang].f_err_server)); }
});

// ── Společná horní lišta (administrace i partnerský portál) ─────────────────
// Materiály (report, ekonomika, technika, proč LU) jsou jedna stránka tabulka01.html; server z ní
// ukáže jen skupinu záložek a nahradí hlavičku touhle lištou.
const SEKCE = [
  { k: 'report', ico: '📊', cs: 'Finanční report', en: 'Financial report', listy: ['PŘEHLED', 'DATA', 'podklad'] },
  { k: 'ekonomika', ico: '🧮', cs: 'Ekonomika prádlomatu', en: 'Laundromat economics', listy: ['EKO', 'EKOD'] },
  { k: 'technika', ico: '🛠', cs: 'Technické parametry', en: 'Technical parameters', listy: ['TECH'] },
  { k: 'proc', ico: '💡', cs: 'Proč Laundry Unlimited', en: 'Why Laundry Unlimited', listy: ['FR', 'MFR'] },
];
const BAR_CSS = `.uside{position:fixed;left:0;top:0;bottom:0;width:244px;z-index:60;display:flex;flex-direction:column;gap:14px;padding:18px 14px;background:rgba(5,10,24,.94);border-right:1px solid rgba(255,255,255,.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
body:has(> .uside){padding-left:244px}.uside .brand{display:flex;flex-direction:column;gap:8px;text-decoration:none;padding:4px 6px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
.uside .ttl{font-weight:800;font-size:15px;color:#fff}.uside .ttl small{display:block;font-weight:600;font-size:10.5px;color:#9fb0cc;letter-spacing:.08em;text-transform:uppercase;margin-top:2px}
.uside nav{display:flex;flex-direction:column;gap:3px;flex:1;overflow-y:auto}.uside nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;color:#a9b8d3;text-decoration:none;font-weight:700;font-size:14px}
.uside .uic{display:inline-grid;place-items:center;width:32px;height:32px;flex:none;border-radius:10px;background:linear-gradient(135deg,rgba(34,230,255,.10),rgba(47,123,255,.08));box-shadow:inset 0 0 0 1px rgba(34,230,255,.18);transition:box-shadow .2s,background .2s}.uside .uic svg{width:17px;height:17px}
.uside nav a:hover .uic{box-shadow:inset 0 0 0 1px rgba(34,230,255,.45)}.uside nav a.on .uic{background:linear-gradient(135deg,rgba(34,230,255,.28),rgba(47,123,255,.22));box-shadow:inset 0 0 0 1px rgba(34,230,255,.6),0 6px 18px -6px rgba(34,230,255,.6)}
.uside .rt a.rtl{display:flex;align-items:center;gap:10px;justify-content:flex-start;padding:7px 10px}.uside .rt a.rtl .uic{width:26px;height:26px;border-radius:8px}.uside .rt a.rtl .uic svg{width:14px;height:14px}
body:has(> .uside) .wrap,body:has(> .uside) .adm{max-width:none!important;margin:0!important;padding-left:32px!important;padding-right:32px!important}.uside nav.ubot{flex:none;padding:0 0 22px}.uside nav a:hover{color:#fff;background:rgba(255,255,255,.05)}.uside nav a.on{color:#fff;background:linear-gradient(90deg,rgba(34,230,255,.16),rgba(47,123,255,.08));box-shadow:inset 3px 0 0 #22e6ff}
.uside .rt{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}.uside .rt a{color:#dbe7ff;text-decoration:none;font-size:13px;font-weight:700;padding:9px 12px;border:1px solid rgba(255,255,255,.14);border-radius:10px;text-align:center}.uside .rt a:hover{border-color:#22e6ff}.uside .who{color:#9fb0cc;font-size:12.5px;padding:0 4px}
body:has(> .uside) .adm{padding-top:58px!important}body:has(> .uside) .wrap{padding-top:58px!important}.utop{position:fixed;top:12px;right:20px;z-index:61;display:flex;gap:8px;align-items:center}.utop a{display:inline-flex;align-items:center;gap:8px;color:#dbe7ff;text-decoration:none;font-size:13px;font-weight:700;padding:6px 12px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(5,10,24,.85);backdrop-filter:blur(10px)}.utop a:hover{border-color:#22e6ff}.utop a .uic{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:linear-gradient(135deg,rgba(34,230,255,.10),rgba(47,123,255,.08));box-shadow:inset 0 0 0 1px rgba(34,230,255,.18)}.utop a .uic svg{width:14px;height:14px}.utop .who{color:#9fb0cc;font-size:12.5px;padding:0 4px}
@media(max-width:900px){body:has(> .uside) .adm,body:has(> .uside) .wrap{padding-top:14px!important}.uside nav.ubot{order:4;flex-basis:100%;border:0;padding:0}.utop{position:static;justify-content:flex-end;flex-wrap:wrap;padding:8px 14px}.utop .who{display:none}body:has(> .uside){padding-left:0}.uside{position:sticky;width:auto;bottom:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 14px;border-right:0;border-bottom:1px solid rgba(255,255,255,.08)}.uside .brand{flex-direction:row;align-items:center;border:0;padding:0}.uside nav{flex-direction:row;flex-basis:100%;order:3;overflow-x:auto;scrollbar-width:none}.uside nav::-webkit-scrollbar{display:none}.uside nav a{white-space:nowrap;padding:8px 11px}.uside .rt{flex-direction:row;margin-left:auto;border:0;padding:0}.uside .who{display:none}}`;
// Ikony bočního menu: tenké linky s přechodem v barvách značky
const UICO = {
  leady: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  report: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/><path d="M17 7h3v3"/>',
  ekonomika: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h4"/>',
  technika: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  proc: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.74c.6.48 1 1.17 1 1.94V17h6v-.32c0-.77.4-1.46 1-1.94A7 7 0 0 0 12 2z"/>',
  model: '<circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="5.5" r="2"/><circle cx="19.5" cy="5.5" r="2"/><circle cx="4.5" cy="18.5" r="2"/><circle cx="19.5" cy="18.5" r="2"/><path d="M10 10 6 7M14 10l4-3M10 14l-4 3M14 14l4 3"/>',
  split: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  uzivatele: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M16 11h6"/>',
  holyos: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
};
const uico = (k) => `<span class="uic"><svg viewBox="0 0 24 24" fill="none" stroke="url(#lugr)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UICO[k] || ''}</svg></span>`;
function topBar(o) {
  const en = o.lang && o.lang !== 'cs';
  const tabs = o.mode === 'admin'
    ? [{ k: 'leady', href: '/admin', t: 'Leady' }].concat(SEKCE.map((x) => ({ k: x.k, href: '/admin/m/' + x.k, t: x.cs })), [{ k: 'model', href: '/admin/model', t: 'Modelace business modelu' }, { k: 'split', href: '/admin/finance', t: 'Rozdělení financí' }])
    : SEKCE.filter((x) => (o.sekce || []).includes(x.k)).map((x) => ({ k: x.k, href: '/portal/m/' + x.k, t: en ? x.en : x.cs }));
  const rt = o.mode === 'admin'
    ? `<a href="/portal" class="rtl">${uico('report')}<span>Uživatelské prostředí</span></a><a href="/portal/logout" class="rtl"><span>Odhlásit</span></a>`
    : `<span class="who">${esc(o.user || '')}</span>${o.admin ? `<a href="/admin" class="rtl">${uico('leady')}<span>Administrace</span></a>` : ''}<a href="/portal/logout">${en ? 'Log out' : 'Odhlásit'}</a>`;
  return `<aside class="uside"><svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="lugr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22e6ff"/><stop offset="1" stop-color="#2f7bff"/></linearGradient></defs></svg><a class="brand" href="${o.mode === 'admin' ? '/admin' : '/portal'}">${logoHtml(30)}<span class="ttl">${o.mode === 'admin' ? 'Administrace' : (en ? 'Partner portal' : 'Partnerský portál')}<small>${o.mode === 'admin' ? 'jen pro tým' : 'Laundry Unlimited'}</small></span></a>
<nav>${tabs.map((x) => `<a href="${x.href}"${x.k === o.active ? ' class="on"' : ''}>${uico(x.k)}<span>${esc(x.t)}</span></a>`).join('')}</nav>${o.mode === 'admin' ? `<nav class="ubot"><a href="/admin/users"${o.active === 'uzivatele' ? ' class="on"' : ''}>${uico('uzivatele')}<span>Uživatelé administrace</span></a></nav>` : ''}</aside><div class="utop">${rt}</div>`;
}
// Stránka materiálů v liště administrace / portálu
let T01 = null;
function materialsPage(sekce, bar, title) {
  if (!T01) T01 = fs.readFileSync(path.join(__dirname, 'tabulka01.html'), 'utf8');
  const s = SEKCE.find((x) => x.k === sekce);
  return T01.replace(/<!--HDR-->[\s\S]*?<!--\/HDR-->/, '')
    .replace('<body>', '<body>' + bar)
    .replace('</head>', '<style>' + BAR_CSS + '</style><script>window.__ALLOW=' + JSON.stringify(s.listy) + ';</script></head>')
    .replace(/<title>[^<]*<\/title>/, '<title>' + esc(title + ' — ' + (s ? s.cs : '')) + '</title>');
}

// ── Společné přihlášení (/login): partner i admin přes odkaz v e-mailu ─────
const ADMIN_EMAILS = String(process.env.LU_ADMIN_EMAILS || 'tomas.holy@bestseries.cz').toLowerCase().split(/[,;\s]+/).filter(Boolean);
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
function verifyPw(pw, stored) {
  try { const [salt, h] = String(stored).split(':'); const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}
const pwHits = new Map();
function pwLimited(key) { const now = Date.now(), a = (pwHits.get(key) || []).filter((x) => now - x < 900e3); a.push(now); pwHits.set(key, a); if (pwHits.size > 5000) pwHits.clear(); return a.length > 8; }
const LGP = {
  en: { pw: 'Password (team accounts)', bad: 'Incorrect e-mail or password.', hint: 'Partners: leave the password empty — we will send a sign-in link.', go: 'Sign in' },
  cs: { pw: 'Heslo (týmové účty)', bad: 'Nesprávný e-mail nebo heslo.', hint: 'Partneři: heslo nechte prázdné — pošleme vám přihlašovací odkaz.', go: 'Přihlásit' },
  pl: { pw: 'Hasło (konta zespołu)', bad: 'Nieprawidłowy e-mail lub hasło.', hint: 'Partnerzy: zostaw hasło puste — wyślemy link do logowania.', go: 'Zaloguj' },
  de: { pw: 'Passwort (Teamkonten)', bad: 'E-Mail oder Passwort falsch.', hint: 'Partner: Passwort leer lassen — wir senden Ihnen einen Anmeldelink.', go: 'Anmelden' },
};
function loginPage(lang, msg, err) {
  const t = LG[lang] || LG.en, base = lang === 'en' ? '' : '/' + lang;
  const body = `<div class="page"><div class="wrap"><span class="tag w">${esc(t.h)}</span><h2>${esc(t.h)}</h2><p class="sub">${esc(t.lead)}</p>
<div class="box" style="max-width:520px">${msg ? `<div class="lgmsg">${esc(msg)}</div>` : ''}${err ? `<div class="err">${esc(err)}</div>` : ''}
${msg ? '' : `<form method="post" action="${base}/login"><label style="margin-top:0">${esc(t.email)}</label><input name="email" type="email" required maxlength="160" autocomplete="email" autofocus><label>${esc((LGP[lang] || LGP.en).pw)}</label><input name="password" type="password" maxlength="200" autocomplete="current-password"><p class="sub" style="font-size:13px;margin:8px 0 0">${esc((LGP[lang] || LGP.en).hint)}</p><div style="margin-top:22px"><button class="btn o" type="submit"><span>${esc((LGP[lang] || LGP.en).go)}${CHEV}</span></button></div></form>`}
<div class="lgalt">${esc(t.team)} <a href="${toHolyos()}">${esc(t.holyos)}</a></div></div></div></div>`;
  return page({ lang, title: t.h + ' — Laundry Unlimited', body, canonicalPath: '/login', noindex: true });
}
const loginLang = (req) => (req.lang && req.lang !== 'en') ? req.lang : (/^\s*(cs|sk)/i.test(String(req.headers['accept-language'] || '')) ? 'cs' : 'en');
app.get('/login', async (req, res) => {
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex');
  if (adminOf(req) || await userOf(req)) return res.redirect(302, adminOf(req) ? '/admin' : '/portal');
  res.send(loginPage(loginLang(req)));
});
// Odeslání odkazu: e-mail týmu → odkaz do administrace, e-mail partnera → odkaz do portálu. Odpověď je pokaždé stejná.
let luMailErr = '';
async function sendAdminLink(email, lang, kind) {
  const ok = await sendAdminLinkRaw(email, lang, kind);
  if (kind === 'setup') {
    const sql = ok ? 'UPDATE admin_users SET invite_sent_at=now(), invite_count=invite_count+1, invite_error=NULL WHERE lower(email)=$1' : 'UPDATE admin_users SET invite_error=$2 WHERE lower(email)=$1';
    q(sql, ok ? [String(email).toLowerCase()] : [String(email).toLowerCase(), String(luMailErr || 'neznámá chyba').slice(0, 300)]).catch(() => {});
  }
  return ok;
}
async function sendAdminLinkRaw(email, lang, kind) {
  luMailErr = '';
  try {
    if (!LU_SECRET || !USER_KEY) { luMailErr = 'Na serveru Laundry Unlimited chybí LU_SSO_SECRET'; return false; }
    const cs = lang === 'cs', setup = kind === 'setup';
    const row = setup ? (await q('SELECT name, password_hash FROM admin_users WHERE lower(email)=$1', [email]).catch(() => ({ rows: [] }))).rows[0] : null;
    const tok = setup
      ? jwt.sign({ email, pv: String((row && row.password_hash) || '').slice(0, 12), aud: 'lu-admin-setup', iss: 'laundry-unlimited' }, USER_KEY, { expiresIn: '7d' })
      : jwt.sign({ email, aud: 'lu-admin-link', iss: 'laundry-unlimited' }, USER_KEY, { expiresIn: '1h' });
    const link = PUBLIC_URL + (setup ? '/admin/setup?t=' : '/admin/auth?t=') + encodeURIComponent(tok);
    const nm = row && row.name ? ', ' + row.name : '';
    const svc = jwt.sign({ aud: 'holyos-api', iss: 'laundry-unlimited' }, LU_SECRET, { expiresIn: '1m' });
    const subject = setup ? (cs ? 'Váš účet v administraci Laundry Unlimited — nastavte si heslo' : 'Your Laundry Unlimited administration account — set your password') : (cs ? 'Přihlášení do administrace Laundry Unlimited' : 'Sign in to Laundry Unlimited administration');
    const body = setup
      ? (cs ? 'Dobrý den' + nm + ',\n\nbyl vám vytvořen účet v administraci Laundry Unlimited. Kliknutím na tlačítko si nastavíte vlastní heslo a rovnou se přihlásíte. Odkaz platí 7 dní.\n\nLaundry Unlimited' : 'Hello' + nm + ',\n\nan account has been created for you in the Laundry Unlimited administration. Use the button to choose your password and sign in. The link is valid for 7 days.\n\nLaundry Unlimited')
      : (cs ? 'Dobrý den,\n\nzde je váš odkaz do administrace Laundry Unlimited. Platí 1 hodinu.\n\nLaundry Unlimited' : 'Hello,\n\nhere is your link to the Laundry Unlimited administration. It is valid for 1 hour.\n\nLaundry Unlimited');
    const label = setup ? (cs ? 'Nastavit heslo' : 'Set password') : (cs ? 'Otevřít administraci' : 'Open administration');
    const resp = await fetch(HOLYOS_URL + '/api/auth/lu/mail', { method: 'POST', headers: { Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, subject, body, link, linkLabel: label, lang: cs ? 'cs' : 'en' }), signal: AbortSignal.timeout(20000) });
    if (!resp.ok) { let d = ''; try { d = (await resp.json()).error || ''; } catch (e) { /* bez těla */ } luMailErr = 'HolyOS odpovědělo ' + resp.status + (d ? ': ' + d : ''); console.warn('[lu] admin mail ' + luMailErr); return false; }
    return true;
  } catch (e) { luMailErr = e.message; console.warn('[lu] admin mail:', e.message); return false; }
}
// Nastavení hesla z pozvánky (odkaz platí 7 dní, po nastavení hesla přestane fungovat)
function setupPage(t, err) {
  const body = `<div class="page"><div class="wrap"><span class="tag w">Laundry Unlimited</span><h2>Nastavte si heslo</h2><p class="sub">Vymyslete si heslo (min. 8 znaků). Po uložení se rovnou přihlásíte do administrace.</p>
<form class="box" method="post" action="/admin/setup" style="max-width:520px">${err ? `<div class="err">${esc(err)}</div>` : ''}<input type="hidden" name="t" value="${esc(t)}">
<label style="margin-top:0">Heslo *</label><input name="password" type="password" minlength="8" maxlength="200" required autocomplete="new-password" autofocus>
<label>Heslo znovu *</label><input name="password2" type="password" minlength="8" maxlength="200" required autocomplete="new-password">
<div style="margin-top:22px"><button class="btn o" type="submit"><span>Uložit heslo a přihlásit${CHEV}</span></button></div></form></div></div>`;
  return page({ lang: 'cs', title: 'Nastavení hesla — Laundry Unlimited', body, canonicalPath: '/admin/setup', noindex: true });
}
async function setupToken(t) {
  const d = jwt.verify(String(t || ''), USER_KEY, { audience: 'lu-admin-setup', issuer: 'laundry-unlimited' });
  const r = (await q('SELECT * FROM admin_users WHERE lower(email)=$1 AND active', [String(d.email).toLowerCase()])).rows[0];
  if (!r || String(r.password_hash || '').slice(0, 12) !== String(d.pv || '')) throw new Error('použitý nebo neplatný odkaz');
  return r;
}
app.get('/admin/setup', async (req, res) => {
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex');
  try { await setupToken(req.query.t); res.send(setupPage(String(req.query.t))); }
  catch (e) { res.status(401).send(loginPage('cs', '', 'Odkaz vypršel, už byl použit, nebo je neplatný. Požádejte o novou pozvánku.')); }
});
app.post('/admin/setup', form, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const t = String(req.body.t || '');
  try {
    const r = await setupToken(t);
    const pw = String(req.body.password || '');
    if (pw.length < 8) return res.status(400).send(setupPage(t, 'Heslo musí mít aspoň 8 znaků.'));
    if (pw !== String(req.body.password2 || '')) return res.status(400).send(setupPage(t, 'Hesla se neshodují.'));
    await q('UPDATE admin_users SET password_hash=$2, last_login_at=now() WHERE id=$1', [r.id, hashPw(pw)]);
    const session = jwt.sign({ name: r.name || r.email, email: String(r.email).toLowerCase(), aud: 'lu-admin', iss: 'laundry-unlimited' }, SESSION_KEY, { expiresIn: '8h' });
    res.set('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 8 * 3600);
    res.redirect(302, '/admin');
  } catch (e) { res.status(401).send(loginPage('cs', '', 'Odkaz vypršel, už byl použit, nebo je neplatný. Požádejte o novou pozvánku.')); }
});
async function adminUserOf(email) {
  email = String(email || '').toLowerCase();
  if (ADMIN_EMAILS.includes(email)) { const r = (await q('SELECT * FROM admin_users WHERE lower(email)=$1', [email]).catch(() => ({ rows: [] }))).rows[0]; return r || { email, name: '', active: true, env: true }; }
  const r = (await q('SELECT * FROM admin_users WHERE lower(email)=$1 AND active', [email]).catch(() => ({ rows: [] }))).rows[0];
  return r || null;
}
async function doLogin(req, res, lang, back) {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
  if (!portalLimited(String(req.ip || '')) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const au = await adminUserOf(email);
    if (au && au.active !== false) await sendAdminLink(email, lang === 'cs' ? 'cs' : 'en');
    else {
      const r = (await q('SELECT * FROM inquiries WHERE lower(email)=$1 AND portal_access ORDER BY id DESC LIMIT 1', [email]).catch(() => ({ rows: [] }))).rows[0];
      if (r) await sendPortalLink(r);
    }
  }
  res.set('Cache-Control', 'no-store').send(back((LG[lang] || LG.en).sent));
}
app.post('/login', form, async (req, res) => {
  const lang = loginLang(req), pw = String(req.body.password || '').slice(0, 200);
  if (pw) {
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    const bad = () => res.status(401).set('Cache-Control', 'no-store').send(loginPage(lang, '', (LGP[lang] || LGP.en).bad));
    if (pwLimited(String(req.ip || '') + '|' + email)) return bad();
    const au = await adminUserOf(email);
    if (!au || au.active === false || !au.password_hash || !verifyPw(pw, au.password_hash)) return bad();
    if (au.id) q('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [au.id]).catch(() => {});
    const session = jwt.sign({ name: au.name || email, email, aud: 'lu-admin', iss: 'laundry-unlimited' }, SESSION_KEY, { expiresIn: '8h' });
    res.set('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 8 * 3600);
    return res.set('Cache-Control', 'no-store').redirect(302, '/admin');
  }
  return doLogin(req, res, lang, (m) => loginPage(lang, m));
});
app.get('/admin/auth', async (req, res) => {
  try {
    const t = jwt.verify(String(req.query.t || ''), USER_KEY, { audience: 'lu-admin-link', issuer: 'laundry-unlimited' });
    const au = await adminUserOf(t.email);
    if (!au || au.active === false) throw new Error('není admin');
    if (au.id) q('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [au.id]).catch(() => {});
    const session = jwt.sign({ name: au.name || t.email, email: String(t.email).toLowerCase(), aud: 'lu-admin', iss: 'laundry-unlimited' }, SESSION_KEY, { expiresIn: '8h' });
    res.set('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 8 * 3600);
    res.set('Cache-Control', 'no-store').redirect(302, '/admin');
  } catch (e) { res.status(401).set('Cache-Control', 'no-store').send(loginPage(loginLang(req), '', LG[loginLang(req)].h + ': odkaz vypršel nebo je neplatný / link expired.')); }
});

// ── Partnerský portál (/portal) ───────────────────────────────────────────
// Partner = lead s portal_access. Přihlášení bez hesla: e-mail → odkaz (24 h) → cookie na 30 dní.
// Co vidí, určují zaškrtávátka portal_sections v detailu leadu.
const UCOOKIE = 'lu_user';
const USER_KEY = LU_SECRET ? crypto.createHmac('sha256', LU_SECRET).update('lu-portal-session').digest('hex') : '';
const PT = {
  cs: { title: 'Partnerský portál', lead: 'Zadejte e-mail, na který vám přijde přihlašovací odkaz.', email: 'E-mail', send: 'Poslat odkaz', sent: 'Pokud k e-mailu existuje přístup, poslali jsme vám přihlašovací odkaz. Platí 24 hodin.', bad: 'Odkaz vypršel nebo je neplatný. Vyžádejte si nový.', none: 'Zatím pro vás nemáme zpřístupněné žádné materiály. Ozveme se.', hi: 'Vítejte', subj: 'Přihlášení do partnerského portálu Laundry Unlimited', body: (n) => 'Dobrý den' + (n ? ', ' + n : '') + ',\n\nzde je váš odkaz do partnerského portálu Laundry Unlimited. Platí 24 hodin.\n\nLaundry Unlimited', btn: 'Otevřít portál' },
  en: { title: 'Partner portal', lead: 'Enter your e-mail and we will send you a sign-in link.', email: 'E-mail', send: 'Send link', sent: 'If this e-mail has access, we have sent you a sign-in link. It is valid for 24 hours.', bad: 'The link has expired or is invalid. Please request a new one.', none: 'No materials have been shared with you yet. We will be in touch.', hi: 'Welcome', subj: 'Sign in to the Laundry Unlimited partner portal', body: (n) => 'Hello' + (n ? ' ' + n : '') + ',\n\nhere is your link to the Laundry Unlimited partner portal. It is valid for 24 hours.\n\nLaundry Unlimited', btn: 'Open the portal' },
};
const ptx = (lang) => PT[lang === 'cs' ? 'cs' : 'en'];
async function sendPortalLink(r) {
  try {
    if (!LU_SECRET || !USER_KEY) return false;
    const t = jwt.sign({ id: r.id, aud: 'lu-portal-link', iss: 'laundry-unlimited' }, USER_KEY, { expiresIn: '24h' });
    const T2 = ptx(r.lang), link = PUBLIC_URL + '/portal/auth?t=' + encodeURIComponent(t);
    const svc = jwt.sign({ aud: 'holyos-api', iss: 'laundry-unlimited' }, LU_SECRET, { expiresIn: '1m' });
    const resp = await fetch(HOLYOS_URL + '/api/auth/lu/mail', { method: 'POST', headers: { Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: r.email, subject: T2.subj, body: T2.body(r.name), link, linkLabel: T2.btn, lang: r.lang }), signal: AbortSignal.timeout(20000) });
    if (!resp.ok) { console.warn('[lu] portál mail ' + resp.status); return false; }
    await q('UPDATE inquiries SET portal_link_at=now() WHERE id=$1', [r.id]);
    return true;
  } catch (e) { console.warn('[lu] portál mail:', e.message); return false; }
}
// Admin v uživatelském prostředí vidí všechny sekce (náhled očima partnera) a může přepnout zpět do administrace
async function portalUser(req) {
  const a = adminOf(req);
  if (a) return { name: a.name || 'Admin', lang: 'cs', portal_sections: SEKCE.map((x) => x.k), _admin: true };
  return userOf(req);
}
async function userOf(req) {
  if (!USER_KEY) return null;
  try {
    const t = jwt.verify(readCookie(req, UCOOKIE), USER_KEY, { audience: 'lu-portal', issuer: 'laundry-unlimited' });
    const r = (await q('SELECT * FROM inquiries WHERE id=$1 AND portal_access', [t.id])).rows[0];
    return r || null;
  } catch (e) { return null; }
}
const portalHits = new Map();
function portalLimited(ip) { const now = Date.now(), a = (portalHits.get(ip) || []).filter((x) => now - x < 3600e3); a.push(now); portalHits.set(ip, a); if (portalHits.size > 5000) portalHits.clear(); return a.length > 8; }
function portalShell(lang, body, bar) {
  const T2 = ptx(lang);
  return `<!doctype html><html lang="${lang === 'cs' ? 'cs' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(T2.title)} — Laundry Unlimited</title>
<style>${ADMIN_CSS}${BAR_CSS}.pbox{max-width:460px;margin:70px auto;padding:30px;border:1px solid var(--line);border-radius:20px;background:var(--card)}.pbox h1{margin:0 0 8px;font-size:26px}.pbox p{color:var(--mut)}.pbox input{width:100%;margin:6px 0 14px}</style></head><body>${bar || ''}${body}</body></html>`;
}
const loginBox = (lang, msg) => { const T2 = ptx(lang); return `<div class="pbox"><div style="margin-bottom:18px">${logoHtml(34)}</div><h1>${esc(T2.title)}</h1><p>${esc(msg || T2.lead)}</p>${msg ? '' : `<form method="post" action="/portal/login"><input type="hidden" name="lang" value="${esc(lang)}"><label>${esc(T2.email)}</label><input name="email" type="email" required maxlength="160" autocomplete="email"><button class="btn">${esc(T2.send)}</button></form>`}</div>`; };
const plang = (req) => (/^cs\b/i.test(String(req.query.lang || req.headers['accept-language'] || '')) ? 'cs' : 'en');
app.get('/portal', async (req, res) => {
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex');
  const u = await portalUser(req);
  if (!u) return res.redirect(302, plang(req) === 'cs' ? '/cs/login' : '/login');
  const sek = (u.portal_sections || []).filter((k) => SEKCE.some((x) => x.k === k));
  if (sek.length) return res.redirect(302, '/portal/m/' + SEKCE.find((x) => sek.includes(x.k)).k);
  const T2 = ptx(u.lang);
  res.send(portalShell(u.lang, `<div class="pbox"><h1>${esc(T2.hi)}${u.name ? ', ' + esc(u.name) : ''}</h1><p>${esc(T2.none)}</p></div>`, topBar({ mode: 'portal', lang: u.lang, sekce: [], user: u.name, admin: u._admin })));
});
app.post('/portal/login', form, async (req, res) => {
  const lang = req.body.lang === 'cs' ? 'cs' : 'en';
  // Stejná odpověď vždy — nikdo nezjistí, které e-maily mají přístup
  return doLogin(req, res, lang, (m) => portalShell(lang, loginBox(lang, m)));
});
app.get('/portal/auth', async (req, res) => {
  try {
    const t = jwt.verify(String(req.query.t || ''), USER_KEY, { audience: 'lu-portal-link', issuer: 'laundry-unlimited' });
    const r = (await q('SELECT * FROM inquiries WHERE id=$1 AND portal_access', [t.id])).rows[0];
    if (!r) throw new Error('bez přístupu');
    const ses = jwt.sign({ id: r.id, aud: 'lu-portal', iss: 'laundry-unlimited' }, USER_KEY, { expiresIn: '30d' });
    await q('UPDATE inquiries SET portal_login_at=now() WHERE id=$1', [r.id]);
    res.set('Set-Cookie', UCOOKIE + '=' + encodeURIComponent(ses) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 30 * 86400);
    res.set('Cache-Control', 'no-store').redirect(302, '/portal');
  } catch (e) { res.status(401).set('Cache-Control', 'no-store').send(portalShell(plang(req), loginBox(plang(req), ptx(plang(req)).bad) + '<p style="text-align:center"><a href="/portal">→ ' + esc(ptx(plang(req)).send) + '</a></p>')); }
});
app.get('/portal/m/:sekce(report|ekonomika|technika|proc)', async (req, res) => {
  const u = await portalUser(req);
  if (!u) return res.redirect(302, '/portal');
  const sek = (u.portal_sections || []);
  if (!sek.includes(req.params.sekce)) return res.redirect(302, '/portal');
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').send(materialsPage(req.params.sekce, topBar({ mode: 'portal', lang: u.lang, sekce: sek, active: req.params.sekce, user: u.name, admin: u._admin }), ptx(u.lang).title));
});
app.get('/portal/logout', (req, res) => { res.set('Set-Cookie', [UCOOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']); res.redirect(302, '/login'); });

// ── Administrace (SSO z HolyOS) ────────────────────────────────────────────
function adminOf(req) { if (!SESSION_KEY) return null; try { const t = jwt.verify(readCookie(req, COOKIE), SESSION_KEY, { audience: 'lu-admin', issuer: 'laundry-unlimited' }); return { name: t.name || '', email: t.email || '' }; } catch (e) { return null; } }
const toHolyos = () => HOLYOS_URL + '/api/auth/sso/laundry-unlimited';
app.get('/sso', (req, res) => {
  try {
    if (!LU_SECRET) return res.status(500).type('text/plain').send('Chybí LU_SSO_SECRET');
    const t = jwt.verify(String(req.query.t || ''), LU_SECRET, { audience: 'laundry-unlimited', issuer: 'holyos' });
    const session = jwt.sign({ name: t.name || '', aud: 'lu-admin', iss: 'laundry-unlimited' }, SESSION_KEY, { expiresIn: '8h' });
    res.set('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 8 * 3600);
    res.set('Cache-Control', 'no-store').redirect(302, '/admin');
  } catch (e) { res.status(401).type('text/plain').send('Přihlášení vypršelo. Otevři sekci Laundry Unlimited znovu z HolyOS.'); }
});
app.get('/admin/logout', (req, res) => { res.set('Set-Cookie', [COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', UCOOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']); res.redirect(302, '/'); });
const requireAdmin = (req, res, next) => {
  const a = adminOf(req); if (a) { req.admin = a; return next(); }
  if (req.path.startsWith('/admin/api/')) return res.status(401).json({ ok: false, error: 'Přihlášení vypršelo. Otevři sekci znovu z HolyOS.' });
  res.redirect(302, '/login');
};
const STATUSES = [['new', 'Nová'], ['contacted', 'Kontaktován'], ['talks', 'Jednání'], ['won', 'Partner'], ['lost', 'Ztraceno'], ['spam', 'Spam']];
const stLabel = (s) => (STATUSES.find((x) => x[0] === s) || [s, s])[1];
const stColor = { new: '#22d3ee', contacted: '#60a5fa', talks: '#f59e0b', won: '#22c55e', lost: '#94a3b8', spam: '#ef4444' };
const fmtDt = (d) => d ? new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

app.get('/admin', requireAdmin, async (req, res) => {
  const st = String(req.query.s || ''); const qs = String(req.query.q || '').trim().slice(0, 80);
  const where = []; const params = [];
  if (st && STATUSES.some((x) => x[0] === st)) { params.push(st); where.push('status=$' + params.length); }
  if (qs) { params.push('%' + qs.toLowerCase() + '%'); where.push(`(lower(name) LIKE $${params.length} OR lower(email) LIKE $${params.length} OR lower(coalesce(company,'')) LIKE $${params.length} OR lower(coalesce(country,'')) LIKE $${params.length})`); }
  const rows = (await q('SELECT * FROM inquiries' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT 500', params)).rows;
  const counts = {}; (await q('SELECT status, count(*)::int AS n FROM inquiries GROUP BY status')).rows.forEach((r) => { counts[r.status] = r.n; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const ans = (a) => a ? QSEC.en.map((sec) => { const rows = sec.f.filter((f) => Array.isArray(f) && a[f[0]]).map((f) => `<div><span class="k">${esc(f[2])}</span> ${esc(a[f[0]])}</div>`).join(''); return rows ? `<div class="k" style="margin-top:8px"><b>${esc(sec.h)}</b></div>${rows}` : ''; }).join('') || '<div class="mut">Dotazník je prázdný.</div>' : '<div class="mut">Dotazník zatím nevyplněn.</div>';
  const tr = rows.map((r) => `<details class="r"><summary><span class="dot" style="background:${stColor[r.status] || '#64748b'}"></span><b>${esc(r.name)}</b>
<span class="mut">${esc(r.country || '')}${r.company ? ' · ' + esc(r.company) : ''}</span><span class="sp"></span><span class="chip" style="border-color:${stColor[r.status] || '#64748b'}">${esc(stLabel(r.status))}</span>${r.answers ? '<span class="chip ok">dotazník</span>' : ''}<span class="mut">${esc(r.lang.toUpperCase())} · ${fmtDt(r.created_at)}</span></summary>
<div class="det"><div class="g"><div><div class="k">E-mail</div><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div><div><div class="k">Telefon</div>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</div></div>
<div class="ans">${ans(r.answers)}</div>${r.utm && Object.keys(r.utm).length ? `<div class="mut small">Zdroj: ${esc(JSON.stringify(r.utm))}</div>` : ''}
<div class="act"><select data-id="${r.id}" class="st">${STATUSES.map((x) => `<option value="${x[0]}"${x[0] === r.status ? ' selected' : ''}>${x[1]}</option>`).join('')}</select>
<input class="note" data-id="${r.id}" placeholder="Poznámka…" value="${esc(r.note || '')}"><button class="btn sm save" data-id="${r.id}">Uložit</button><button class="btn sm ghost del" data-id="${r.id}" title="Smazat poptávku">Smazat</button><span class="msg"></span>
<div class="portal" style="flex-basis:100%"><div class="k" style="margin-bottom:6px">Partnerský portál</div><label><input type="checkbox" class="pacc"${r.portal_access ? ' checked' : ''}> <b>Má přístup do portálu</b></label>
<div style="margin-top:4px"><span class="mut small">Co v portálu uvidí:</span><br>${SEKCE.map((x) => `<label><input type="checkbox" class="psec" value="${x.k}"${(r.portal_sections || []).includes(x.k) ? ' checked' : ''}> ${x.ico} ${esc(x.cs)}</label>`).join('')}</div>
<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn sm ghost plink" data-id="${r.id}" type="button">✉ Poslat přihlašovací odkaz</button><span class="mut small">${r.portal_login_at ? 'Naposledy přihlášen ' + fmtDt(r.portal_login_at) : 'Zatím se nepřihlásil'}${r.portal_link_at ? ' · odkaz poslán ' + fmtDt(r.portal_link_at) : ''}</span></div></div></div></div></details>`).join('');
  const chips = [['', 'Vše (' + total + ')']].concat(STATUSES.map((x) => [x[0], x[1] + ' (' + (counts[x[0]] || 0) + ')'])).map((x) => `<a class="chip${st === x[0] ? ' on' : ''}" href="/admin?s=${x[0]}${qs ? '&q=' + encodeURIComponent(qs) : ''}">${esc(x[1])}</a>`).join('');
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Laundry Unlimited — administrace</title>
<style>${ADMIN_CSS}.adm{max-width:1100px;margin:0 auto;padding:22px}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}.chip{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--text);text-decoration:none;background:#07111f}.chip.on{background:var(--bl)}.chip.ok{border-color:#22c55e;color:#86efac}
.r{border:1px solid var(--line);border-radius:14px;background:var(--card);margin:8px 0}.r summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px}.r summary::-webkit-details-marker{display:none}.sp{flex:1}
.dot{width:10px;height:10px;border-radius:50%}.mut{color:var(--mut);font-size:13px}.small{font-size:12px}.det{padding:0 16px 16px;border-top:1px solid var(--line)}.g{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.k{color:var(--mut);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-right:6px}
.ans div{margin:4px 0}.act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}.act select{width:auto}.act .note{flex:1;min-width:180px}.msg{font-size:13px;color:#86efac}
.atabs{display:flex;gap:6px;margin:18px 0 6px;border-bottom:1px solid var(--line)}.atabs a{padding:10px 16px;color:var(--mut);text-decoration:none;font-weight:700;font-size:14px;border-bottom:2px solid transparent;margin-bottom:-1px}.atabs a.on{color:#fff;border-color:var(--cy)}.atabs a:hover{color:#fff}${BAR_CSS}.portal{margin-top:14px;padding:12px 14px;border:1px dashed rgba(34,230,255,.35);border-radius:12px;background:rgba(34,230,255,.04)}.portal label{display:inline-flex;align-items:center;gap:6px;margin:4px 14px 4px 0;font-size:13.5px;cursor:pointer}.portal input{width:auto;margin:0}
</style></head><body>${topBar({ mode: 'admin', active: 'leady' })}<div class="adm">
<div style="display:flex;align-items:center;gap:10px;margin-top:10px"><h3 style="margin:0">Leady <span class="mut" style="font-weight:400">— poptávky z webu</span></h3><span class="sp"></span><a class="btn sm ghost" href="/admin/export.csv"><span>⬇ CSV</span></a></div>
<div class="bar">${chips}<form method="get" action="/admin" style="margin-left:auto;display:flex;gap:6px"><input type="hidden" name="s" value="${esc(st)}"><input name="q" value="${esc(qs)}" placeholder="Hledat jméno, e-mail, zemi…" style="width:240px"><button class="btn sm">Hledat</button></form></div>
${tr || '<p class="mut">Zatím žádné leady.</p>'}</div>
<script>
async function call(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.json()}
document.addEventListener('click',async e=>{const pl=e.target.closest('.plink');if(pl){const box=pl.closest('.act'),m=box.querySelector('.msg');if(!confirm('Poslat partnerovi e-mail s přihlašovacím odkazem do portálu? (Nejdřív ulož změny.)'))return;pl.disabled=true;const j=await call('/admin/api/inquiry/'+pl.dataset.id+'/portal-link',{});pl.disabled=false;m.textContent=j.ok?'Odkaz odeslán ✓':(j.error||'Chyba');return}
const b=e.target.closest('.save,.del');if(!b)return;const id=b.dataset.id,box=b.closest('.act'),m=box.querySelector('.msg');
if(b.classList.contains('del')){if(!confirm('Opravdu smazat tuto poptávku? Nelze vrátit.'))return;const j=await call('/admin/api/inquiry/'+id+'/delete',{});if(j.ok)location.reload();else m.textContent=j.error||'Chyba';return}
const pb=box.querySelector('.portal');const j=await call('/admin/api/inquiry/'+id,{status:box.querySelector('.st').value,note:box.querySelector('.note').value,portal_access:!!(pb&&pb.querySelector('.pacc').checked),portal_sections:pb?[].map.call(pb.querySelectorAll('.psec:checked'),function(x){return x.value}):undefined});m.textContent=j.ok?'Uloženo ✓':(j.error||'Chyba');if(j.ok)setTimeout(()=>location.reload(),500)});
</script></body></html>`);
});
app.post('/admin/api/inquiry/:id(\\d+)', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
  const b = req.body || {}; const id = Number(req.params.id);
  if (!STATUSES.some((x) => x[0] === b.status)) return res.status(400).json({ ok: false, error: 'Neplatný stav' });
  await q('UPDATE inquiries SET status=$2, note=$3, updated_at=now() WHERE id=$1', [id, b.status, String(b.note || '').slice(0, 2000) || null]);
  if (b.portal_access !== undefined) {
    const sek = Array.isArray(b.portal_sections) ? b.portal_sections.filter((k) => SEKCE.some((x) => x.k === k)) : [];
    await q('UPDATE inquiries SET portal_access=$2, portal_sections=$3::jsonb WHERE id=$1', [id, !!b.portal_access, JSON.stringify(sek)]);
  }
  res.json({ ok: true });
});
app.get('/admin/users', requireAdmin, async (req, res) => {
  const rows = (await q('SELECT * FROM admin_users ORDER BY created_at').catch(() => ({ rows: [] }))).rows;
  const inDb = new Set(rows.map((r) => String(r.email).toLowerCase()));
  const envOnly = ADMIN_EMAILS.filter((e) => !inDb.has(e));
  const me = String((req.admin && req.admin.email) || '').toLowerCase();
  const tr = envOnly.map((e) => `<tr><td>—</td><td>${esc(e)}</td><td>—</td><td><span class="chip ok">z konfigurace</span></td><td class="mut">—</td><td class="mut small">nelze smazat</td></tr>`).concat(rows.map((r) => `<tr><td>${esc(r.name || '—')}</td><td>${esc(r.email)}</td><td>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</td><td>${!r.active ? '<span class="chip">zakázán</span>' : r.password_hash ? '<span class="chip ok">aktivní</span>' : '<span class="chip" style="border-color:#f59e0b;color:#fcd34d">čeká na nastavení hesla</span>' + (r.invite_error ? `<div class="small" style="color:#fca5a5;margin-top:4px">Pozvánka se neodeslala: ${esc(r.invite_error)}</div>` : r.invite_sent_at ? `<div class="mut small" style="margin-top:4px">✉ Pozvánka odeslána ${esc(fmtDt(r.invite_sent_at))}${r.invite_count > 1 ? ' (' + r.invite_count + '×)' : ''}</div>` : '<div class="small" style="color:#fca5a5;margin-top:4px">Pozvánka zatím neodeslána</div>')}</td><td class="mut small">${esc(fmtDt(r.last_login_at))}</td>
<td style="text-align:right;white-space:nowrap"><button class="btn sm ghost upw" data-id="${r.id}">Heslo</button> <button class="btn sm ghost ulink" data-id="${r.id}">Pozvánka / nové heslo</button> <button class="btn sm ghost utog" data-id="${r.id}" data-a="${r.active ? 0 : 1}">${r.active ? 'Zakázat' : 'Povolit'}</button>${String(r.email).toLowerCase() === me ? '' : ` <button class="btn sm ghost udel" data-id="${r.id}">Smazat</button>`}</td></tr>`)).join('');
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Uživatelé administrace — Laundry Unlimited</title>
<style>${ADMIN_CSS}.adm{max-width:1000px;margin:0 auto;padding:22px}.mut{color:var(--mut);font-size:13px}.small{font-size:12px}.chip{border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-size:12px;background:#07111f}.chip.ok{border-color:#22c55e;color:#86efac}
table{width:100%;border-collapse:collapse;margin-top:14px}th,td{text-align:left;padding:11px 10px;border-bottom:1px solid var(--line);font-size:14px}th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.new{display:grid;grid-template-columns:1fr 1fr 1.3fr 1fr auto;gap:10px;align-items:end;margin-top:14px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.new label{font-size:12px;color:var(--mut);font-weight:700}.msg{font-size:13px;color:#86efac;margin-top:8px}.mov{position:fixed;inset:0;z-index:200;background:rgba(2,6,14,.78);display:flex;align-items:center;justify-content:center;padding:16px}.mbox{width:min(520px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 24px;position:relative}.mbox h3{margin:0 40px 14px 0}.mx{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:#07111f;color:var(--text);font-size:18px;line-height:1;cursor:pointer}.mx:hover{border-color:var(--cy)}.mbox label{display:block;font-size:12px;color:var(--mut);font-weight:700;margin:12px 0 4px}.mrow{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mer{color:#fca5a5;font-size:13px;margin-top:10px;min-height:18px}${BAR_CSS}@media(max-width:700px){.mrow{grid-template-columns:1fr}}
</style></head><body>${topBar({ mode: 'admin', active: 'uzivatele' })}<div class="adm"><div style="display:flex;align-items:center;gap:12px;margin-top:10px"><h3 style="margin:0">Uživatelé administrace <span class="mut" style="font-weight:400">— týmové účty, oddělené od leadů</span></h3><span style="flex:1"></span><button class="btn" id="unew">+ Vytvořit uživatele</button></div>
<p class="mut" style="margin:6px 0 0">Přihlašují se na <b>/login</b> e-mailem a heslem (nebo odkazem z e-mailu). Do uživatelského prostředí se z administrace přepnou tlačítkem vpravo nahoře.</p>
<div class="msg" id="um"></div>
<table><thead><tr><th>Jméno</th><th>E-mail</th><th>Telefon</th><th>Stav</th><th>Poslední přihlášení</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan="6" class="mut">Zatím žádní uživatelé.</td></tr>'}</tbody></table></div>
<script>
async function call(u,b){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});return r.json()}
const um=document.getElementById('um');
// Okno se zavírá jen křížkem (ne kliknutím mimo ani klávesou Esc)
function modal(title,html,onSubmit,btn){const o=document.createElement('div');o.className='mov';o.innerHTML='<div class="mbox"><button type="button" class="mx" aria-label="Zavřít">✕</button><h3>'+title+'</h3><form>'+html+'<div class="mer"></div><div style="margin-top:14px"><button class="btn" type="submit">'+(btn||'Uložit')+'</button></div></form></div>';document.body.appendChild(o);
o.querySelector('.mx').onclick=()=>o.remove();const f=o.querySelector('form'),er=o.querySelector('.mer');const fi=f.querySelector('input');if(fi)fi.focus();
f.onsubmit=async ev=>{ev.preventDefault();er.textContent='';const d={};f.querySelectorAll('input').forEach(i=>{d[i.name]=i.value});const j=await onSubmit(d);if(j.ok){if(j.sent===false)alert('Uživatel byl vytvořen, ale e-mail se nepodařilo odeslat ('+(j.error||'neznámá chyba')+'). Použijte tlačítko „Pozvánka / nové heslo“ v seznamu.');location.reload()}else er.textContent=j.error||'Chyba'};}
const pwf='<label>Heslo * (min. 8 znaků)</label><input name="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" required>';
document.getElementById('unew').onclick=()=>{modal('Vytvořit uživatele administrace','<div class="mrow"><div><label>Jméno *</label><input name="first_name" maxlength="60" required autocomplete="off"></div><div><label>Příjmení *</label><input name="last_name" maxlength="60" required autocomplete="off"></div></div><label>E-mail *</label><input name="email" type="email" maxlength="160" required autocomplete="off"><label>Telefon *</label><input name="phone" type="tel" maxlength="40" required autocomplete="off">'+'<p class="mut" style="margin:14px 0 0">Uživateli přijde e-mail s odkazem — při prvním přihlášení si sám vymyslí heslo.</p>',d=>call('/admin/api/users',d),'Vytvořit a poslat pozvánku')};
document.addEventListener('click',async e=>{const b=e.target.closest('.ulink,.utog,.udel,.upw');if(!b)return;const id=b.dataset.id;
if(b.classList.contains('upw')){modal('Nastavit heslo',pwf,d=>call('/admin/api/users/'+id+'/password',d));return}
if(b.classList.contains('ulink')){if(!confirm('Poslat uživateli e-mail s odkazem pro nastavení hesla?'))return;const j=await call('/admin/api/users/'+id+'/link');um.textContent=j.ok?'E-mail odeslán ✓':(j.error||'E-mail se nepodařilo odeslat');return}
if(b.classList.contains('utog')){const j=await call('/admin/api/users/'+id,{active:b.dataset.a==='1'});if(j.ok)location.reload();else um.textContent=j.error||'Chyba';return}
if(!confirm('Opravdu smazat tohoto uživatele administrace?'))return;const j=await call('/admin/api/users/'+id+'/delete');if(j.ok)location.reload();else um.textContent=j.error||'Chyba'});
</script></body></html>`);
});
app.post('/admin/api/users', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const b = req.body || {}, c = (v, n) => String(v || '').trim().slice(0, n);
  const first = c(b.first_name, 60), last = c(b.last_name, 60), email = c(b.email, 160).toLowerCase(), phone = c(b.phone, 40);
  if (!first || !last) return res.json({ ok: false, error: 'Vyplňte jméno i příjmení' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.json({ ok: false, error: 'Neplatný e-mail' });
  if (phone.replace(/\D/g, '').length < 7) return res.json({ ok: false, error: 'Vyplňte telefonní číslo' });
  try { await q('INSERT INTO admin_users (email, name, first_name, last_name, phone) VALUES ($1,$2,$3,$4,$5)', [email, first + ' ' + last, first, last, phone]); { const sent = await sendAdminLink(email, 'cs', 'setup'); res.json({ ok: true, sent, error: sent ? undefined : luMailErr }); } }
  catch (e) { res.json({ ok: false, error: /unique|duplicate/i.test(e.message) ? 'Tento e-mail už je v seznamu' : 'Uložení se nepovedlo' }); }
});
app.post('/admin/api/users/:id(\\d+)', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const r = (await q('SELECT email FROM admin_users WHERE id=$1', [req.params.id])).rows[0];
  if (!r) return res.json({ ok: false, error: 'Nenalezeno' });
  if (req.body.active === false && String(r.email).toLowerCase() === String((req.admin && req.admin.email) || '').toLowerCase()) return res.json({ ok: false, error: 'Sám sebe zakázat nelze' });
  await q('UPDATE admin_users SET active=$2 WHERE id=$1', [req.params.id, !!req.body.active]); res.json({ ok: true });
});
app.post('/admin/api/users/:id(\\d+)/password', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (pw.length < 8) return res.json({ ok: false, error: 'Heslo musí mít aspoň 8 znaků' });
  const r = await q('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [req.params.id, hashPw(pw)]);
  res.json({ ok: r.rowCount > 0, error: r.rowCount ? undefined : 'Nenalezeno' });
});
app.post('/admin/api/users/:id(\\d+)/link', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const r = (await q('SELECT * FROM admin_users WHERE id=$1 AND active', [req.params.id])).rows[0];
  if (!r) return res.json({ ok: false, error: 'Uživatel nenalezen nebo je zakázán' });
  { const ok = await sendAdminLink(String(r.email).toLowerCase(), 'cs', 'setup'); res.json({ ok, error: ok ? undefined : 'E-mail se nepodařilo odeslat — ' + luMailErr }); }
});
app.post('/admin/api/users/:id(\\d+)/delete', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const r = (await q('SELECT email FROM admin_users WHERE id=$1', [req.params.id])).rows[0];
  if (!r) return res.json({ ok: false, error: 'Nenalezeno' });
  if (String(r.email).toLowerCase() === String((req.admin && req.admin.email) || '').toLowerCase()) return res.json({ ok: false, error: 'Sám sebe smazat nelze' });
  await q('DELETE FROM admin_users WHERE id=$1', [req.params.id]); res.json({ ok: true });
});
// ── Modelace business modelu: plátno s myšlenkovou mapou ────────────────────
let MODEL_JS = null;
// ── Rozdělení financí ──
let FIN_JS = null;
app.get('/admin/finance.js', requireAdmin, (req, res) => {
  if (!FIN_JS) FIN_JS = fs.readFileSync(path.join(__dirname, 'finance-client.js'), 'utf8');
  res.set('Cache-Control', 'no-cache').type('application/javascript').send(FIN_JS);
});
const FIN_DEFAULT = { cols: ['Výroba', 'Master partner', 'Operátor', 'Provozovatel prádlomatu'].map((name, i) => ({ id: 'c_' + (i + 1), name })), rows: [] };
const finClean = (d) => {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n), idc = (v) => str(v, 40).replace(/[^\w-]/g, '');
  const cols = (Array.isArray(d && d.cols) ? d.cols : []).slice(0, 20).map((c) => ({ id: idc(c.id), name: str(c.name, 60) })).filter((c) => c.id);
  const ids = new Set(cols.map((c) => c.id));
  const rows = (Array.isArray(d && d.rows) ? d.rows : []).slice(0, 300).map((r) => {
    const v = {}; Object.keys((r && r.v) || {}).forEach((k) => { const x = Number(r.v[k]); if (ids.has(k) && isFinite(x)) v[k] = Math.max(0, Math.min(100, Math.round(x * 100) / 100)); });
    const amt = Number(r.amt);
    return { id: idc(r.id), name: str(r.name, 200), freq: ['once', 'tx', 'day', 'week', 'month', 'quarter', 'year'].includes(r.freq) ? r.freq : undefined, amt: r.amt != null && r.amt !== '' && isFinite(amt) && amt >= 0 ? Math.min(1e12, Math.round(amt * 100) / 100) : undefined, pct: r.pct != null && r.pct !== '' && isFinite(Number(r.pct)) && Number(r.pct) >= 0 ? Math.min(1000, Math.round(Number(r.pct) * 100) / 100) : undefined, price: r.price != null && r.price !== '' && isFinite(Number(r.price)) && Number(r.price) >= 0 ? Math.min(1e12, Math.round(Number(r.price) * 100) / 100) : undefined, v };
  }).filter((r) => r.id);
  return { cols, rows };
};
app.get('/admin/api/finance', requireAdmin, async (req, res) => {
  try {
    let r = (await q('SELECT data, rev FROM finance_split WHERE id=1')).rows[0];
    if (!r) { await q('INSERT INTO finance_split (id, data) VALUES (1,$1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(FIN_DEFAULT)]); r = (await q('SELECT data, rev FROM finance_split WHERE id=1')).rows[0]; }
    res.set('Cache-Control', 'no-store').json({ ok: true, data: r.data, rev: r.rev });
  } catch (e) { res.json({ ok: false, error: 'Tabulku se nepodařilo načíst' }); }
});
app.post('/admin/api/finance', requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const b = req.body || {}, data = finClean(b.data);
    const r = await q('UPDATE finance_split SET data=$1, rev=rev+1, updated_at=now(), updated_by=$3 WHERE id=1 AND rev=$2 RETURNING rev', [JSON.stringify(data), Number(b.rev) || 0, (req.admin && req.admin.name) || '']);
    if (!r.rowCount) return res.status(409).json({ ok: false, error: 'Tabulku mezitím změnil jiný uživatel' });
    res.json({ ok: true, rev: r.rows[0].rev });
  } catch (e) { res.json({ ok: false, error: 'Uložení se nepovedlo' }); }
});
const FIN_CSS = `
.fxh{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0 4px}.fxh h3{margin:0}
.fxbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0 12px}
.fxbar button{background:#07111f;border:1px solid var(--line);color:var(--text);border-radius:9px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;width:auto}.fxbar button:hover{border-color:var(--cy)}
#fx-st{font-size:12.5px;color:#86efac;margin-left:6px}
.fxw{overflow:auto;border:1px solid var(--line);border-radius:14px;background:rgba(8,15,30,.6);max-width:100%}
#fx{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed}
#fx th{position:sticky;top:0;background:#0b1630;z-index:2;text-align:left;padding:10px 6px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);border-bottom:1px solid var(--line)}
#fx td{padding:6px 5px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:middle}
#fx tbody tr:hover td{background:rgba(34,230,255,.04)}
#fx .c0{width:34px;color:var(--mut);text-align:center}#fx .cn{width:17%}#fx .cr{width:150px}#fx .cm{width:250px}#fx .sp{display:flex;gap:4px}#fx .sp .pc{flex:1;min-width:0}#fx .sub{display:block;margin-top:2px;font-size:10.5px;letter-spacing:.03em;text-transform:none;color:#6f84a6;font-weight:500}#fx .cf{width:132px}#fx .cp{min-width:0}#fx .cs{width:138px;white-space:nowrap}#fx .ca{width:104px;white-space:nowrap;text-align:right}
#fx .ain{text-align:right;font-variant-numeric:tabular-nums;padding-right:26px}#fx .dph{display:inline-block;margin-left:4px;padding:1px 7px;border-radius:999px;background:rgba(251,191,36,.16);color:#fcd34d;font-size:10.5px;letter-spacing:.04em;vertical-align:middle}
#fx select.fin{background:#07111f;border:1px solid transparent;border-radius:8px;color:var(--text);font:inherit;font-size:14px;padding:7px 6px;width:100%;box-sizing:border-box;cursor:pointer}#fx select.fin:hover{border-color:var(--line)}#fx select.fin:focus{outline:none;border-color:var(--cy)}#fx select.fin option{background:#0b1630}
#fx input{background:#07111f;border:1px solid transparent;border-radius:8px;color:var(--text);font:inherit;font-size:14px;padding:7px 9px;width:100%;box-sizing:border-box}
#fx input:hover{border-color:var(--line)}#fx input:focus{outline:none;border-color:var(--cy);background:#0a1830}
#fx .hin{font-weight:700;text-transform:none;letter-spacing:0;color:#eaf6ff;font-size:13.5px;background:rgba(34,230,255,.07)}
#fx .ch{display:flex;align-items:center;gap:4px}#fx .x{background:none;border:0;color:#6f84a6;cursor:pointer;font-size:13px;padding:2px 4px;width:auto}#fx .x:hover{color:#fca5a5}
#fx .eu{text-align:right;font-size:11.5px;color:#7f93b5;padding:2px 26px 0 0;min-height:15px;font-variant-numeric:tabular-nums}#fx input.cl{border-color:#f87171!important;background:rgba(248,113,113,.16)!important}#fx input:disabled{opacity:.45;cursor:not-allowed}#fx .pc{position:relative;display:block}#fx .pc .vin{text-align:right;padding-right:26px;font-variant-numeric:tabular-nums}#fx .pc i{position:absolute;right:9px;top:50%;transform:translateY(-50%);color:var(--mut);font-style:normal;font-size:13px;pointer-events:none}
.fxc{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}.fxc.ok{background:rgba(34,197,94,.18);color:#86efac}.fxc.w{background:rgba(251,191,36,.16);color:#fcd34d}.fxc.bad{background:rgba(248,113,113,.2);color:#fca5a5}.fxc.n{color:var(--mut)}
#fx .ib{background:none;border:1px solid transparent;border-radius:7px;color:#9fb4d6;cursor:pointer;font-size:13px;padding:3px 4px;width:auto}#fx .ib:hover{border-color:var(--line);color:#fff}
#fx .empty{text-align:center;color:var(--mut);padding:34px 14px;line-height:1.7}
@media(max-width:900px){.fxw{overflow-x:auto}#fx{min-width:820px}}`;
app.get('/admin/finance', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Rozdělení financí — Laundry Unlimited</title>
<style>${ADMIN_CSS}${BAR_CSS}.adm{max-width:none;padding:22px}.mut{color:var(--mut);font-size:13px}${FIN_CSS}</style></head><body>${topBar({ mode: 'admin', active: 'split' })}
<div class="adm"><div class="fxh"><h3>Rozdělení financí</h3></div>
<p class="mut" style="margin:4px 0 0;max-width:820px">Řádek = cokoli, co se dělí (např. cena prádlomatu, provize, servis). Sloupec = pozice, mezi které se dělí. Nejdřív zadej cenu a kolik z ní jsou volné prostředky na rozdělení (např. 10 %). Do pozic pak napiš podíl v % z ceny — dohromady maximálně tolik, kolik je k rozdělení; pod procentem se ukáže částka v €. Vše se ukládá samo.</p>
<div class="fxbar"><button id="fx-addrow" type="button">＋ Přidat řádek</button><button id="fx-addcol" type="button">＋ Přidat pozici</button><span id="fx-st"></span></div>
<div class="fxw"><table id="fx"></table></div></div>
<script src="/admin/finance.js"></script></body></html>`);
});
app.get('/admin/model.js', requireAdmin, (req, res) => {
  if (!MODEL_JS) MODEL_JS = fs.readFileSync(path.join(__dirname, 'model-client.js'), 'utf8');
  res.set('Cache-Control', 'no-cache').type('application/javascript').send(MODEL_JS);
});
const MODEL_CSS = `
#mb{position:fixed;left:244px;top:0;right:0;bottom:0;background:#050a14;overflow:hidden}
#mb-view{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;background-image:radial-gradient(rgba(122,168,255,.22) 1.2px,transparent 1.4px);background-size:28px 28px;user-select:none;-webkit-user-select:none}
#mb-view.pan{cursor:grabbing}
#mb-world{position:absolute;left:0;top:0;transform-origin:0 0}
#mb-svg{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}#mb-svg .eh{pointer-events:stroke}
#mb-nodes{position:absolute;left:0;top:0}
.n{position:absolute;min-width:120px;max-width:280px;padding:12px 16px;border-radius:14px;background:#0d1b30;border:2px solid var(--c,#22e6ff);color:#eef4ff;font-size:15px;line-height:1.35;cursor:move;box-shadow:0 8px 26px -10px rgba(0,0,0,.7),0 0 18px -8px var(--c,#22e6ff)}
.n .t{white-space:pre-wrap;word-break:break-word;min-height:20px;outline:none;cursor:inherit}.n.edit{cursor:text;user-select:text;-webkit-user-select:text}.n.edit .t{cursor:text}
.n{box-sizing:border-box}.n.sized{max-width:none;min-width:60px;display:flex;align-items:center}.n.sized .t{width:100%}
.n .rz{position:absolute;z-index:1}.n .h{z-index:3}
.n .rz-n{top:-5px;left:16px;right:16px;height:9px;cursor:ns-resize}.n .rz-s{bottom:-5px;left:16px;right:16px;height:9px;cursor:ns-resize}
.n .rz-w{left:-5px;top:16px;bottom:16px;width:9px;cursor:ew-resize}.n .rz-e{right:-5px;top:16px;bottom:16px;width:9px;cursor:ew-resize}
.n .rz-nw{left:-6px;top:-6px;width:16px;height:16px;cursor:nwse-resize;z-index:2}.n .rz-se{right:-6px;bottom:-6px;width:16px;height:16px;cursor:nwse-resize;z-index:2}
.n .rz-ne{right:-6px;top:-6px;width:16px;height:16px;cursor:nesw-resize;z-index:2}.n .rz-sw{left:-6px;bottom:-6px;width:16px;height:16px;cursor:nesw-resize;z-index:2}
.n.edit .rz,.n.edit .ed{display:none}
.n .fmt{display:none;position:absolute;left:0;top:-44px;gap:4px;align-items:center;padding:4px 6px;border-radius:10px;background:#0b1630;border:1px solid var(--c,#22e6ff);z-index:6;cursor:default;white-space:nowrap;font-size:13px}
.n.edit .fmt{display:flex}.n .fmt button{min-width:30px;height:26px;padding:0 6px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:#0d1b30;color:#eef4ff;font-family:inherit;font-weight:600;font-size:13px;line-height:1;cursor:pointer}
.n .fmt button:hover{background:rgba(34,230,255,.18)}.n .fmt button.on{background:var(--c,#22e6ff);color:#050a14}.n .fmt .fz{min-width:24px;text-align:center;color:#9fb4d6}.n .fmt .fb{font-weight:900!important}
.n .ed{position:absolute;right:4px;top:-30px;width:26px;height:26px;padding:0;border-radius:50%;border:1px solid var(--c,#22e6ff);background:#0d1b30;color:var(--c,#22e6ff);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s;z-index:4}
.n .ed::after{content:"";position:absolute;left:-4px;right:-4px;top:100%;height:8px}
.n:hover .ed,.n.sel .ed{opacity:1;pointer-events:auto}.n .ed:hover{background:var(--c,#22e6ff);color:#050a14}
.n.sel{box-shadow:0 0 0 3px rgba(255,255,255,.85),0 0 26px -4px var(--c,#22e6ff)}.n.tgt{box-shadow:0 0 0 3px #22c55e,0 0 26px -4px #22c55e}
.n .h{position:absolute;width:18px;height:18px;border-radius:50%;background:var(--c,#22e6ff);border:2px solid #050a14;cursor:crosshair;opacity:0;transition:opacity .15s,transform .15s}
.n .h-r{right:-10px;top:50%;margin-top:-9px}.n .h-l{left:-10px;top:50%;margin-top:-9px}.n .h-t{top:-10px;left:50%;margin-left:-9px}.n .h-b{bottom:-10px;left:50%;margin-left:-9px}.n:hover .h,.n.sel .h{opacity:1}.n .h:hover{transform:scale(1.25)}
#mb-bar{position:absolute;left:14px;top:12px;max-width:calc(100% - 400px);z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;border-radius:14px;background:rgba(10,18,36,.92);border:1px solid var(--line);backdrop-filter:blur(10px)}
#mb-bar button,#mb-bar select{background:#07111f;border:1px solid var(--line);color:var(--text);border-radius:9px;padding:7px 11px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;width:auto}
#mb-bar button:hover:not(:disabled){border-color:var(--cy)}#mb-bar button:disabled{opacity:.35;cursor:default}
#mb-bar .sep{width:1px;align-self:stretch;background:var(--line);margin:0 2px}
#mb-colors{display:flex;gap:5px;align-items:center}#mb-colors button{width:20px;height:20px;padding:0;border-radius:50%;border:2px solid transparent}#mb-colors button.on{border-color:#fff}
#mb-st{font-size:12px;color:#86efac;min-width:80px}#mb-zoom{font-size:12px;color:var(--mut);min-width:42px;text-align:center}
#mb-bar #mb-ai{background:linear-gradient(90deg,rgba(34,230,255,.2),rgba(167,139,250,.2));border-color:rgba(34,230,255,.55)}
#mb-ai-p{position:absolute;right:14px;top:70px;bottom:14px;width:min(460px,calc(100% - 28px));z-index:9;display:flex;flex-direction:column;border-radius:16px;background:rgba(8,15,30,.97);border:1px solid var(--line);box-shadow:0 30px 80px -20px #000;backdrop-filter:blur(12px);overflow:hidden}
#mb-ai-p .aih{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}#mb-ai-p .aib{display:flex;gap:6px}
#mb-ai-p button{background:#07111f;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;width:auto}#mb-ai-p button:hover{border-color:var(--cy)}
.aitabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--line);flex-wrap:wrap}.aitabs button{border-radius:999px!important}.aitabs button.on{background:var(--cy)!important;color:#04101c!important;border-color:var(--cy)!important}
#mb-ai-body{overflow:auto;padding:14px;font-size:13.5px;line-height:1.55;flex:1}
#mb-ai-body h4{margin:16px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8eeaff}#mb-ai-body h4:first-child{margin-top:0}
#mb-ai-body .it{padding:9px 11px;margin:0 0 7px;border:1px solid var(--line);border-radius:10px;background:#07111f}#mb-ai-body .it[data-u]{cursor:pointer}#mb-ai-body .it[data-u]:hover{border-color:var(--cy)}
#mb-ai-body .it b{color:#fff}#mb-ai-body .m{color:var(--mut);font-size:12.5px}#mb-ai-body ol,#mb-ai-body ul{margin:4px 0 0;padding-left:18px}
#mb-ai-body .pr{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-left:6px}.pr.v{background:rgba(248,113,113,.2);color:#fca5a5}.pr.s{background:rgba(251,191,36,.18);color:#fcd34d}.pr.n{background:rgba(148,163,184,.2);color:#cbd5e1}
#mb-ai-body .ld{text-align:center;color:var(--mut);padding:50px 10px}#mb-ai-body .sp{width:34px;height:34px;margin:0 auto 14px;border-radius:50%;border:3px solid rgba(34,230,255,.2);border-top-color:#22e6ff;animation:aisp 0.9s linear infinite}@keyframes aisp{to{transform:rotate(360deg)}}
#mb-ai-body .go{width:100%;padding:10px!important;margin-top:8px;background:linear-gradient(90deg,#22e6ff,#2f7bff)!important;color:#04101c!important;border:0!important;font-size:13px!important}
#mb-ai-body label.it{display:flex;gap:9px;align-items:flex-start;cursor:pointer}#mb-ai-body label.it input{margin-top:3px;width:auto}
.aiin{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);align-items:flex-end}#mb-ai-in{flex:1;resize:none;min-height:42px;max-height:140px;border-radius:10px;border:1px solid var(--line);background:#07111f;color:var(--text);font:inherit;font-size:13.5px;padding:9px 11px;width:auto}
#mb-ai-p .aiin button{padding:10px 14px;background:linear-gradient(90deg,#22e6ff,#2f7bff);color:#04101c;border:0;font-size:13px}#mb-ai-p .aiin button:disabled{opacity:.5}
.cb{max-width:92%;margin:0 0 10px;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}.cb.md{white-space:normal}.cb.md p{margin:0 0 6px}.cb.md ul,.cb.md ol{margin:3px 0 8px;padding-left:19px}.cb.md li{margin:2px 0}.cb .mh{font-weight:700;color:#8eeaff;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;margin:9px 0 4px}.cb .mh:first-child{margin-top:0}.cb .chips{margin:10px 0 0}
.cb.u{margin-left:auto;background:rgba(34,230,255,.16);border:1px solid rgba(34,230,255,.35)}.cb.a{background:#0d1b30;border:1px solid var(--line)}
.cb .chg{margin-top:8px;padding:8px 10px;border-radius:9px;background:#07111f;border:1px solid var(--line);font-size:12.5px;white-space:normal}.cb .chg div{margin:2px 0}.cb .chg .ap{width:100%;margin-top:8px;padding:8px!important;background:linear-gradient(90deg,#22e6ff,#2f7bff)!important;color:#04101c!important;border:0!important}.cb .chg .ap:disabled{background:#14304a!important;color:#86efac!important}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chips button{border-radius:999px!important;font-size:12px!important}
#mb-ai-body .ask{margin-top:6px;font-size:11.5px!important;padding:3px 9px!important}
.n.hl{box-shadow:0 0 0 3px #fbbf24,0 0 30px 2px rgba(251,191,36,.6)!important}
#mb-title{position:absolute;left:16px;bottom:14px;z-index:4;font-size:13px;color:var(--mut);pointer-events:none}
#mb-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3;text-align:center;color:var(--mut);max-width:420px;line-height:1.7}
#mb-empty b{color:var(--text);font-size:18px;display:block;margin-bottom:6px}
#mb-help{position:absolute;right:14px;bottom:12px;z-index:4;font-size:11.5px;color:#6f84a6;text-align:right;line-height:1.55;pointer-events:none}
@media(max-width:900px){#mb{position:relative;left:auto;right:auto;top:auto;bottom:auto;height:calc(100vh - 190px);min-height:440px}#mb-bar{max-width:calc(100% - 28px)}#mb-help{display:none}}`;
app.get('/admin/model', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Modelace business modelu — Laundry Unlimited</title>
<style>${ADMIN_CSS}${BAR_CSS}@media(min-width:901px){body:has(> .uside){overflow:hidden}}${MODEL_CSS}</style></head><body>${topBar({ mode: 'admin', active: 'model' })}
<div id="mb"><div id="mb-view"><div id="mb-world"><svg id="mb-svg"></svg><div id="mb-nodes"></div></div></div>
<div id="mb-bar"><select id="mb-sel" title="Plátno"></select><button id="mb-newb" type="button" title="Nové plátno">＋ Plátno</button><button id="mb-ren" type="button" title="Přejmenovat plátno">✎</button><button id="mb-delb" type="button" title="Smazat plátno">🗑</button><span class="sep"></span>
<button id="mb-add" type="button">＋ Uzel</button><span id="mb-selbox" style="display:none;gap:8px;align-items:center"><button id="mb-child" type="button" title="Přidat navazující uzel (Tab)">↳ Navazující</button><span id="mb-colors"></span><button id="mb-del" type="button" title="Smazat vybrané (Delete)">Smazat</button></span><span class="sep"></span>
<button id="mb-undo" type="button" title="Zpět (Ctrl+Z)">↶</button><button id="mb-redo" type="button" title="Znovu (Ctrl+Y)">↷</button><span class="sep"></span>
<button id="mb-zout" type="button">−</button><span id="mb-zoom">100 %</span><button id="mb-zin" type="button">＋</button><button id="mb-fit" type="button" title="Zobrazit vše">Vše</button><span class="sep"></span><button id="mb-ai" type="button" title="AI zpracuje mapu: ukáže, jak jí rozumí, najde mezery a dopracuje ji do finální podoby">✨ Zpracovat mapu</button><span id="mb-st"></span></div>
<div id="mb-ai-p" style="display:none"><div class="aih"><b>✨ Zpracování mapy</b><span class="aib"><button type="button" id="mb-ai-re" title="Zpracovat znovu">↻ Znovu</button><button type="button" id="mb-ai-md" title="Stáhnout rozbor jako dokument">⬇ Dokument</button><button type="button" id="mb-ai-x" title="Zavřít">✕</button></span></div><div class="aitabs" id="mb-ai-tabs"></div><div id="mb-ai-body"></div><div class="aiin"><textarea id="mb-ai-in" rows="2" placeholder="Zeptej se poradce, dolaď věci, řekni rozhodnutí… (Enter odešle, Shift+Enter nový řádek)"></textarea><button type="button" id="mb-ai-send">Odeslat</button></div></div>
<div id="mb-title"></div>
<div id="mb-empty" style="display:none"><b>Prázdné plátno</b>Dvojklikem do plátna přidáš první uzel. Z kroužku na kraji uzlu přetáhni čáru do prázdna — vznikne navazující uzel, nebo na jiný uzel — spojí je.</div>
<div id="mb-help">Dvojklik = nový / upravit uzel · Tab = navazující uzel · Delete = smazat<br>Kolečko = zoom · tažení prázdného místa = posun · Ctrl+Z = zpět</div></div>
<script src="/admin/model.js"></script></body></html>`);
});
const modelClean = (d) => {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n), num = (v) => { const x = Math.round(Number(v)); return isFinite(x) ? Math.max(-100000, Math.min(100000, x)) : 0; };
  const nodes = (Array.isArray(d && d.nodes) ? d.nodes : []).slice(0, 500).map((n) => ({ id: str(n.id, 40).replace(/[^\w-]/g, ''), x: num(n.x), y: num(n.y), w: isFinite(Number(n.w)) && Number(n.w) > 0 ? Math.max(60, Math.min(2000, Math.round(Number(n.w)))) : undefined, h: isFinite(Number(n.h)) && Number(n.h) > 0 ? Math.max(34, Math.min(2000, Math.round(Number(n.h)))) : undefined, fz: isFinite(Number(n.fz)) && Number(n.fz) > 0 ? Math.max(8, Math.min(120, Math.round(Number(n.fz)))) : undefined, b: n.b ? true : undefined, al: n.al === 'c' || n.al === 'r' ? n.al : undefined, text: str(n.text, 2000), color: /^#[0-9a-f]{6}$/i.test(String(n.color || '')) ? n.color : '#22e6ff' })).filter((n) => n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(d && d.edges) ? d.edges : []).slice(0, 1500).map((e) => ({ id: str(e.id, 40).replace(/[^\w-]/g, ''), from: str(e.from, 40).replace(/[^\w-]/g, ''), to: str(e.to, 40).replace(/[^\w-]/g, ''), fs: /^[lrtb]$/.test(String(e.fs)) ? e.fs : undefined, ts: /^[lrtb]$/.test(String(e.ts)) ? e.ts : undefined })).filter((e) => e.id && ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  return { nodes, edges };
};
app.get('/admin/api/model/boards', requireAdmin, async (req, res) => {
  try {
    let rows = (await q('SELECT id, name, updated_at FROM model_boards ORDER BY id')).rows;
    if (!rows.length) { await q('INSERT INTO model_boards (name, data) VALUES ($1,$2)', ['Business model', JSON.stringify({ nodes: [{ id: 'n_root', x: 0, y: 0, text: 'Business model', color: '#22e6ff' }], edges: [] })]); rows = (await q('SELECT id, name, updated_at FROM model_boards ORDER BY id')).rows; }
    res.json({ ok: true, boards: rows });
  } catch (e) { res.json({ ok: false, error: 'Plátna se nepodařilo načíst' }); }
});
app.get('/admin/api/model/boards/:id(\\d+)', requireAdmin, async (req, res) => {
  const r = (await q('SELECT id, name, data, rev FROM model_boards WHERE id=$1', [req.params.id]).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return res.json({ ok: false, error: 'Plátno nenalezeno' });
  res.set('Cache-Control', 'no-store').json({ ok: true, id: r.id, name: r.name, data: r.data, rev: r.rev });
});
app.post('/admin/api/model/boards', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 80);
  if (!name) return res.json({ ok: false, error: 'Zadejte název plátna' });
  const r = (await q('INSERT INTO model_boards (name, updated_by) VALUES ($1,$2) RETURNING id, name', [name, (req.admin && req.admin.name) || ''])).rows[0];
  res.json({ ok: true, id: r.id, name: r.name });
});
app.post('/admin/api/model/boards/:id(\\d+)', requireAdmin, express.json({ limit: '3mb' }), async (req, res) => {
  const b = req.body || {}; const data = modelClean(b.data);
  // Optimistická kontrola verze: když mezitím uložil někdo jiný, nepřepíšeme jeho práci
  const r = await q('UPDATE model_boards SET data=$2, rev=rev+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND rev=$3 RETURNING rev', [req.params.id, JSON.stringify(data), Number(b.rev) || 0, (req.admin && req.admin.name) || '']);
  if (!r.rowCount) { const ex = (await q('SELECT 1 FROM model_boards WHERE id=$1', [req.params.id])).rowCount; return res.status(ex ? 409 : 404).json({ ok: false, error: ex ? 'Plátno mezitím změnil jiný uživatel' : 'Plátno nenalezeno' }); }
  res.json({ ok: true, rev: r.rows[0].rev });
});
const modelGraphText = (d) => {
  const txt = (s) => String(s).replace(/\s+/g, ' ').trim();
  return 'UZLY:\n' + d.nodes.map((n) => '[' + n.id + '] ' + txt(n.text || '(prázdný)')).join('\n') + '\n\nSPOJENÍ:\n' + d.edges.map((e) => e.from + ' → ' + e.to).join('\n');
};
// AI rozbor mapy: server z plátna poskládá text (uzly + spojení), HolyOS (Claude) vrátí strukturovaný výsledek
app.post('/admin/api/model/boards/:id(\\d+)/analyze', requireAdmin, express.json({ limit: '3mb' }), async (req, res) => {
  try {
    if (!LU_SECRET) return res.json({ ok: false, error: 'Chybí LU_SSO_SECRET' });
    const d = modelClean((req.body || {}).data);
    if (d.nodes.length < 2) return res.json({ ok: false, error: 'Na plátně je málo uzlů k rozboru' });
    const nm = (await q('SELECT name FROM model_boards WHERE id=$1', [req.params.id]).catch(() => ({ rows: [] }))).rows[0];
    const graph = modelGraphText(d);
    const svc = jwt.sign({ aud: 'holyos-api', iss: 'laundry-unlimited' }, LU_SECRET, { expiresIn: '5m' });
    const resp = await fetch(HOLYOS_URL + '/api/auth/lu/model-analyze', { method: 'POST', headers: { Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm ? nm.name : 'Business model', graph }), signal: AbortSignal.timeout(280000) });
    let j = {}; try { j = await resp.json(); } catch (e) { /* bez těla */ }
    if (!resp.ok || !j.ok) return res.json({ ok: false, error: j.error || ('HolyOS odpovědělo ' + resp.status) });
    res.json({ ok: true, result: j.result, truncated: !!j.truncated, nodes: d.nodes.length, edges: d.edges.length });
  } catch (e) { console.warn('[lu] model analyze:', e.message); res.json({ ok: false, error: e.name === 'TimeoutError' ? 'Rozbor trval příliš dlouho — zkuste to znovu' : 'Rozbor se nepovedl: ' + e.message }); }
});
// AI poradce nad mapou: rozhovor (historie z prohlížeče), HolyOS vrací odpověď + navržené změny plátna
app.post('/admin/api/model/boards/:id(\\d+)/chat', requireAdmin, express.json({ limit: '3mb' }), async (req, res) => {
  try {
    if (!LU_SECRET) return res.json({ ok: false, error: 'Chybí LU_SSO_SECRET' });
    const b = req.body || {}, d = modelClean(b.data), message = String(b.message || '').trim().slice(0, 4000);
    if (!message) return res.json({ ok: false, error: 'Napište zprávu' });
    const nm = (await q('SELECT name FROM model_boards WHERE id=$1', [req.params.id]).catch(() => ({ rows: [] }))).rows[0];
    const svc = jwt.sign({ aud: 'holyos-api', iss: 'laundry-unlimited' }, LU_SECRET, { expiresIn: '5m' });
    const resp = await fetch(HOLYOS_URL + '/api/auth/lu/model-chat', { method: 'POST', headers: { Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nm ? nm.name : 'Business model', graph: modelGraphText(d), message, history: Array.isArray(b.history) ? b.history.slice(-14) : [], brief: String(b.brief || '').slice(0, 6000) }), signal: AbortSignal.timeout(150000) });
    let j = {}; try { j = await resp.json(); } catch (e) { /* bez těla */ }
    if (!resp.ok || !j.ok) return res.json({ ok: false, error: j.error || ('HolyOS odpovědělo ' + resp.status) });
    res.json({ ok: true, odpoved: j.odpoved, zmeny: j.zmeny || [], rychle: j.rychle || [] });
  } catch (e) { console.warn('[lu] model chat:', e.message); res.json({ ok: false, error: e.name === 'TimeoutError' ? 'Odpověď trvala příliš dlouho — zkuste to znovu' : 'Poradce neodpověděl: ' + e.message }); }
});
app.post('/admin/api/model/boards/:id(\\d+)/rename', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 80);
  if (!name) return res.json({ ok: false, error: 'Zadejte název plátna' });
  const r = await q('UPDATE model_boards SET name=$2 WHERE id=$1 RETURNING name', [req.params.id, name]);
  res.json(r.rowCount ? { ok: true, name: r.rows[0].name } : { ok: false, error: 'Plátno nenalezeno' });
});
app.post('/admin/api/model/boards/:id(\\d+)/delete', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const n = (await q('SELECT count(*)::int AS n FROM model_boards')).rows[0].n;
  if (n < 2) return res.json({ ok: false, error: 'Poslední plátno nejde smazat' });
  await q('DELETE FROM model_boards WHERE id=$1', [req.params.id]); res.json({ ok: true });
});
app.get('/admin/m/:sekce(report|ekonomika|technika|proc)', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').send(materialsPage(req.params.sekce, topBar({ mode: 'admin', active: req.params.sekce }), 'Administrace'));
});
app.post('/admin/api/inquiry/:id(\\d+)/portal-link', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  const r = (await q('SELECT * FROM inquiries WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!r) return res.status(404).json({ ok: false, error: 'Lead nenalezen' });
  if (!r.portal_access) return res.status(400).json({ ok: false, error: 'Lead nemá zaškrtnutý přístup do portálu (ulož změny).' });
  const ok = await sendPortalLink(r);
  res.status(ok ? 200 : 502).json(ok ? { ok: true } : { ok: false, error: 'E-mail se nepodařilo odeslat' });
});
app.post('/admin/api/inquiry/:id(\\d+)/delete', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  await q('DELETE FROM inquiries WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true });
});
app.get('/admin/export.csv', requireAdmin, async (req, res) => {
  const rows = (await q('SELECT * FROM inquiries ORDER BY created_at DESC')).rows;
  const c = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  const head = ['Datum', 'Jazyk', 'Jméno', 'E-mail', 'Telefon', 'Firma', 'Země', 'Stav', 'Poznámka', ...QS_LABELS];
  const lines = rows.map((r) => { const a = r.answers || {}; return [fmtDt(r.created_at), r.lang, r.name, r.email, r.phone, r.company, r.country, stLabel(r.status), r.note, ...QS_KEYS.map((k) => a[k])].map(c).join(';'); });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="poptavky-laundry-unlimited-' + new Date().toISOString().slice(0, 10) + '.csv"' }).send('﻿' + head.map(c).join(';') + '\n' + lines.join('\n'));
});

app.use((req, res) => res.status(404).send(simplePage(req.lang || 'en', '404', 'Page not found.', req.path)));
app.use((err, req, res, next) => { console.error('[lu] chyba:', err && err.stack || err); res.status(500).type('text/plain').send('Server error'); }); // eslint-disable-line no-unused-vars

initDb().catch((e) => console.error('[lu] DB init:', e.message)).finally(() => app.listen(PORT, () => console.log('[lu] Laundry Unlimited běží na portu ' + PORT)));
