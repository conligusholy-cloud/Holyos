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
  return `<svg height="${h}" viewBox="0 0 520 110" role="img" aria-label="Laundry Unlimited" xmlns="http://www.w3.org/2000/svg">
  <path d="M96 22 A44 44 0 1 0 98 62" fill="none" stroke="#00e5ff" stroke-width="7" stroke-linecap="butt"/>
  <path d="M30 72 A28 28 0 0 1 72 34" fill="none" stroke="#1e7cff" stroke-width="7"/>
  <rect x="90" y="14" width="9" height="9" fill="#00e5ff"/>
  <text x="124" y="60" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="40" font-weight="300" letter-spacing="3" fill="#e8eef7">LAUNDRY</text>
  <text x="126" y="90" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="15" font-weight="300" letter-spacing="9" fill="#9fb0c6">UNLIMITED</text></svg>`;
}

// ── Šablona stránek ────────────────────────────────────────────────────────
const CSS = `
:root{--bg:#050a14;--bg2:#0a1424;--card:#0d1b30;--line:#1b2d4a;--text:#e8eef7;--mut:#9fb0c6;--cy:#00e5ff;--bl:#1e7cff;--or:#d97b34;--gr:#1f9d8a}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(1200px 600px at 80% -10%,rgba(30,124,255,.18),transparent 60%),radial-gradient(900px 500px at -10% 20%,rgba(0,229,255,.1),transparent 55%),var(--bg);color:var(--text);font:16px/1.6 Inter,"Segoe UI",system-ui,-apple-system,Arial,sans-serif}
a{color:var(--cy)}
.wrap{max-width:1120px;margin:0 auto;padding:0 22px}
header.top{position:sticky;top:0;z-index:20;background:rgba(5,10,20,.82);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:18px;height:68px}
header.top nav{margin-left:auto;display:flex;align-items:center;gap:20px;font-size:14px}
header.top nav a{color:var(--mut);text-decoration:none}header.top nav a:hover{color:var(--text)}
.lang{display:flex;gap:2px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.lang a{padding:4px 9px;font-size:12px;font-weight:700;color:var(--mut)!important}.lang a.on{background:var(--bl);color:#fff!important}
.btn{display:inline-block;background:linear-gradient(135deg,var(--bl),var(--cy));color:#03101f;font-weight:800;border:0;border-radius:12px;padding:13px 24px;font-size:16px;text-decoration:none;cursor:pointer;box-shadow:0 10px 30px rgba(0,229,255,.2)}
.btn:hover{filter:brightness(1.08)}.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line);box-shadow:none}
.btn.sm{padding:8px 14px;font-size:13px;border-radius:9px}
.hero{padding:84px 0 56px}
.kick{display:inline-block;color:var(--cy);font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:14px}
h1{font-size:clamp(34px,5.4vw,58px);line-height:1.08;margin:0 0 18px;font-weight:800;letter-spacing:-.02em}
h2{font-size:clamp(26px,3.4vw,38px);margin:0 0 12px;font-weight:800;letter-spacing:-.01em}
h3{margin:0 0 6px;font-size:18px}
.lead{font-size:19px;color:var(--mut);max-width:720px;margin:0 0 28px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:48px}
.stat{border:1px solid var(--line);background:rgba(13,27,48,.6);border-radius:16px;padding:18px 20px;color:var(--mut);font-size:15px}
section{padding:60px 0}section.alt{background:rgba(10,20,36,.55);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sub{color:var(--mut);max-width:780px;margin:0 0 30px}
.pyr{display:flex;flex-direction:column;gap:14px;align-items:center}
.pyr .l1{width:min(620px,100%);background:linear-gradient(160deg,#1c3a5a,#102640);border:1px solid #2b5079;border-radius:18px;padding:20px;text-align:center}
.pyr .l2{width:100%;background:linear-gradient(160deg,#245f8c,#1a4a72);border:1px solid #3a78a8;border-radius:18px;padding:20px 26px;text-align:center}
.pyr b{display:block;font-size:20px;margin-bottom:4px}.pyr span{color:#c9d9ea;font-size:15px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px;width:100%}
.opt{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.opt .h{padding:14px 20px;font-weight:800;color:#fff;font-size:17px}.opt.a .h{background:var(--or)}.opt.b .h{background:var(--gr)}
.opt .p{padding:12px 20px 0;color:var(--mut);font-size:14px;font-weight:700}
.opt ul{margin:10px 0 0;padding:0 20px 18px 38px;color:#cfdbea}.opt li{margin:7px 0}
.market{margin-top:18px;width:100%;border:1px solid #3f3470;background:rgba(124,92,255,.1);border-radius:16px;padding:16px 22px}.market b{color:#b7a6ff;letter-spacing:.06em;text-transform:uppercase;margin-right:10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}.card p{margin:0;color:var(--mut);font-size:15px}
.num{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--bl),var(--cy));color:#03101f;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
form.box{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:26px;max-width:720px}
label{display:block;font-size:14px;font-weight:700;margin:14px 0 6px;color:#cfdbea}
input,select,textarea{width:100%;background:#07111f;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:12px 14px;font:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid var(--bl);border-color:transparent}
textarea{min-height:110px;resize:vertical}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.chk{display:flex;gap:10px;align-items:flex-start;font-weight:400;color:var(--mut);font-size:14px;margin:18px 0 6px}.chk input{width:auto;margin-top:5px}
.opts{display:flex;flex-wrap:wrap;gap:8px}.opts label{margin:0;border:1px solid var(--line);border-radius:999px;padding:8px 14px;font-weight:500;cursor:pointer;display:flex;gap:8px;align-items:center;background:#07111f}
.opts input{width:auto}
.err{color:#ff8a8a;margin:10px 0;font-size:14px}
.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
footer{border-top:1px solid var(--line);padding:30px 0;color:var(--mut);font-size:14px}
@media(max-width:860px){.two,.grid3,.grid4,.stats,.row2{grid-template-columns:1fr}.hero{padding:48px 0 30px}header.top nav a.hide{display:none}}
`;

function page({ lang, title, desc, body, canonicalPath, noindex }) {
  const t = T[lang];
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${PUBLIC_URL}${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? '' : canonicalPath}">`).join('');
  const sw = LANGS.map((l) => `<a class="${l === lang ? 'on' : ''}" href="${l === 'en' ? '' : '/' + l}${canonicalPath === '/' ? (l === 'en' ? '/' : '') : canonicalPath}" hreflang="${l}">${NAMES[l]}</a>`).join('');
  const base = lang === 'en' ? '' : '/' + lang;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || t.title)}</title><meta name="description" content="${esc(desc || t.desc)}">
${noindex ? '<meta name="robots" content="noindex">' : alts}<meta name="theme-color" content="#050a14">
<meta property="og:title" content="${esc(title || t.title)}"><meta property="og:description" content="${esc(desc || t.desc)}"><meta property="og:type" content="website">
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a href="${base || '/'}" style="display:block">${logoHtml(40)}</a>
<nav><a class="hide" href="${base}/#model">${esc(t.nav_model)}</a><a class="hide" href="${base}/#offer">${esc(t.nav_offer)}</a><a class="hide" href="${base}/#who">${esc(t.nav_who)}</a>
<div class="lang">${sw}</div><a class="btn sm" href="${base}/apply" style="color:#03101f">${esc(t.nav_apply)}</a></nav></div></header>
${body}
<footer><div class="wrap">${esc(t.foot)}<br>${esc(t.gdpr)}</div></footer></body></html>`;
}

function landing(lang) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
  const body = `
<div class="hero"><div class="wrap"><span class="kick">${esc(t.hero_kicker)}</span><h1>${esc(t.hero_h)}</h1><p class="lead">${esc(t.hero_p)}</p>
<div class="cta"><a class="btn" href="${base}/apply">${esc(t.hero_cta)}</a><a class="btn ghost" href="#model">${esc(t.hero_cta2)}</a></div>
<div class="stats"><div class="stat">${esc(t.stat1)}</div><div class="stat">${esc(t.stat2)}</div><div class="stat">${esc(t.stat3)}</div></div></div></div>
<section id="model" class="alt"><div class="wrap"><h2>${esc(t.model_h)}</h2><p class="sub">${esc(t.model_p)}</p>
<div class="pyr"><div class="l1"><b>${esc(t.top_h)}</b><span>${esc(t.top_p)}</span></div>
<div class="l2"><b>${esc(t.mid_h)}</b><span>${esc(t.mid_p)}</span></div>
<div class="two"><div class="opt a"><div class="h">${esc(t.a_h)}</div><div class="p">${esc(t.a_p)}</div><ul>${li(t.a_li)}</ul></div>
<div class="opt b"><div class="h">${esc(t.b_h)}</div><div class="p">${esc(t.b_p)}</div><ul>${li(t.b_li)}</ul></div></div>
<div class="market"><b>${esc(t.market_h)}</b>${esc(t.market_p)}</div></div></div></section>
<section id="offer"><div class="wrap"><h2>${esc(t.offer_h)}</h2><div class="grid3" style="margin-top:22px">${t.offer.map((o) => `<div class="card"><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section id="who" class="alt"><div class="wrap"><h2>${esc(t.who_h)}</h2><div class="grid4" style="margin-top:22px">${t.who.map((o) => `<div class="card"><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><h2>${esc(t.steps_h)}</h2><div class="grid3" style="margin-top:22px">${t.steps.map((o, i) => `<div class="card"><div class="num">${i + 1}</div><h3>${esc(o[0])}</h3><p>${esc(o[1])}</p></div>`).join('')}</div>
<div style="margin-top:34px"><a class="btn" href="${base}/apply">${esc(t.hero_cta)}</a></div></div></section>`;
  return page({ lang, body, canonicalPath: '/' });
}

function applyPage(lang, err, v) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang; v = v || {};
  const body = `<section><div class="wrap"><h2>${esc(t.form_h)}</h2><p class="sub">${esc(t.form_p)}</p>
<form class="box" method="post" action="${base}/apply" id="f">${err ? `<div class="err">${esc(err)}</div>` : ''}
<div class="hp"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label>${esc(t.f_name)} *</label><input name="name" required maxlength="120" value="${esc(v.name)}" autocomplete="name">
<div class="row2"><div><label>${esc(t.f_email)} *</label><input name="email" type="email" required maxlength="160" value="${esc(v.email)}" autocomplete="email"></div>
<div><label>${esc(t.f_phone)}</label><input name="phone" maxlength="40" value="${esc(v.phone)}" autocomplete="tel"></div></div>
<div class="row2"><div><label>${esc(t.f_company)}</label><input name="company" maxlength="160" value="${esc(v.company)}" autocomplete="organization"></div>
<div><label>${esc(t.f_country)}</label><input name="country" maxlength="80" value="${esc(v.country)}" autocomplete="country-name"></div></div>
<label class="chk"><input type="checkbox" name="consent" value="1" required> <span>${esc(t.f_consent)}</span></label>
<input type="hidden" name="utm" id="utm" value=""><div style="margin-top:20px"><button class="btn" type="submit">${esc(t.f_submit)}</button></div></form></div></section>
<script>try{var u={},p=new URLSearchParams(location.search);['utm_source','utm_medium','utm_campaign','gclid','fbclid'].forEach(function(k){if(p.get(k))u[k]=p.get(k)});if(document.referrer)u.ref=document.referrer.slice(0,200);document.getElementById('utm').value=JSON.stringify(u)}catch(e){}</script>`;
  return page({ lang, title: t.form_h + ' — Laundry Unlimited', body, canonicalPath: '/apply' });
}

function questionnairePage(lang, token, err) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  const radios = (name, opts) => `<div class="opts">${opts.map((o, i) => `<label><input type="radio" name="${name}" value="${esc(o)}"${i === 0 ? '' : ''}> ${esc(o)}</label>`).join('')}</div>`;
  const checks = (name, opts) => `<div class="opts">${opts.map((o) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
  const body = `<section><div class="wrap"><h2>${esc(t.q_h)}</h2><p class="sub">${esc(t.q_p)}</p>
<form class="box" method="post" action="${base}/questionnaire/${esc(token)}">${err ? `<div class="err">${esc(err)}</div>` : ''}
<label>${esc(t.q_territory)}</label><input name="territory" maxlength="200">
<label>${esc(t.q_exp)}</label>${radios('experience', t.q_exp_o)}
<label>${esc(t.q_team)}</label>${radios('team', t.q_team_o)}
<label>${esc(t.q_invest)}</label>${radios('investment', t.q_invest_o)}
<label>${esc(t.q_scope)}</label>${checks('scope', t.q_scope_o)}
<label>${esc(t.q_when)}</label>${radios('start', t.q_when_o)}
<label>${esc(t.q_heard)}</label>${radios('heard', t.q_heard_o)}
<label>${esc(t.q_msg)}</label><textarea name="message" maxlength="3000"></textarea>
<div style="margin-top:22px;display:flex;gap:12px;flex-wrap:wrap"><button class="btn" type="submit">${esc(t.q_submit)}</button><a class="btn ghost" href="${base}/thanks">${esc(t.q_skip)}</a></div></form></div></section>`;
  return page({ lang, title: t.q_h + ' — Laundry Unlimited', body, canonicalPath: '/questionnaire', noindex: true });
}

function simplePage(lang, h, p, path0, noindex) {
  const t = T[lang]; const base = lang === 'en' ? '' : '/' + lang;
  return page({ lang, title: h + ' — Laundry Unlimited', body: `<section><div class="wrap"><h2>${esc(h)}</h2><p class="sub">${esc(p)}</p><a class="btn" href="${base || '/'}">${esc(t.back)}</a></div></section>`, canonicalPath: path0, noindex: noindex !== false });
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
<style>${CSS}.adm{max-width:1100px;margin:0 auto;padding:22px}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}.chip{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--text);text-decoration:none;background:#07111f}.chip.on{background:var(--bl)}.chip.ok{border-color:#22c55e;color:#86efac}
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
