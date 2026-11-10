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
:root{--paper:#f2f0ea;--paper2:#e9e6dd;--white:#fbfaf7;--ink:#1b1e23;--gr:#2a2d33;--mut:#5d636d;--rule:#d5d1c6;--acc:#c94616;--blue:#1b7fc4;--serif:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.7 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px}
.bar{background:var(--gr);color:#fff;position:sticky;top:0;z-index:20}
.bar .wrap{display:flex;align-items:center;gap:26px;height:74px}
.bar nav{margin-left:auto;display:flex;align-items:center;gap:26px;font-size:14px}
.bar nav a{color:#c9ccd2;text-decoration:none}.bar nav a:hover{color:#fff}
.lang{display:flex;gap:12px;font-size:12px;letter-spacing:.08em}.lang a{opacity:.55;text-decoration:none}.lang a.on{opacity:1;border-bottom:2px solid var(--acc);padding-bottom:2px}
.btn{display:inline-block;background:var(--acc);color:#fff;font:600 15px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.02em;border:0;padding:17px 28px;text-decoration:none;cursor:pointer;border-radius:0}
.btn:hover{background:#a83a12}.btn.dark{background:var(--ink)}.btn.dark:hover{background:#000}
.btn.line{background:transparent;color:var(--ink);border:1.5px solid var(--ink)}.btn.line:hover{background:var(--ink);color:#fff}
.bar .btn{padding:11px 18px;font-size:13px}
.label{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--acc)}
h1,h2,h3{font-family:var(--serif);font-weight:400;color:var(--ink);margin:0}
h1{font-size:clamp(40px,5.2vw,72px);line-height:1.05;letter-spacing:-.01em;margin:14px 0 26px}
h2{font-size:clamp(30px,3.6vw,46px);line-height:1.12;margin:10px 0 18px}
h3{font-size:22px;line-height:1.25;margin-bottom:8px}
p{margin:0 0 14px}
.lead{font-size:20px;line-height:1.6;color:#3a3f48;max-width:560px;margin-bottom:34px}
.cta{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.hero{padding:96px 0 0}
.hero h1{max-width:980px;font-size:clamp(42px,6vw,84px)}.hero .lead{max-width:680px}
.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:72px;padding:26px 0 8px;border-top:1px solid var(--ink)}
.facts div{font-family:var(--serif);font-size:21px;line-height:1.35}
section{padding:96px 0}
section.tint{background:var(--paper2)}section.white{background:var(--white)}
.head{display:grid;grid-template-columns:5fr 7fr;gap:64px;margin-bottom:56px;align-items:end}.head p{color:#3a3f48;margin:0}
.brands{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:6px}
.brands img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
.tiers{border-top:1px solid var(--ink)}
.tier{display:grid;grid-template-columns:5fr 7fr;gap:64px;padding:22px 0;border-bottom:1px solid var(--rule)}
.tier h3{margin:0}.tier p{margin:0;color:#3a3f48}
.ab{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:56px;border-top:1px solid var(--ink)}
.ab>div{padding:34px 40px 12px 0}.ab>div+div{padding:34px 0 12px 40px;border-left:1px solid var(--rule)}
.ab .big{font-family:var(--serif);font-size:84px;line-height:.9;color:var(--acc);display:block;margin-bottom:14px}
.ab small{display:block;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:6px 0 16px}
.ab ul{list-style:none;margin:0;padding:0}.ab li{padding:12px 0;border-top:1px solid var(--rule);color:#2e333b}
.market{margin-top:40px;background:var(--gr);color:#e9e7e1;padding:30px 36px;display:grid;grid-template-columns:auto 1fr;gap:36px;align-items:center}
.market b{font-family:var(--serif);font-weight:400;font-size:26px;color:#fff}.market p{margin:0;color:#c9ccd2}
.grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink)}
.grid.g4{grid-template-columns:repeat(4,1fr)}
.cell{padding:30px 32px 34px 0;border-bottom:1px solid var(--rule)}.cell+.cell{padding-left:32px;border-left:1px solid var(--rule)}
.grid .cell:nth-child(3n+1){padding-left:0;border-left:0}.grid.g4 .cell:nth-child(3n+1){padding-left:32px;border-left:1px solid var(--rule)}.grid.g4 .cell:nth-child(4n+1){padding-left:0;border-left:0}
.cell .n{font-family:var(--serif);color:var(--acc);font-size:15px;display:block;margin-bottom:10px;letter-spacing:.04em}
.cell p{margin:0;color:#3a3f48;font-size:16px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:48px}
.steps .n{font-family:var(--serif);font-size:96px;line-height:1;color:var(--acc);display:block;margin-bottom:6px}
.steps p{color:#3a3f48}
.band{background:var(--gr);color:#fff;padding:84px 0}.band h2{color:#fff;margin:0 0 26px;max-width:760px}.band .btn{background:var(--acc)}
form.box{background:var(--white);border:1px solid var(--rule);padding:38px 40px;max-width:760px}
label{display:block;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:22px 0 8px;color:#3a3f48}
input,select,textarea{width:100%;background:#fff;border:1px solid #bdb8ab;color:var(--ink);padding:14px 15px;font:inherit;border-radius:0}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink)}
textarea{min-height:120px;resize:vertical}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.chk{display:flex;gap:12px;align-items:flex-start;font-weight:400;text-transform:none;letter-spacing:0;color:#3a3f48;font-size:15px;margin:26px 0 6px}.chk input{width:auto;margin-top:6px}
.opts{display:flex;flex-wrap:wrap;gap:10px}.opts label{margin:0;border:1px solid #bdb8ab;padding:11px 16px;font-weight:500;text-transform:none;letter-spacing:0;font-size:15px;cursor:pointer;display:flex;gap:10px;align-items:center;background:#fff;color:var(--ink)}
.opts label:has(input:checked){border-color:var(--ink);background:var(--ink);color:#fff}.opts input{width:auto;accent-color:var(--acc)}
.err{background:#f9e3da;border-left:4px solid var(--acc);padding:12px 16px;margin:0 0 6px;font-size:15px}
.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
.page{padding:84px 0 110px}.page .sub{color:#3a3f48;max-width:640px;margin:0 0 38px;font-size:19px}
footer{background:var(--ink);color:#9ea3ac;padding:40px 0;font-size:14px}footer b{color:#fff;font-weight:600}
@media(max-width:900px){.head,.tier,.ab,.market,.steps,.facts,.brands{grid-template-columns:1fr}.hero{padding-top:44px}.facts{gap:18px;margin-top:44px}
.ab>div,.ab>div+div{padding:26px 0 10px;border-left:0}.ab>div+div{border-top:1px solid var(--ink)}.grid,.grid.g4{grid-template-columns:1fr}.grid .cell,.grid .cell+.cell,.grid.g4 .cell:nth-child(n){padding:24px 0;border-left:0}
section{padding:60px 0}.head{gap:14px;margin-bottom:30px}.tier{gap:6px}.market{gap:10px}.bar nav a.hide{display:none}.bar .wrap{gap:14px;height:66px}.row2{grid-template-columns:1fr}form.box{padding:26px 20px}.steps{gap:26px}.page{padding:48px 0 70px}}
`;

function page({ lang, title, desc, body, canonicalPath, noindex }) {
  const t = T[lang];
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${PUBLIC_URL}${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? '' : canonicalPath}">`).join('');
  const sw = LANGS.map((l) => `<a class="${l === lang ? 'on' : ''}" href="${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? (l === 'en' ? '/' : '') : canonicalPath}" hreflang="${l}">${NAMES[l]}</a>`).join('');
  const base = lang === 'en' ? '' : '/' + lang;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || t.title)}</title><meta name="description" content="${esc(desc || t.desc)}">
${noindex ? '<meta name="robots" content="noindex">' : alts}<meta name="theme-color" content="#2a2d33">
<meta property="og:title" content="${esc(title || t.title)}"><meta property="og:description" content="${esc(desc || t.desc)}"><meta property="og:type" content="website"><meta property="og:image" content="${PUBLIC_URL}/img/ireland.webp">
<style>${SITE_CSS}</style></head><body>
<div class="bar"><div class="wrap"><a href="${base || '/'}" style="display:block">${logoHtml(44)}</a>
<nav><a class="hide" href="${base}/#model">${esc(t.nav_model)}</a><a class="hide" href="${base}/#offer">${esc(t.nav_offer)}</a><a class="hide" href="${base}/#who">${esc(t.nav_who)}</a>
<div class="lang">${sw}</div><a class="btn" href="${base}/apply" style="color:#fff">${esc(t.nav_apply)}</a></nav></div></div>
${body}
<footer><div class="wrap"><b>Laundry Unlimited</b> — ${esc(t.foot.replace(/^Laundry Unlimited\s*·\s*/, ''))}<br>${esc(t.gdpr)}</div></footer></body></html>`;
}

function landing(lang) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
  const nn = (i) => String(i + 1).padStart(2, '0');
  const body = `
<div class="hero"><div class="wrap"><div><span class="label">${esc(t.hero_kicker)}</span><h1>${esc(t.hero_h)}</h1><p class="lead">${esc(t.hero_p)}</p>
<div class="cta"><a class="btn" href="${base}/apply">${esc(t.hero_cta)} &rarr;</a><a class="btn line" href="#model">${esc(t.hero_cta2)}</a></div></div>
</div>
<div class="wrap"><div class="facts"><div>${esc(t.stat1)}</div><div>${esc(t.stat2)}</div><div>${esc(t.stat3)}</div></div></div></div>
<section><div class="wrap"><div class="head"><div><span class="label">${esc(t.brands_h)}</span><h2>${esc(t.brands_h)}</h2></div><p>${esc(t.brands_p)}</p></div>
<div class="brands"><img src="/img/orlen.webp" alt="" loading="lazy" width="1200" height="900"><img src="/img/blue.webp" alt="" loading="lazy" width="900" height="1200"><img src="/img/ireland.webp" alt="" loading="lazy" width="1200" height="900"></div></div></section>
<section id="model" class="white"><div class="wrap"><div class="head"><div><span class="label">${esc(t.nav_model)}</span><h2>${esc(t.model_h)}</h2></div><p>${esc(t.model_p)}</p></div>
<div class="tiers"><div class="tier"><h3>${esc(t.top_h)}</h3><p>${esc(t.top_p)}</p></div><div class="tier"><h3>${esc(t.mid_h)}</h3><p>${esc(t.mid_p)}</p></div></div>
<div class="ab"><div><span class="big">A</span><h3>${esc(t.a_h.replace(/^A\s+/, ''))}</h3><small>${esc(t.a_p)}</small><ul>${li(t.a_li)}</ul></div>
<div><span class="big">B</span><h3>${esc(t.b_h.replace(/^B\s+/, ''))}</h3><small>${esc(t.b_p)}</small><ul>${li(t.b_li)}</ul></div></div>
<div class="market"><b>${esc(t.market_h)}</b><p>${esc(t.market_p)}</p></div></div></section>
<section id="offer"><div class="wrap"><div class="head"><div><span class="label">${esc(t.nav_offer)}</span><h2>${esc(t.offer_h)}</h2></div><p></p></div>
<div class="grid">${t.offer.map((o, i) => `<div class="cell"><span class="n">${nn(i)}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section id="who" class="tint"><div class="wrap"><div class="head"><div><span class="label">${esc(t.nav_who)}</span><h2>${esc(t.who_h)}</h2></div><p></p></div>
<div class="grid g4">${t.who.map((o, i) => `<div class="cell"><span class="n">${nn(i)}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="head"><div><span class="label">${esc(t.steps_h)}</span><h2>${esc(t.steps_h)}</h2></div><p></p></div>
<div class="steps">${t.steps.map((o, i) => `<div><span class="n">${i + 1}</span><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<div class="band"><div class="wrap"><h2>${esc(t.cta_h)}</h2><a class="btn" href="${base}/apply">${esc(t.hero_cta)} &rarr;</a></div></div>`;
  return page({ lang, body, canonicalPath: '/' });
}

function applyPage(lang, err, v) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang; v = v || {};
  const body = `<div class="page"><div class="wrap"><span class="label">${esc(t.nav_apply)}</span><h2>${esc(t.form_h)}</h2><p class="sub">${esc(t.form_p)}</p>
<form class="box" method="post" action="${base}/apply" id="f">${err ? `<div class="err">${esc(err)}</div>` : ''}
<div class="hp"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label style="margin-top:0">${esc(t.f_name)} *</label><input name="name" required maxlength="120" value="${esc(v.name)}" autocomplete="name">
<div class="row2"><div><label>${esc(t.f_email)} *</label><input name="email" type="email" required maxlength="160" value="${esc(v.email)}" autocomplete="email"></div>
<div><label>${esc(t.f_phone)}</label><input name="phone" maxlength="40" value="${esc(v.phone)}" autocomplete="tel"></div></div>
<div class="row2"><div><label>${esc(t.f_company)}</label><input name="company" maxlength="160" value="${esc(v.company)}" autocomplete="organization"></div>
<div><label>${esc(t.f_country)}</label><input name="country" maxlength="80" value="${esc(v.country)}" autocomplete="country-name"></div></div>
<label class="chk"><input type="checkbox" name="consent" value="1" required> <span>${esc(t.f_consent)}</span></label>
<input type="hidden" name="utm" id="utm" value=""><div style="margin-top:26px"><button class="btn" type="submit">${esc(t.f_submit)} &rarr;</button></div></form></div></div>
<script>try{var u={},p=new URLSearchParams(location.search);['utm_source','utm_medium','utm_campaign','gclid','fbclid'].forEach(function(k){if(p.get(k))u[k]=p.get(k)});if(document.referrer)u.ref=document.referrer.slice(0,200);document.getElementById('utm').value=JSON.stringify(u)}catch(e){}</script>`;
  return page({ lang, title: t.form_h + ' — Laundry Unlimited', body, canonicalPath: '/apply' });
}

function questionnairePage(lang, token, err) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const radios = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="radio" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const checks = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const body = `<div class="page"><div class="wrap"><span class="label">${esc(t.nav_apply)}</span><h2>${esc(t.q_h)}</h2><p class="sub">${esc(t.q_p)}</p>
<form class="box" method="post" action="${base}/questionnaire/${esc(token)}">${err ? `<div class="err">${esc(err)}</div>` : ''}
<label style="margin-top:0">${esc(t.q_territory)}</label><input name="territory" maxlength="200">
<label>${esc(t.q_exp)}</label>${radios('experience', t.q_exp_o)}
<label>${esc(t.q_team)}</label>${radios('team', t.q_team_o)}
<label>${esc(t.q_invest)}</label>${radios('investment', t.q_invest_o)}
<label>${esc(t.q_scope)}</label>${checks('scope', t.q_scope_o)}
<label>${esc(t.q_when)}</label>${radios('start', t.q_when_o)}
<label>${esc(t.q_heard)}</label>${radios('heard', t.q_heard_o)}
<label>${esc(t.q_msg)}</label><textarea name="message" maxlength="3000"></textarea>
<div style="margin-top:28px;display:flex;gap:14px;flex-wrap:wrap;align-items:center"><button class="btn" type="submit">${esc(t.q_submit)} &rarr;</button><a class="btn line" href="${base}/thanks">${esc(t.q_skip)}</a></div></form></div></div>`;
  return page({ lang, title: t.q_h + ' — Laundry Unlimited', body, canonicalPath: '/questionnaire', noindex: true });
}

function simplePage(lang, h, p, path0, noindex) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  return page({ lang, title: h + ' — Laundry Unlimited', body: `<div class="page"><div class="wrap"><h2>${esc(h)}</h2><p class="sub">${esc(p)}</p><a class="btn dark" href="${base || '/'}">${esc(t.back)}</a></div></div>`, canonicalPath: path0, noindex: noindex !== false });
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
<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">${logoHtml(36)}<h2 style="margin:0">Poptávky master franšízantů</h2><span class="sp"></span><a class="btn sm ghost" href="/admin/export.csv">⬇ CSV</a><a class="btn sm ghost" href="${HOLYOS_URL}">← HolyOS</a></div>
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
