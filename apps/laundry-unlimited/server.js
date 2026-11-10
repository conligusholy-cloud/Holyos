// Laundry Unlimited — veřejný web pro hledání regionálních partnerů + administrace poptávek.
// Samostatná Railway služba s vlastní databází (PostgreSQL). Admin se otevírá přes SSO z HolyOS (LU_SSO_SECRET).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { LANGS, NAMES, T } = require('./i18n');

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
.bar nav a{color:var(--mut);text-decoration:none;position:relative;transition:color .25s}.bar nav a:not(.btn):hover{color:#fff}
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
@media(max-width:900px){.facts,.mgrid,.duo,.steps,.brands,.row2{grid-template-columns:1fr}.bento{grid-template-columns:1fr}.bento>.b{grid-column:auto!important;min-height:0}
section{padding:80px 0}.hero{padding:140px 0 40px}.facts{margin-top:50px}.sec-h{margin-bottom:36px;gap:18px}.bar{top:10px}.bar .wrap{height:58px;padding:0 8px 0 18px;gap:12px}.bar nav a.hide{display:none}.bar nav{gap:10px}
.drum{right:-45%;top:22%;width:120vw;opacity:.55}.big,.pan{padding:30px 24px 16px}.cta-card{padding:44px 28px}form.box{padding:32px 22px}.page{padding:120px 0 80px}.brands figure:nth-child(2){margin:0}.brands img{min-height:280px}.tick span{font-size:26px}.steps .line{display:none}.steps{padding-top:0}}
`;

const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h17M14 5l7 7-7 7"/></svg>';

function page({ lang, title, desc, body, canonicalPath, noindex }) {
  const t = T[lang];
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${PUBLIC_URL}${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? '' : canonicalPath}">`).join('');
  const sw = LANGS.map((l) => `<a class="${l === lang ? 'on' : ''}" href="${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? (l === 'en' ? '/' : '') : canonicalPath}" hreflang="${l}">${NAMES[l]}</a>`).join('');
  const base = lang === 'en' ? '' : '/' + lang;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || t.title)}</title><meta name="description" content="${esc(desc || t.desc)}">
${noindex ? '<meta name="robots" content="noindex">' : alts}<meta name="theme-color" content="#04080f">
<meta property="og:title" content="${esc(title || t.title)}"><meta property="og:description" content="${esc(desc || t.desc)}"><meta property="og:type" content="website"><meta property="og:image" content="${PUBLIC_URL}/img/ireland.webp">
<script>document.documentElement.className+=' js'</script><style>${SITE_CSS}</style></head><body>
<div class="aur"><i></i><i></i><i></i></div><div class="prog" id="prog"></div>
<div class="bar"><div class="wrap"><a href="${base || '/'}" style="display:block">${logoHtml(50)}</a>
<nav><a class="hide" href="${base}/#model">${esc(t.nav_model)}</a><a class="hide" href="${base}/#offer">${esc(t.nav_offer)}</a><a class="hide" href="${base}/#who">${esc(t.nav_who)}</a>
<div class="lang">${sw}</div><a class="btn" href="${base}/apply"><span>${esc(t.nav_apply)}${CHEV}</span></a></nav></div></div>
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
<div class="wrap hw"><span class="lbl">${esc(t.hero_kicker)}</span><h1>${esc(t.hero_h)}</h1><p class="lead">${esc(t.hero_p)}</p>
<div class="cta"><a class="btn" href="${base}/apply"><span>${esc(t.hero_cta)}${CHEV}</span></a><a class="btn line" href="#model"><span>${esc(t.hero_cta2)}</span></a></div>
<div class="facts">${stats}</div></div></div>
<div class="tick"><div>${tk}${tk}</div></div>
<section><div class="wrap"><div class="sec-h rv"><div><span class="lbl">Laundry Unlimited</span><h2>${esc(t.brands_h)}</h2></div><p>${esc(t.brands_p)}</p></div>
<div class="brands rv"><figure class="tilt"><img src="/img/ireland.webp" alt="" loading="lazy" width="1200" height="900"></figure><figure class="tilt"><img src="/img/blue.webp" alt="" loading="lazy" width="900" height="1200"></figure><figure class="tilt"><img src="/img/orlen.webp" alt="" loading="lazy" width="1200" height="900"></figure></div></div></section>
<section id="model"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_model)}</span><h2>${esc(t.model_h)}</h2></div><p>${esc(t.model_p)}</p></div>
<div class="mgrid"><div class="flow">
<div class="gl node rv"><small>01</small><h3>${esc(t.top_h)}</h3><p>${esc(t.top_p)}</p></div><div class="wire"></div>
<div class="gl node rv" style="--i:1"><small>02</small><h3>${esc(t.mid_h)}</h3><p>${esc(t.mid_p)}</p></div><div class="wire"></div>
<div class="gl node hot rv" style="--i:2"><small>03</small><h3>${esc(t.market_h)}</h3><p>${esc(t.market_p)}</p></div></div>
<div class="gl big rv" style="--i:1"><h3>${esc(t.b_h.replace(/^B\s+/, ''))}</h3><small>${esc(t.b_p)}</small><ul class="ck">${li(t.b_li)}</ul></div></div></div></section>
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
<label class="chk"><input type="checkbox" name="consent" value="1" required> <span>${esc(t.f_consent)}</span></label>
<input type="hidden" name="utm" id="utm" value=""><div style="margin-top:26px"><button class="btn o" type="submit"><span>${esc(t.f_submit)}${CHEV}</span></button></div></form></div></div>
<script>try{var u={},p=new URLSearchParams(location.search);['utm_source','utm_medium','utm_campaign','gclid','fbclid'].forEach(function(k){if(p.get(k))u[k]=p.get(k)});if(document.referrer)u.ref=document.referrer.slice(0,200);document.getElementById('utm').value=JSON.stringify(u)}catch(e){}</script>`;
  return page({ lang, title: t.form_h + ' — Laundry Unlimited', body, canonicalPath: '/apply' });
}

function questionnairePage(lang, token, err) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const radios = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="radio" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const checks = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const body = `<div class="page"><div class="wrap"><span class="tag w">${esc(t.nav_apply)}</span><h2>${esc(t.q_h)}</h2><p class="sub">${esc(t.q_p)}</p>
<form class="box" method="post" action="${base}/questionnaire/${esc(token)}">${err ? `<div class="err">${esc(err)}</div>` : ''}
<label style="margin-top:0">${esc(t.q_territory)}</label><input name="territory" maxlength="200">
<label>${esc(t.q_exp)}</label>${radios('experience', t.q_exp_o)}
<label>${esc(t.q_team)}</label>${radios('team', t.q_team_o)}
<label>${esc(t.q_invest)}</label>${radios('investment', t.q_invest_o)}
<label>${esc(t.q_scope)}</label>${checks('scope', t.q_scope_o)}
<label>${esc(t.q_when)}</label>${radios('start', t.q_when_o)}
<label>${esc(t.q_heard)}</label>${radios('heard', t.q_heard_o)}
<label>${esc(t.q_msg)}</label><textarea name="message" maxlength="3000"></textarea>
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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));
const BEZ_JAZYKA = /^\/(api|admin|sso|robots\.txt|sitemap\.xml)/;
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
    let utm = null; try { const u = JSON.parse(String(b.utm || '{}')); if (u && typeof u === 'object') utm = JSON.stringify(u).slice(0, 1000); } catch (e) { /* bez UTM */ }
    await q('INSERT INTO inquiries (token, lang, name, email, phone, company, country, ip, user_agent, utm) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)', [token, lang, v.name, v.email, v.phone || null, v.company || null, v.country || null, req.ip, String(req.headers['user-agent'] || '').slice(0, 300), utm]);
    notifyHolyos('🧺 Nová poptávka (územní exkluzivita)', v.name + (v.country ? ' · ' + v.country : '') + ' · ' + v.email, '/');
    res.redirect(303, (lang === 'en' ? '' : '/' + lang) + '/questionnaire/' + token);
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
    const scope = [].concat(b.scope || []).map((x) => s(x, 120)).slice(0, 12);
    const answers = { territory: s(b.territory, 200), experience: s(b.experience, 120), team: s(b.team, 80), investment: s(b.investment, 80), scope, start: s(b.start, 80), heard: s(b.heard, 80), message: s(b.message, 3000) };
    await q("UPDATE inquiries SET answers=$2::jsonb, answered_at=now(), updated_at=now() WHERE id=$1", [row.id, JSON.stringify(answers)]);
    notifyHolyos('🧺 Dotazník vyplněn', (answers.territory || '—') + (answers.investment ? ' · ' + answers.investment : ''), '/');
    res.redirect(303, (lang === 'en' ? '' : '/' + lang) + '/thanks');
  } catch (e) { console.error('[lu] questionnaire:', e.message); res.status(500).send(questionnairePage(lang, req.params.token, T[lang].f_err_server)); }
});

// ── Administrace (SSO z HolyOS) ────────────────────────────────────────────
function adminOf(req) { if (!SESSION_KEY) return null; try { const t = jwt.verify(readCookie(req, COOKIE), SESSION_KEY, { audience: 'lu-admin', issuer: 'laundry-unlimited' }); return { name: t.name || '' }; } catch (e) { return null; } }
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
app.get('/admin/logout', (req, res) => { res.set('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'); res.redirect(302, '/'); });
const requireAdmin = (req, res, next) => {
  const a = adminOf(req); if (a) { req.admin = a; return next(); }
  if (req.path.startsWith('/admin/api/')) return res.status(401).json({ ok: false, error: 'Přihlášení vypršelo. Otevři sekci znovu z HolyOS.' });
  res.redirect(302, toHolyos());
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
  const ans = (a) => a ? [['Území', a.territory], ['Zkušenosti', a.experience], ['Tým', a.team], ['Investice', a.investment], ['Rozsah', (a.scope || []).join(', ')], ['Start', a.start], ['Odkud', a.heard], ['Zpráva', a.message]].filter((x) => x[1]).map((x) => `<div><span class="k">${esc(x[0])}</span> ${esc(x[1])}</div>`).join('') : '<div class="mut">Dotazník zatím nevyplněn.</div>';
  const tr = rows.map((r) => `<details class="r"><summary><span class="dot" style="background:${stColor[r.status] || '#64748b'}"></span><b>${esc(r.name)}</b>
<span class="mut">${esc(r.country || '')}${r.company ? ' · ' + esc(r.company) : ''}</span><span class="sp"></span><span class="chip" style="border-color:${stColor[r.status] || '#64748b'}">${esc(stLabel(r.status))}</span>${r.answers ? '<span class="chip ok">dotazník</span>' : ''}<span class="mut">${esc(r.lang.toUpperCase())} · ${fmtDt(r.created_at)}</span></summary>
<div class="det"><div class="g"><div><div class="k">E-mail</div><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div><div><div class="k">Telefon</div>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</div></div>
<div class="ans">${ans(r.answers)}</div>${r.utm && Object.keys(r.utm).length ? `<div class="mut small">Zdroj: ${esc(JSON.stringify(r.utm))}</div>` : ''}
<div class="act"><select data-id="${r.id}" class="st">${STATUSES.map((x) => `<option value="${x[0]}"${x[0] === r.status ? ' selected' : ''}>${x[1]}</option>`).join('')}</select>
<input class="note" data-id="${r.id}" placeholder="Poznámka…" value="${esc(r.note || '')}"><button class="btn sm save" data-id="${r.id}">Uložit</button><button class="btn sm ghost del" data-id="${r.id}" title="Smazat poptávku">Smazat</button><span class="msg"></span></div></div></details>`).join('');
  const chips = [['', 'Vše (' + total + ')']].concat(STATUSES.map((x) => [x[0], x[1] + ' (' + (counts[x[0]] || 0) + ')'])).map((x) => `<a class="chip${st === x[0] ? ' on' : ''}" href="/admin?s=${x[0]}${qs ? '&q=' + encodeURIComponent(qs) : ''}">${esc(x[1])}</a>`).join('');
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Laundry Unlimited — administrace</title>
<style>${ADMIN_CSS}.adm{max-width:1100px;margin:0 auto;padding:22px}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}.chip{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--text);text-decoration:none;background:#07111f}.chip.on{background:var(--bl)}.chip.ok{border-color:#22c55e;color:#86efac}
.r{border:1px solid var(--line);border-radius:14px;background:var(--card);margin:8px 0}.r summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px}.r summary::-webkit-details-marker{display:none}.sp{flex:1}
.dot{width:10px;height:10px;border-radius:50%}.mut{color:var(--mut);font-size:13px}.small{font-size:12px}.det{padding:0 16px 16px;border-top:1px solid var(--line)}.g{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.k{color:var(--mut);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-right:6px}
.ans div{margin:4px 0}.act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}.act select{width:auto}.act .note{flex:1;min-width:180px}.msg{font-size:13px;color:#86efac}</style></head><body><div class="adm">
<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">${logoHtml(36)}<h2 style="margin:0">Poptávky</h2><span class="sp"></span><a class="btn sm ghost" href="/admin/export.csv"><span>⬇ CSV</span></a><a class="btn sm ghost" href="${HOLYOS_URL}"><span>← HolyOS</span></a></div>
<div class="bar">${chips}<form method="get" action="/admin" style="margin-left:auto;display:flex;gap:6px"><input type="hidden" name="s" value="${esc(st)}"><input name="q" value="${esc(qs)}" placeholder="Hledat jméno, e-mail, zemi…" style="width:240px"><button class="btn sm">Hledat</button></form></div>
${tr || '<p class="mut">Zatím žádné poptávky.</p>'}</div>
<script>
async function call(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.json()}
document.addEventListener('click',async e=>{const b=e.target.closest('.save,.del');if(!b)return;const id=b.dataset.id,box=b.closest('.act'),m=box.querySelector('.msg');
if(b.classList.contains('del')){if(!confirm('Opravdu smazat tuto poptávku? Nelze vrátit.'))return;const j=await call('/admin/api/inquiry/'+id+'/delete',{});if(j.ok)location.reload();else m.textContent=j.error||'Chyba';return}
const j=await call('/admin/api/inquiry/'+id,{status:box.querySelector('.st').value,note:box.querySelector('.note').value});m.textContent=j.ok?'Uloženo ✓':(j.error||'Chyba');if(j.ok)setTimeout(()=>location.reload(),500)});
</script></body></html>`);
});
app.post('/admin/api/inquiry/:id(\\d+)', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
  const b = req.body || {}; const id = Number(req.params.id);
  if (!STATUSES.some((x) => x[0] === b.status)) return res.status(400).json({ ok: false, error: 'Neplatný stav' });
  await q('UPDATE inquiries SET status=$2, note=$3, updated_at=now() WHERE id=$1', [id, b.status, String(b.note || '').slice(0, 2000) || null]);
  res.json({ ok: true });
});
app.post('/admin/api/inquiry/:id(\\d+)/delete', requireAdmin, express.json({ limit: '2kb' }), async (req, res) => {
  await q('DELETE FROM inquiries WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true });
});
app.get('/admin/export.csv', requireAdmin, async (req, res) => {
  const rows = (await q('SELECT * FROM inquiries ORDER BY created_at DESC')).rows;
  const c = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  const head = ['Datum', 'Jazyk', 'Jméno', 'E-mail', 'Telefon', 'Firma', 'Země', 'Stav', 'Poznámka', 'Území', 'Zkušenosti', 'Tým', 'Investice', 'Rozsah', 'Start', 'Odkud', 'Zpráva'];
  const lines = rows.map((r) => { const a = r.answers || {}; return [fmtDt(r.created_at), r.lang, r.name, r.email, r.phone, r.company, r.country, stLabel(r.status), r.note, a.territory, a.experience, a.team, a.investment, (a.scope || []).join('; '), a.start, a.heard, a.message].map(c).join(';'); });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="poptavky-laundry-unlimited-' + new Date().toISOString().slice(0, 10) + '.csv"' }).send('﻿' + head.map(c).join(';') + '\n' + lines.join('\n'));
});

app.use((req, res) => res.status(404).send(simplePage(req.lang || 'en', '404', 'Page not found.', req.path)));
app.use((err, req, res, next) => { console.error('[lu] chyba:', err && err.stack || err); res.status(500).type('text/plain').send('Server error'); }); // eslint-disable-line no-unused-vars

initDb().catch((e) => console.error('[lu] DB init:', e.message)).finally(() => app.listen(PORT, () => console.log('[lu] Laundry Unlimited běží na portu ' + PORT)));
