// Laundry Unlimited — veřejný web pro hledání master franšízantů + administrace poptávek.
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
:root{--bg:#04080f;--bg2:#08111f;--panel:#0b1626;--line:rgba(255,255,255,.12);--txt:#eaf0f8;--mut:#9aa8bd;--ink:#08111f;--inkm:#55627a;--lite:#f4f7fb;--blue:#1e7cff;--cy:#00e5ff;--grad:linear-gradient(100deg,#1e7cff,#00e5ff);--ease:cubic-bezier(.16,1,.3,1)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--txt);font:17px/1.7 "Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;font-weight:300;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit}
.wrap{max-width:1240px;margin:0 auto;padding:0 32px}
.prog{position:fixed;left:0;top:0;height:2px;width:0;background:var(--grad);z-index:60;transition:width .1s linear}
.bar{position:sticky;top:0;z-index:40;background:rgba(4,8,15,.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
.bar .wrap{display:flex;align-items:center;gap:30px;height:80px}
.bar nav{margin-left:auto;display:flex;align-items:center;gap:34px;font-size:13px;font-weight:400;letter-spacing:.08em}
.bar nav a{color:var(--mut);text-decoration:none;transition:color .2s}.bar nav a:hover{color:#fff}
.lang{display:flex;gap:14px;font-size:11px;letter-spacing:.14em}.lang a{opacity:.5;text-decoration:none}.lang a.on{opacity:1;color:var(--cy)!important}
.chev{display:inline-block;width:1.15em;height:1.15em;vertical-align:-.2em;margin-left:.7em;transition:transform .35s var(--ease)}
.btn{display:inline-flex;align-items:center;background:var(--grad);color:#021018;font:600 12.5px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;border:0;padding:20px 32px;text-decoration:none;cursor:pointer;border-radius:2px;position:relative;overflow:hidden;transition:transform .35s var(--ease),box-shadow .35s var(--ease)}
.btn>span{position:relative;display:inline-flex;align-items:center}
.btn:hover{transform:translateY(-2px);box-shadow:0 14px 40px -10px rgba(0,229,255,.55)}.btn:hover .chev{transform:translateX(6px)}
.btn.o{background:var(--grad)}
.btn.line,.btn.dark{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}.btn.line:hover,.btn.dark:hover{box-shadow:inset 0 0 0 1px var(--cy),0 14px 40px -14px rgba(0,229,255,.4);color:#fff}
.btn.dark{background:var(--grad);color:#021018;box-shadow:none}
.bar .btn{padding:13px 20px;font-size:11px}
.lbl{display:inline-flex;align-items:center;gap:14px;font:500 11.5px/1 "Segoe UI",sans-serif;letter-spacing:.28em;text-transform:uppercase;color:var(--cy)}
.lbl:before{content:"";width:34px;height:1px;background:var(--grad)}
.tag{display:inline-flex;align-items:center;gap:14px;font:500 11.5px/1 "Segoe UI",sans-serif;letter-spacing:.28em;text-transform:uppercase;color:var(--cy);background:none;padding:0;transform:none}.tag:before{content:"";width:34px;height:1px;background:var(--grad)}.tag.w{color:var(--cy)}
h1,h2,h3{font-weight:200;margin:0;letter-spacing:-.025em;text-transform:none;font-family:"Segoe UI Light","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:#fff}
h1{font-size:clamp(44px,6.8vw,108px);line-height:1.02;margin:30px 0 32px;max-width:1000px}
h2{font-size:clamp(34px,4.4vw,64px);line-height:1.06;margin:22px 0 0}
h3{font-size:clamp(20px,1.9vw,26px);line-height:1.25;font-weight:300;margin-bottom:12px;letter-spacing:-.01em}
p{margin:0 0 14px}
.lead{font-size:clamp(18px,1.5vw,21px);line-height:1.65;color:var(--mut);max-width:620px;margin-bottom:44px}
.cta{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.hero{position:relative;overflow:hidden;padding:110px 0 0;background:radial-gradient(1100px 620px at 88% 8%,rgba(30,124,255,.38),transparent 60%),radial-gradient(700px 420px at 8% 100%,rgba(0,229,255,.12),transparent 60%),linear-gradient(180deg,#04080f,#071327);clip-path:polygon(0 0,100% 0,100% calc(100% - 4vw),0 100%);padding-bottom:calc(150px + 4vw)}
.hero:before{content:"";position:absolute;top:-20%;left:-30%;width:34%;height:150%;background:linear-gradient(90deg,transparent,rgba(120,190,255,.16),transparent);transform:skewX(-22deg);animation:beam 3.6s var(--ease) infinite;z-index:1}
@keyframes beam{0%{left:-40%}60%,100%{left:130%}}
.hero .wrap{position:relative;z-index:3}
.hero h1,.hero .lead,.hero .cta,.hero .lbl{animation:wipe 1.1s var(--ease) both}.hero h1{animation-delay:.1s}.hero .lead{animation-delay:.22s}.hero .cta{animation-delay:.34s}
@keyframes wipe{from{opacity:0;clip-path:inset(0 100% 0 0);transform:translateX(-40px)}to{opacity:1;clip-path:inset(0 -2% 0 0);transform:none}}
.sl{position:absolute;right:-45%;height:1px;background:linear-gradient(270deg,transparent,rgba(90,170,255,.45) 55%,#fff);animation:zoom linear infinite;z-index:2;border-radius:2px;filter:drop-shadow(0 0 6px rgba(0,229,255,.9))}
.sl:before{content:"";position:absolute;left:-2px;top:50%;width:9px;height:9px;margin-top:-4.5px;border-radius:50%;background:#fff;box-shadow:0 0 14px 5px rgba(0,229,255,.95),0 0 34px 10px rgba(30,124,255,.6)}
.sl.c{background:linear-gradient(270deg,transparent,rgba(0,229,255,.5) 55%,#bff8ff)}
@keyframes zoom{0%{transform:translateX(0) rotate(var(--r,0deg));opacity:0}6%{opacity:1}92%{opacity:1}100%{transform:translateX(-240vw) rotate(var(--r,0deg));opacity:0}}
.sp{position:absolute;right:-5%;border-radius:50%;background:#fff;box-shadow:0 0 10px 3px rgba(0,229,255,.95),0 0 22px 6px rgba(30,124,255,.55);animation:spark linear infinite;z-index:2}
@keyframes spark{0%{transform:translate(0,0) scale(.4);opacity:0}8%{opacity:1}30%{transform:translate(-40vw,-14px) scale(1)}55%{transform:translate(-80vw,10px) scale(.7)}80%{transform:translate(-125vw,-18px) scale(1)}100%{transform:translate(-160vw,6px) scale(.2);opacity:0}}
.facts{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);margin-top:86px}
.facts>div{padding:30px 34px 0 0;font:300 clamp(16px,1.35vw,19px)/1.5 "Segoe UI",sans-serif;color:var(--txt);border-right:1px solid var(--line);margin-right:34px}
.facts>div:last-child{border-right:0}.facts b{display:block;font:200 52px/1 "Segoe UI Light","Segoe UI",sans-serif;margin-bottom:14px;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:-.02em}
section{padding:130px 0;position:relative}
.light{background:var(--lite);color:var(--ink)}.light h2,.light h3{color:var(--ink)}.light .lead,.light p{color:var(--inkm)}
.light .lbl,.light .tag{color:#0a6ad6}.light .lbl:before,.light .tag:before{background:linear-gradient(100deg,#0a6ad6,#00b8e6)}
.sec-h{display:flex;justify-content:space-between;align-items:flex-end;gap:60px;margin-bottom:70px;flex-wrap:wrap}.sec-h p{max-width:460px;font-size:18px;margin:0;color:var(--mut)}.light .sec-h p{color:var(--inkm)}
.brands{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.brands figure{margin:0;overflow:hidden;position:relative;border-radius:2px;background:#0b1626}
.brands figure:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(4,8,15,.55));pointer-events:none}
.brands img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;transition:transform 1.2s var(--ease),filter .6s;filter:saturate(1.05)}
.brands figure:hover img{transform:scale(1.05)}
.tiers{border-top:1px solid var(--line)}
.tier{display:grid;grid-template-columns:5fr 7fr;gap:60px;padding:34px 0;border-bottom:1px solid var(--line);align-items:baseline}
.tier h3{margin:0;font-size:clamp(22px,2.4vw,34px);font-weight:200}.tier p{margin:0;color:var(--mut);font-size:18px}
.ab{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:70px}
.ab>div{padding:46px 44px 26px;border:1px solid var(--line);background:linear-gradient(160deg,rgba(255,255,255,.04),rgba(255,255,255,0));border-radius:2px;position:relative;overflow:hidden;transition:border-color .4s}
.ab>div:hover{border-color:rgba(0,229,255,.5)}
.ab>div:after{content:"";position:absolute;left:0;top:0;height:2px;width:100%;background:var(--grad)}
.ab .big{font:200 clamp(90px,9vw,140px)/.9 "Segoe UI Light","Segoe UI",sans-serif;display:block;margin-bottom:22px;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.ab small{display:block;font:500 11.5px/1.5 "Segoe UI",sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--cy);margin:6px 0 22px}
.ab.one{grid-template-columns:1fr}.ab.one>div{padding:50px 52px 30px}.ab.one h3{font-size:clamp(26px,3vw,42px)}.ab.one ul{columns:2;column-gap:60px}.ab.one li{break-inside:avoid}.ab ul{list-style:none;margin:0;padding:0}.ab li{padding:15px 0 15px 30px;border-top:1px solid var(--line);color:#c4cfde;position:relative;font-size:16.5px}
.ab li:before{content:"";position:absolute;left:0;top:25px;width:14px;height:1px;background:var(--cy);box-shadow:0 0 8px var(--cy)}
.market{margin-top:22px;border:1px solid var(--line);padding:38px 46px;display:grid;grid-template-columns:auto 1fr;gap:56px;align-items:center;background:linear-gradient(100deg,rgba(30,124,255,.2),rgba(0,229,255,.05))}
.market b{font:200 clamp(28px,3vw,42px)/1 "Segoe UI Light","Segoe UI",sans-serif;color:#fff}.market p{margin:0;color:#c4cfde;font-size:18px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid rgba(8,17,31,.16);border-left:1px solid rgba(8,17,31,.16)}.grid.g4{grid-template-columns:repeat(4,1fr)}
.cell{padding:44px 38px 48px;border-right:1px solid rgba(8,17,31,.16);border-bottom:1px solid rgba(8,17,31,.16);transition:background .4s var(--ease);position:relative}
.cell:hover{background:#fff}.cell:before{content:"";position:absolute;left:0;top:0;width:0;height:2px;background:var(--grad);transition:width .5s var(--ease)}.cell:hover:before{width:100%}
.cell .n{font:200 22px/1 "Segoe UI Light","Segoe UI",sans-serif;display:block;margin-bottom:34px;color:#0a6ad6;letter-spacing:.14em}
.cell p{margin:0;font-size:16.5px;color:var(--inkm)}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:70px}.duo h3.col{font:500 11.5px/1 'Segoe UI',sans-serif;letter-spacing:.28em;text-transform:uppercase;color:var(--cy);padding-bottom:22px;border-bottom:1px solid var(--cy);margin-bottom:0}.duo .it{display:grid;grid-template-columns:54px 1fr;gap:10px;padding:28px 0;border-bottom:1px solid var(--line)}.duo .n{font:200 20px/1.4 'Segoe UI Light','Segoe UI',sans-serif;color:var(--cy);letter-spacing:.1em}.duo .it h3{font-size:22px;margin-bottom:8px}.duo .it p{margin:0;color:var(--mut);font-size:16.5px}
.dk .grid{border-color:var(--line)}.dk .cell{border-color:var(--line)}.dk .cell:hover{background:rgba(255,255,255,.04)}.dk .cell .n{color:var(--cy)}.dk .cell p{color:var(--mut)}.dk .cell h3{color:#fff}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:0;position:relative}
.steps:before{content:"";position:absolute;left:0;right:0;top:9px;height:1px;background:linear-gradient(90deg,rgba(8,17,31,.25),rgba(8,17,31,.05))}
.steps>div{padding:56px 44px 10px 0;position:relative}
.steps>div:before{content:"";position:absolute;left:0;top:3px;width:13px;height:13px;border-radius:50%;background:#fff;border:2px solid #0a6ad6;box-shadow:0 0 0 6px rgba(10,106,214,.12)}
.steps .n{font:200 clamp(70px,7vw,110px)/.9 "Segoe UI Light","Segoe UI",sans-serif;display:block;margin-bottom:22px;background:linear-gradient(100deg,#0a6ad6,#00b8e6);-webkit-background-clip:text;background-clip:text;color:transparent}
.steps p{color:var(--inkm)}
.band{padding:130px 0;position:relative;overflow:hidden;background:radial-gradient(900px 420px at 75% 30%,rgba(30,124,255,.5),transparent 62%),linear-gradient(160deg,#07142a,#04080f);clip-path:polygon(0 4vw,100% 0,100% 100%,0 100%);margin-top:-4vw;padding-top:calc(130px + 4vw)}
.band .wrap{display:flex;justify-content:space-between;align-items:center;gap:50px;flex-wrap:wrap}.band h2{max-width:780px;margin:0}
form.box{background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(255,255,255,.01));border:1px solid var(--line);padding:50px 52px;max-width:800px;border-radius:2px;position:relative}
form.box:before{content:"";position:absolute;left:0;top:0;height:2px;width:100%;background:var(--grad)}
label{display:block;font:500 11px/1.2 "Segoe UI",sans-serif;letter-spacing:.2em;text-transform:uppercase;margin:28px 0 10px;color:var(--mut)}
input,select,textarea{width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.18);color:#fff;padding:16px 18px;font:300 16px/1.4 "Segoe UI",sans-serif;border-radius:2px;transition:border-color .25s,background .25s}
input:focus,select:focus,textarea:focus{outline:0;border-color:var(--cy);background:rgba(0,229,255,.05)}
textarea{min-height:130px;resize:vertical}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.chk{display:flex;gap:14px;align-items:flex-start;font-weight:300;text-transform:none;letter-spacing:0;font-size:15px;margin:30px 0 6px;color:var(--mut)}.chk input{width:auto;margin-top:6px;accent-color:#00e5ff}
.opts{display:flex;flex-wrap:wrap;gap:10px}.opts label{margin:0;border:1px solid rgba(255,255,255,.2);padding:13px 18px;font:300 15px/1.2 "Segoe UI",sans-serif;letter-spacing:0;text-transform:none;cursor:pointer;display:flex;gap:10px;align-items:center;color:#d8e1ee;border-radius:2px;transition:border-color .2s,background .2s}
.opts label:hover{border-color:var(--cy)}.opts label:has(input:checked){border-color:var(--cy);background:rgba(0,229,255,.12);color:#fff}.opts input{width:auto;accent-color:#00e5ff}
.err{background:rgba(255,90,90,.12);border:1px solid rgba(255,120,120,.6);padding:14px 18px;margin:0 0 8px;color:#ffd6d6}
.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
.page{padding:110px 0 140px;background:radial-gradient(900px 500px at 85% 0%,rgba(30,124,255,.28),transparent 60%),var(--bg)}.page .sub{max-width:660px;margin:22px 0 50px;font-size:20px;color:var(--mut)}
footer{background:#02050a;color:#7a879c;padding:50px 0;font-size:13.5px;letter-spacing:.02em;border-top:1px solid var(--line)}footer b{color:#fff;font-weight:500}
.js .rv{opacity:0;transform:translateY(46px);transition:opacity .9s var(--ease),transform 1s var(--ease)}.js .rv.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.hero:before,.sl,.hero h1,.hero .lead,.hero .cta,.hero .lbl{animation:none}.sl,.sp{display:none}.js .rv{opacity:1;transform:none;transition:none}}
@media(max-width:900px){.duo{grid-template-columns:1fr;gap:44px}.ab.one ul{columns:1}.ab.one>div{padding:34px 26px 14px}.facts,.steps,.ab,.market,.tier,.brands,.grid,.grid.g4,.row2{grid-template-columns:1fr}
.facts>div{border-right:0;margin-right:0;border-bottom:1px solid var(--line);padding:24px 0}.facts>div:last-child{border-bottom:0}
.steps:before{display:none}.steps>div{padding:46px 0 10px}.steps>div:before{top:0}
section{padding:80px 0}.hero{padding-top:64px;padding-bottom:calc(100px + 4vw)}.facts{margin-top:54px}.sec-h{margin-bottom:40px;gap:18px}.tier{gap:6px;padding:26px 0}.market{gap:14px;padding:28px}
.bar nav a.hide{display:none}.bar .wrap{gap:14px;height:68px}form.box{padding:32px 22px}.page{padding:60px 0 80px}.band{padding:80px 0;padding-top:calc(80px + 4vw)}.ab>div{padding:34px 26px 14px}}
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
<div class="prog" id="prog"></div>
<div class="bar"><div class="wrap"><a href="${base || '/'}" style="display:block">${logoHtml(50)}</a>
<nav><a class="hide" href="${base}/#model">${esc(t.nav_model)}</a><a class="hide" href="${base}/#offer">${esc(t.nav_offer)}</a><a class="hide" href="${base}/#who">${esc(t.nav_who)}</a>
<div class="lang">${sw}</div><a class="btn" href="${base}/apply"><span>${esc(t.nav_apply)}${CHEV}</span></a></nav></div></div>
${body}
<footer><div class="wrap"><b>Laundry Unlimited</b> — ${esc(t.foot.replace(/^Laundry Unlimited\s*·\s*/, ''))}<br>${esc(t.gdpr)}</div></footer>
<script>(function(){var els=[].slice.call(document.querySelectorAll('.rv'));if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in')});return}var pg=document.getElementById('prog');function up(){var h=document.documentElement.scrollHeight-innerHeight;pg.style.width=(h>0?scrollY/h*100:0)+'%'}addEventListener('scroll',up,{passive:true});up();var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});els.forEach(function(e){io.observe(e)})})()</script>
</body></html>`;
}

function landing(lang) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
  const nn = (i) => String(i + 1).padStart(2, '0');
  let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  let sl = '';
  for (let i = 0; i < 34; i++) {
    const tp = (4 + rnd() * 90).toFixed(1), w = (10 + rnd() * 42).toFixed(0), d = (0.9 + rnd() * 2.6).toFixed(2), l = (rnd() * 6).toFixed(2);
    const r = (-3 + rnd() * 6).toFixed(1), h = rnd() < 0.2 ? 3 : rnd() < 0.5 ? 2 : 1, c = rnd() < 0.3 ? ' c' : '';
    sl += `<i class="sl${c}" style="top:${tp}%;width:${w}vw;height:${h}px;--r:${r}deg;animation-duration:${d}s;animation-delay:-${l}s"></i>`;
  }
  for (let i = 0; i < 22; i++) {
    const tp = (6 + rnd() * 88).toFixed(1), d = (0.6 + rnd() * 1.8).toFixed(2), l = (rnd() * 5).toFixed(2), z = (2 + rnd() * 4).toFixed(0);
    sl += `<i class="sp" style="top:${tp}%;width:${z}px;height:${z}px;animation-duration:${d}s;animation-delay:-${l}s"></i>`;
  }
  const body = `
<div class="hero">${sl}<div class="wrap"><span class="lbl">${esc(t.hero_kicker)}</span><h1>${esc(t.hero_h)}</h1><p class="lead">${esc(t.hero_p)}</p>
<div class="cta"><a class="btn" href="${base}/apply"><span>${esc(t.hero_cta)}${CHEV}</span></a><a class="btn line" href="#model"><span>${esc(t.hero_cta2)}</span></a></div>
<div class="facts"><div><b>01</b>${esc(t.stat1)}</div><div><b>02</b>${esc(t.stat2)}</div><div><b>03</b>${esc(t.stat3)}</div></div></div></div>
<section class="light"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">Laundry Unlimited</span><h2>${esc(t.brands_h)}</h2></div><p>${esc(t.brands_p)}</p></div>
<div class="brands rv"><figure><img src="/img/ireland.webp" alt="" loading="lazy" width="1200" height="900"></figure><figure><img src="/img/blue.webp" alt="" loading="lazy" width="900" height="1200"></figure><figure><img src="/img/orlen.webp" alt="" loading="lazy" width="1200" height="900"></figure></div></div></section>
<section id="model"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_model)}</span><h2>${esc(t.model_h)}</h2></div><p>${esc(t.model_p)}</p></div>
<div class="tiers rv"><div class="tier"><h3>${esc(t.top_h)}</h3><p>${esc(t.top_p)}</p></div><div class="tier"><h3>${esc(t.mid_h)}</h3><p>${esc(t.mid_p)}</p></div></div>
<div class="ab one"><div class="rv"><h3>${esc(t.b_h.replace(/^B\s+/, ''))}</h3><small>${esc(t.b_p)}</small><ul>${li(t.b_li)}</ul></div></div>
<div class="market rv"><b>${esc(t.market_h)}</b><p>${esc(t.market_p)}</p></div></div></section>
<section id="offer" class="light"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_offer)}</span><h2>${esc(t.offer_h)}</h2></div></div>
<div class="grid rv">${t.offer.map((o, i) => `<div class="cell"><span class="n">${nn(i)}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section id="who" class="dk"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.nav_who)}</span><h2>${esc(t.who_h)}</h2></div></div>
<div class="duo rv"><div><h3 class="col">${esc(t.who_do)}</h3>${t.who.map((o, i) => `<div class="it"><span class="n">${nn(i)}</span><div><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div></div>`).join('')}</div>
<div><h3 class="col">${esc(t.who_exp)}</h3>${t.exp.map((o, i) => `<div class="it"><span class="n">${nn(i)}</span><div><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div></div>`).join('')}</div></div></div></section>
<section class="light"><div class="wrap"><div class="sec-h rv"><div><span class="lbl">${esc(t.steps_h)}</span><h2>${esc(t.steps_h)}</h2></div></div>
<div class="steps rv">${t.steps.map((o, i) => `<div><span class="n">${i + 1}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<div class="band"><div class="wrap"><h2>${esc(t.cta_h)}</h2><a class="btn" href="${base}/apply"><span>${esc(t.hero_cta)}${CHEV}</span></a></div></div>`;
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
    notifyHolyos('🧺 Nová poptávka master franšízanta', v.name + (v.country ? ' · ' + v.country : '') + ' · ' + v.email, '/');
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
    notifyHolyos('🧺 Dotazník master franšízanta vyplněn', (answers.territory || '—') + (answers.investment ? ' · ' + answers.investment : ''), '/');
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
const STATUSES = [['new', 'Nová'], ['contacted', 'Kontaktován'], ['talks', 'Jednání'], ['won', 'Master franšízant'], ['lost', 'Ztraceno'], ['spam', 'Spam']];
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
<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">${logoHtml(36)}<h2 style="margin:0">Poptávky master franšízantů</h2><span class="sp"></span><a class="btn sm ghost" href="/admin/export.csv"><span>⬇ CSV</span></a><a class="btn sm ghost" href="${HOLYOS_URL}"><span>← HolyOS</span></a></div>
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
