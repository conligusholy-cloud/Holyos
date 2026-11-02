// Laundromats — veřejný web laundromats.eu (cesta k rozhodnutí pro NOVÉ zájemce o prádlomat).
// Samostatný server, oddělený od BS2 / Best Series 2.0 (podporovatelé): žádná databáze, žádné účty, žádné admin rozhraní.
// Jediné, co umí: servírovat stránky cesty (CZ + PL) a předávat rezervaci schůzky do HolyOS (veřejné endpointy /api/compounder/meeting-*).
// Potvrzovací e-mail jde přes HolyOS (/api/auth/lm/send-mail) s VLASTNÍM tajemstvím LM_SSO_SECRET (ne BS2_SSO_SECRET).
const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 8080;
const HOLYOS_URL = String(process.env.HOLYOS_URL || 'https://app.holyos.cz').replace(/\/$/, '');
const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://laundromats.eu').replace(/\/$/, '');
const LM_SECRET = process.env.LM_SSO_SECRET || '';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  next();
});

// ── jednoduchý limiter (v paměti) ──
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now(); const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); hits.set(key, a); if (hits.size > 5000) { for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }
  return a.length > max;
}

const CI18N = require('./cesta-i18n');
const CP = require('./cesta-pages');
const EP = require('./ekonomika-page');
const FOOT_CSS = '.site-foot{margin-top:70px;padding:26px 0 8px;border-top:1px solid rgba(120,160,255,.14);display:flex;align-items:center;justify-content:space-between;gap:16px 28px;flex-wrap:wrap;font-size:13.5px;color:#58698a}.site-foot b{font-weight:800;background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:15px}.site-foot nav{display:flex;flex-wrap:wrap;gap:6px 22px}.site-foot a{color:#7d93b8;text-decoration:none}.site-foot a:hover{color:#4fd1ff}';
const LOGO = '<span style="margin-right:10px;display:inline-flex"><svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="lmg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="17" fill="#0b1220"/><rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#lmg)" stroke-width="1.5"/><circle cx="32" cy="34" r="15" stroke="url(#lmg)" stroke-width="3.5"/><circle cx="32" cy="34" r="8" stroke="url(#lmg)" stroke-width="2.5" stroke-opacity=".6"/><circle cx="20" cy="16" r="2" fill="#4fd1ff"/><circle cx="27" cy="16" r="2" fill="#7c5cff"/></svg></span>';
const FOOTER = '<div style="max-width:720px;margin:0 auto;padding:0 22px 40px"><footer class="site-foot"><div><b>Laundromats.eu</b> &nbsp;© Best Series s.r.o.</div><nav><a href="/gdpr">Ochrana osobních údajů</a><a href="mailto:info@laundromats.eu">info@laundromats.eu</a></nav></footer></div>';
const shell = (html) => CI18N.addSwitch(String(html).replace('@@LOGO@@', LOGO).replace('@@FOOTER@@', FOOTER).replace('</style>', FOOT_CSS + '</style>').replace('<!--PRESENCE-->', ''));
const send = (res, html) => res.set('Cache-Control', 'no-cache').type('html').send(html);
const cestaHtml = () => fs.readFileSync(path.join(__dirname, 'cesta.html'), 'utf8');

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /api/\n'));
app.get('/', (req, res) => res.redirect(302, '/cesta' + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '')));
app.get('/pl', (req, res) => res.redirect(302, '/cesta/pl' + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '')));
app.get('/favicon.svg', (req, res) => res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(LOGO.replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '').replace('width="34" height="34"', 'width="64" height="64"')));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.get('/img/pradlomat-mini.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(__dirname, 'pradlomat-mini.webp')));

// ── stránky cesty (CZ) ──
app.get('/cesta', (req, res) => send(res, shell(cestaHtml())));
app.get('/cesta/info', (req, res) => send(res, shell(CP.infoPage())));
app.get('/cesta/vlastni-kapital', (req, res) => send(res, shell(CP.vlastniPage())));
app.get('/cesta/financovani', (req, res) => send(res, shell(CP.financovaniPage())));
app.get('/cesta/schuzka', (req, res) => send(res, shell(CP.schuzkaPage())));
app.get('/cesta/ekonomika', (req, res) => send(res, shell(EP.economyPage('cs'))));
app.get('/cesta/ekonomika/podrobne', (req, res) => send(res, shell(EP.economyDetailPage('cs'))));
app.get('/ekonomika', (req, res) => res.redirect(302, '/cesta/ekonomika' + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '')));
app.get('/cesta/ekonomika.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(__dirname, 'ekonomika.js')));
app.get('/cesta/pradlomat-economy.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(__dirname, 'pradlomat-economy.js')));
// Kurzy ČNB přes HolyOS (cache 1 h) + prázdná odpověď pro fotky/slevy strojů (model je na veřejném webu bez slev)
let _fx = { at: 0, data: null };
app.get('/api/ekonomika/fx', async (req, res) => {
  try {
    if (!_fx.data || Date.now() - _fx.at > 3600000) { const r = await fetch(HOLYOS_URL + '/api/compounder/fx-rates'); const j = await r.json(); if (j && j.rates) _fx = { at: Date.now(), data: j }; }
    res.set('Cache-Control', 'public, max-age=1800').json(_fx.data || { rates: {} });
  } catch (e) { res.json({ rates: {} }); }
});
app.get('/api/compounder/portal/machines', (req, res) => res.json({ machines: [], discount: null }));
app.get('/cesta/booking.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').send(CP.bookingJs()));
// ── polská verze ──
const plSend = (res, html) => send(res, CI18N.toPl(shell(html)));
app.get('/cesta/pl', (req, res) => plSend(res, cestaHtml()));
app.get('/cesta/pl/ekonomika', (req, res) => plSend(res, EP.economyPage('pl')));
app.get('/cesta/pl/ekonomika/podrobne', (req, res) => plSend(res, EP.economyDetailPage('pl')));
app.get('/cesta/pl/info', (req, res) => plSend(res, CP.infoPage()));
app.get('/cesta/pl/vlastni-kapital', (req, res) => plSend(res, CP.vlastniPage()));
app.get('/cesta/pl/financovani', (req, res) => plSend(res, CP.financovaniPage()));
app.get('/cesta/pl/schuzka', (req, res) => plSend(res, CP.schuzkaPage()));
// Sledovaný odkaz ze SMS / e-mailu (viditelná doména laundromats.eu) → HolyOS zaloguje otevření a přesměruje zpět na stránku
app.get('/r/:code/:variant?', (req, res) => {
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, HOLYOS_URL + '/r/' + encodeURIComponent(req.params.code) + (req.params.variant ? '/' + encodeURIComponent(req.params.variant) : '') + qs);
});
app.get('/cesta/booking.pl.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').send(CI18N.bookingToPl(CP.bookingJs())));

// Ochrana osobních údajů (stručné informace; správce Best Series s.r.o.)
app.get('/gdpr', (req, res) => send(res, '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ochrana osobních údajů · Laundromats</title><style>body{font-family:Inter,Segoe UI,Arial,sans-serif;background:#04060c;color:#c9d6ee;max-width:720px;margin:0 auto;padding:40px 22px;line-height:1.6}h1{color:#fff}a{color:#4fd1ff}</style></head><body><p><a href="/cesta">← zpět</a></p><h1>Ochrana osobních údajů</h1><p>Správcem osobních údajů je Best Series s.r.o. Údaje, které vyplníte při rezervaci schůzky (jméno, příjmení, e-mail, telefon), zpracováváme pouze za účelem domluvení a vedení schůzky o prádlomatu a navazující komunikace. Údaje neposkytujeme třetím stranám mimo poskytovatele nezbytných služeb (e-mail, SMS, kalendář).</p><p>Máte právo na přístup, opravu a výmaz údajů a na podání námitky. Žádost nám pošlete na <a href="mailto:info@laundromats.eu">info@laundromats.eu</a>.</p></body></html>'));

// ── rezervace schůzky: veřejné endpointy HolyOS (termíny, kontakt, rezervace) ──
async function holyosMeeting(req, res, method, sub) {
  try {
    const r = await fetch(HOLYOS_URL + '/api/compounder/' + sub, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(req.body || {}) : undefined, signal: AbortSignal.timeout(15000) });
    const txt = await r.text(); res.status(r.status).type('application/json').send(txt);
  } catch (e) { console.warn('[laundromats] meeting proxy:', e.message); res.status(502).json({ ok: false, error: 'Rezervace je teď nedostupná. Zkuste to prosím za chvíli.' }); }
}
const qs = (v) => encodeURIComponent(String(v || ''));
app.get('/api/cesta/meeting-slots', (req, res) => holyosMeeting(req, res, 'GET', 'meeting-slots?days=' + (parseInt(req.query.days, 10) || 15)));
app.get('/api/cesta/meeting-contact', (req, res) => holyosMeeting(req, res, 'GET', 'meeting-contact?t=' + qs(req.query.t) + '&l=' + qs(req.query.l)));
app.get('/api/cesta/meeting-reservation', (req, res) => holyosMeeting(req, res, 'GET', 'meeting-reservation?t=' + qs(req.query.t) + '&l=' + qs(req.query.l)));

const CS_MON = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const PL_MON = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const PL_DAY = { Sunday: 'niedziela', Monday: 'poniedziałek', Tuesday: 'wtorek', Wednesday: 'środa', Thursday: 'czwartek', Friday: 'piątek', Saturday: 'sobota' };
const voc = require('./vocative');

async function sendConfirmMail(payload) {
  if (!LM_SECRET) throw new Error('Chybí LM_SSO_SECRET');
  const token = jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + '/api/auth/lm/send-mail', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HolyOS ' + r.status)); }
}

app.post('/api/cesta/meeting-reservation', async (req, res) => {
  if (rateLimited('cmr:' + req.ip, 20, 3600e3)) return res.status(429).json({ ok: false, error: 'Příliš mnoho pokusů. Zkuste to prosím později.' });
  const b = req.body || {};
  const f = { first_name: String(b.first_name || '').trim().slice(0, 80), last_name: String(b.last_name || '').trim().slice(0, 80), email: String(b.email || '').trim().toLowerCase().slice(0, 160), phone: String(b.phone || '').trim().slice(0, 30) };
  if (!f.first_name || !f.last_name) return res.status(400).json({ ok: false, error: 'Vyplňte prosím jméno a příjmení.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return res.status(400).json({ ok: false, error: 'Zadejte prosím platný e-mail.' });
  if (!/^[+0-9 ()./-]{6,25}$/.test(f.phone) || f.phone.replace(/\D/g, '').length < 9) return res.status(400).json({ ok: false, error: 'Zadejte prosím platný telefon.' });
  if (b.gdpr !== true && String(b.gdpr) !== '1') return res.status(400).json({ ok: false, error: 'Pro rezervaci je potřeba souhlas se zpracováním osobních údajů.' });
  let d;
  try {
    const r = await fetch(HOLYOS_URL + '/api/compounder/meeting-reservation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ slot_id: b.slot_id, t: b.t || undefined, l: b.l || undefined, change: b.change || undefined, mode: b.mode, path: b.path, lang: b.lang === 'pl' ? 'pl' : undefined, name: f.first_name + ' ' + f.last_name, email: f.email, phone: f.phone, existing_account: false }) });
    d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) return res.status(r.status >= 400 ? r.status : 400).json({ ok: false, error: d.error || 'Rezervaci se nepodařilo dokončit.' });
  } catch (e) { console.warn('[laundromats] rezervace:', e.message); return res.status(502).json({ ok: false, error: 'Rezervace je teď nedostupná. Zkuste to prosím za chvíli.' }); }

  // Potvrzovací e-mail s pozvánkou (CZ / PL)
  try {
    const isPl = b.lang === 'pl'; const dt = new Date(d.starts_at); const durMin = Number(d.duration_min) || 17;
    let when;
    if (isPl) { const pp = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt).reduce((a, x) => (a[x.type] = x.value, a), {}); when = PL_DAY[pp.weekday] + ' ' + pp.day + ' ' + PL_MON[(+pp.month) - 1] + ' o ' + pp.hour + ':' + pp.minute; }
    else { const p = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(dt).reduce((a, x) => (a[x.type] = x.value, a), {}); when = p.weekday + ' ' + p.day + '. ' + CS_MON[(+p.month) - 1] + ' v ' + p.hour + ':' + p.minute; }
    const modeTxt = isPl ? (d.mode === 'online' ? 'rozmowa wideo online (link wyślemy przed spotkaniem)' : d.mode === 'osobne' ? 'spotkanie osobiste (miejsce ustalimy)' : 'spotkanie') : (d.mode === 'online' ? 'online video hovor (odkaz vám pošleme před schůzkou)' : d.mode === 'osobne' ? 'osobní schůzka (místo upřesníme)' : 'schůzka');
    const icsDt = (x) => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Laundromats//Schuzka//CS', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:schuzka-' + (d.id || Date.now()) + '@laundromats.eu', 'DTSTAMP:' + icsDt(new Date()), 'DTSTART:' + icsDt(dt), 'DTEND:' + icsDt(new Date(dt.getTime() + durMin * 60000)),
      'SUMMARY:' + icsEsc(isPl ? 'Spotkanie Laundromats – automat pralniczy' : 'Schůzka Laundromats – prádlomat'), 'DESCRIPTION:' + icsEsc((isPl ? 'Potwierdzone spotkanie (' : 'Potvrzená schůzka (') + modeTxt + (isPl ? '). Potrwa około ' : '). Potrvá zhruba ') + durMin + ' min.'),
      'STATUS:CONFIRMED', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:' + (isPl ? 'Spotkanie za godzinę' : 'Schůzka za hodinu'), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const body = isPl
      ? 'Dzień dobry,\n\npotwierdzamy Twoje spotkanie: ' + when + ' – ' + modeTxt + '. Potrwa około ' + durMin + ' minut.\n\nTen termin zarezerwowaliśmy specjalnie dla Ciebie i zależy nam na tym, abyś z niego skorzystał. Zaproszenie do kalendarza znajdziesz w załączniku. Gdyby termin Ci nie odpowiadał, możesz go zmienić jednym kliknięciem za pomocą przycisku poniżej.\n\nLaundromats.eu'
      : 'Dobrý den, ' + voc.vocFirst(f.first_name, voc.isFemale(f.first_name, f.last_name)) + ',\n\nvaši schůzku potvrzujeme: ' + when + ' – ' + modeTxt + '. Potrvá zhruba ' + durMin + ' minut.\n\nTermín jsme si pro vás pevně vyhradili a rádi bychom, abyste ho využili. Pozvánku do kalendáře najdete v příloze tohoto e-mailu. Kdyby vám termín přesto nevyhovoval, můžete ho jedním kliknutím změnit tlačítkem níže.\n\nLaundromats.eu';
    await sendConfirmMail({ lang: isPl ? 'pl' : undefined, to: f.email, subject: (isPl ? 'Potwierdzenie spotkania ' : 'Potvrzení schůzky ') + when, body, ics, link: PUBLIC_URL + (isPl ? '/cesta/pl/schuzka' : '/cesta/schuzka') + (d.change_token ? '?zmena=' + encodeURIComponent(d.change_token) : ''), linkLabel: isPl ? 'Zmień termin' : 'Změnit termín' });
  } catch (e) { console.warn('[laundromats] potvrzovací e-mail:', e.message); }
  res.json(Object.assign({}, d, { account: 'none' }));
});

// ═══ Administrace schůzek (jen pro lidi přihlášené přes SSO z HolyOS: sekce Soukromé → Laundromats) ═══
// Přihlášení: HolyOS pošle krátký JWT (aud laundromats, iss holyos, podepsaný LM_SSO_SECRET) na /sso → podepsaná cookie (8 h).
// Kalendář (termíny, rezervace, automatika) žije v HolyOS; tenhle server ho jen zobrazuje přes /api/auth/bs2/meetings* s tokenem LM (iss laundromats).
const crypto = require('crypto');
const SESSION_KEY = LM_SECRET ? crypto.createHmac('sha256', LM_SECRET).update('lm-admin-session').digest('hex') : '';
const COOKIE = 'lm_admin';
const readCookie = (req, name) => { const m = String(req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find((p) => p[0] === name); return m ? decodeURIComponent(m.slice(1).join('=')) : ''; };
function adminOf(req) { if (!SESSION_KEY) return null; try { const t = jwt.verify(readCookie(req, COOKIE), SESSION_KEY, { audience: 'laundromats-admin', issuer: 'laundromats' }); return { name: t.name || '' }; } catch (e) { return null; } }
const toHolyos = () => HOLYOS_URL + '/api/auth/sso/laundromats';
app.get('/sso', (req, res) => {
  try {
    if (!LM_SECRET) return res.status(500).type('text/plain').send('Chybí LM_SSO_SECRET');
    const t = jwt.verify(String(req.query.t || ''), LM_SECRET, { audience: 'laundromats', issuer: 'holyos' });
    const session = jwt.sign({ name: t.name || '', aud: 'laundromats-admin', iss: 'laundromats' }, SESSION_KEY, { expiresIn: '8h' });
    res.set('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 8 * 3600);
    res.set('Cache-Control', 'no-store').redirect(302, '/admin/meetings');
  } catch (e) { res.status(401).type('text/plain').send('Přihlášení vypršelo. Otevři sekci Laundromats znovu z HolyOS.'); }
});
app.get('/admin/logout', (req, res) => { res.set('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'); res.redirect(302, '/cesta'); });
const requireAdmin = (req, res, next) => {
  const a = adminOf(req);
  if (a) { req.admin = a; return next(); }
  if (req.path.startsWith('/admin/api/')) return res.status(401).json({ ok: false, error: 'Přihlášení vypršelo. Otevři sekci Laundromats znovu z HolyOS.' });
  res.redirect(302, toHolyos());
};
app.get('/admin', requireAdmin, (req, res) => res.redirect(302, '/admin/meetings'));
const MA = require('./meetings-admin');
app.get('/admin/meetings', requireAdmin, (req, res) => res.set('Cache-Control', 'no-store').type('html').send(MA.meetingsPage({ admin: req.admin, holyosUrl: HOLYOS_URL })));
async function holyosSvc(method, p, body) {
  const token = jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || ('HolyOS vrátil chybu ' + r.status)); e.status = r.status; throw e; }
  return j;
}
const api = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ ok: false, error: e.message }); } };
const P = '/api/auth/bs2/meetings';
app.get('/admin/api/meetings/auto', requireAdmin, api(() => holyosSvc('GET', '/api/auth/bs2/meetings-auto')));
app.post('/admin/api/meetings/auto', requireAdmin, api((req) => holyosSvc('PUT', '/api/auth/bs2/meetings-auto', req.body || {})));
app.post('/admin/api/meetings/auto/run', requireAdmin, api(() => holyosSvc('POST', '/api/auth/bs2/meetings-auto/run', {})));
app.get('/admin/api/meetings', requireAdmin, api(async (req) => ({ ok: true, slots: await holyosSvc('GET', P + '?from=' + qs(req.query.from) + '&to=' + qs(req.query.to)) })));
app.post('/admin/api/meetings/slots', requireAdmin, api((req) => holyosSvc('POST', P + '/slots', { slots: (req.body || {}).slots || [] })));
app.post('/admin/api/meetings/slots/:id(\\d+)/update', requireAdmin, api((req) => holyosSvc('PATCH', P + '/slots/' + req.params.id, req.body || {})));
app.post('/admin/api/meetings/slots/:id(\\d+)/delete', requireAdmin, api((req) => holyosSvc('DELETE', P + '/slots/' + req.params.id)));
app.post('/admin/api/meetings/reservations/:id(\\d+)', requireAdmin, api((req) => holyosSvc('PATCH', P + '/reservations/' + req.params.id, { status: (req.body || {}).status })));

app.use((req, res) => res.status(404).type('text/plain').send('Stránka nenalezena'));
app.use((err, req, res, next) => { console.warn('[laundromats]', err && err.message); res.status(500).type('text/plain').send('Chyba serveru'); });

app.listen(PORT, () => console.log('[laundromats] běží na portu ' + PORT + ' · HolyOS ' + HOLYOS_URL + ' · veřejná adresa ' + PUBLIC_URL));
