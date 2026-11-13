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
// Jazykový prefix: /en/cesta → req.lang='en' + req.url='/cesta'. Musí být dřív než cokoli,
// co se podle adresy rozhoduje (přesměrování, ACC.attach, routy).
// Cesty, které se jazykem neřeší (API, administrace, soubory, média).
const BEZ_JAZYKA = /^\/(api|admin|media|img|favicon|robots\.txt|sso|r\/)/;
const LANG_CK = 'lm_lang';
app.use((req, res, next) => {
  const I = require('./i18n');
  // Volbu jazyka zapisujeme do obou podob cookie (s doménou i bez) — jinak se může
  // stará hodnota z druhé podoby přebít a návrat na češtinu „nejde" (hlavně Safari v mobilu).
  const setLang = (l) => { const base = LANG_CK + '=' + l + '; Path=/; Max-Age=31536000; SameSite=Lax'; res.append('Set-Cookie', base); const d = ckDomain(req); if (d) res.append('Set-Cookie', base + d); };
  // /cs/… = výslovná volba češtiny z přepínače → zapamatovat a přesměrovat na adresu bez předpony
  const c = /^\/cs(\/|$)/.exec(req.path);
  if (c && req.method === 'GET') {
    setLang('cs');
    const rest = req.url.slice(3) || '/';
    return res.redirect(302, rest.charAt(0) === '/' ? rest : '/' + rest);
  }
  const m = /^\/(en|pl)(\/|$)/.exec(req.path);
  if (m) {
    // Jazyk je v adrese — ta rozhoduje. Volbu si zapamatujeme, ať při dalším
    // příchodu bez předpony nepřehodíme člověka zpátky.
    req.lang = m[1];
    req.url = (req.url.slice(m[0].length - (m[2] === '/' ? 1 : 0)) || '/');
    if (cookies(req)[LANG_CK] !== m[1] || (req.headers.cookie || '').split(LANG_CK + '=').length > 2) setLang(m[1]);
    return next();
  }
  req.lang = 'cs';
  // Bez předpony: komu čeština nesedí, nabídneme jeho jazyk. Jen u normálních
  // stránek, jen GET a nikdy vyhledávačům — ty si mají zaindexovat každou verzi.
  if (req.method !== 'GET' || BEZ_JAZYKA.test(req.path) || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
  if (I.jeRobot(req.headers['user-agent'])) return next();
  const ck = cookies(req);
  const { lang } = I.detekuj({ headers: req.headers, cookieLang: ck[LANG_CK] || null });
  if (lang === 'cs') {
    // Čeština se bere jako volba, ať se při dalším načtení nepřepíná pod rukama.
    if (!ck[LANG_CK]) setLang('cs');
    return next();
  }
  const dotaz = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(302, '/' + lang + (req.path === '/' ? '' : req.path) + dotaz);
});
app.disable('x-powered-by');
const _jsonSmall = express.json({ limit: '20kb' }), _jsonAdmin = express.json({ limit: '300kb' }), _jsonFile = express.json({ limit: '15mb' });
// nastavení produktů = delší texty; zprávy podpory = příloha jako base64 (max 10 MB)
const _isSupSend = (p) => p === '/api/cesta/support/send' || /^\/admin\/api\/support\/threads\/\d+\/send$/.test(p) || /^\/admin\/api\/offers\/\d+\/image$/.test(p);
app.use((req, res, next) => (_isSupSend(req.path) ? _jsonFile : (req.path.startsWith('/admin/api/products') || req.path.startsWith('/admin/api/offers')) ? _jsonAdmin : _jsonSmall)(req, res, next));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  next();
});

// Stránky a aplikace žijí pod /cesta/… (jako Ekonomika). Staré adresy a subdoména lokality.* → přesměrování.
app.use((req, res, next) => {
  const q = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '';
  if (String(req.hostname || '').toLowerCase().startsWith('lokality.')) return res.redirect(301, PUBLIC_URL + '/cesta' + (/^\/(hledat|zhodnotit)/.test(req.path) ? req.path : '/hledat') + q);
  const m = /^\/(compounder|pradlomaty|hledat|zhodnotit)(\/.*)?$/.exec(req.path);
  if (m && req.method === 'GET') return res.redirect(301, '/cesta/' + m[1] + (m[2] || '') + q);
  next();
});
// Cookie platná pro laundromats.eu i subdomény (identita návštěvníka + přístup do aplikací)
const ckDomain = (req) => (/(^|\.)laundromats\.eu$/i.test(String((req && req.hostname) || '')) ? '; Domain=laundromats.eu' : '');

// ── jednoduchý limiter (v paměti) ──
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now(); const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); hits.set(key, a); if (hits.size > 5000) { for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }
  return a.length > max;
}

const CP = require('./cesta-pages');
const EP = require('./ekonomika-page');
const FOOT_CSS = '.site-foot{margin-top:70px;padding:26px 0 8px;border-top:1px solid rgba(120,160,255,.14);display:flex;align-items:center;justify-content:space-between;gap:16px 28px;flex-wrap:wrap;font-size:13.5px;color:#58698a}.site-foot b{font-weight:800;background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:15px}.site-foot nav{display:flex;flex-wrap:wrap;gap:6px 22px}.site-foot a{color:#7d93b8;text-decoration:none}.site-foot a:hover{color:#4fd1ff}';
const LOGO = '<span style="margin-right:10px;display:inline-flex"><svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="lmg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="17" fill="#0b1220"/><rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#lmg)" stroke-width="1.5"/><circle cx="32" cy="34" r="15" stroke="url(#lmg)" stroke-width="3.5"/><circle cx="32" cy="34" r="8" stroke="url(#lmg)" stroke-width="2.5" stroke-opacity=".6"/><circle cx="20" cy="16" r="2" fill="#4fd1ff"/><circle cx="27" cy="16" r="2" fill="#7c5cff"/></svg></span>';
const FOOTER = '<div style="max-width:720px;margin:0 auto;padding:0 22px 40px"><footer class="site-foot"><div><b>Laundromats.eu</b> &nbsp;© Best Series s.r.o.</div><nav><a href="/gdpr">Ochrana osobních údajů</a></nav></footer></div>';
// ── počítadlo „právě si prohlíží" v záhlaví (jako na Best Series 2.0): anonymní sid z prohlížeče, držíme jen v paměti ──
const PRES = new Map(); // sid → poslední ping (ms)
const PRES_HTML = '<span class="presence" id="presence" title="Právě online + aktivní lidé za posledních 60 minut (klouzavé okno)"><i></i><span class="pt">právě si prohlíží </span><b id="pr-hour">–</b></span>';
const PRES_CSS = '.presence{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;border:1px solid rgba(47,227,160,.35);background:rgba(47,227,160,.08);color:#a9f5d9;font-size:12px;font-weight:500;white-space:nowrap;transition:box-shadow .3s,background .3s;font-family:inherit;margin-left:12px}.presence i{width:7px;height:7px;border-radius:50%;background:#2fe3a0;box-shadow:0 0 8px #2fe3a0;animation:prpulse 2s infinite}.presence b{font-weight:800;color:#fff}.presence.flash{box-shadow:0 0 0 2px rgba(47,227,160,.5),0 0 22px rgba(47,227,160,.75);background:rgba(47,227,160,.22)}.presence.flash b{text-shadow:0 0 10px #2fe3a0}@keyframes prpulse{0%,100%{opacity:1}50%{opacity:.45}}@media(max-width:520px){.lhdr{padding-left:12px;padding-right:12px}.lhdr .in{gap:8px}.lhdr .brand{flex:none;min-width:0}.lhdr .brand>span:first-child{margin-right:7px!important}.lhdr .brand svg{width:30px;height:30px}.lhdr .brand .name{font-size:14px}.lsw{flex:none;margin-right:0!important}.presence{margin-left:2px;padding:3px 9px;font-size:11px}}@media(max-width:420px){.presence .pt{display:none}.lhdr .brand .name{font-size:13px}}';
const PRES_JS = '(function(){var el=document.getElementById("presence");if(!el)return;var h=document.getElementById("pr-hour"),last="";var sid;try{sid=localStorage.getItem("lm_sid");if(!sid){var cm=document.cookie.match(/(?:^|; )lm_sid=([^;]+)/);if(cm){sid=decodeURIComponent(cm[1]);localStorage.setItem("lm_sid",sid);}}if(!sid){sid="lm-"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem("lm_sid",sid);}}catch(e){sid="lm-x"+Date.now().toString(36);}'
  + 'function ping(){try{fetch("/api/presence/ping",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sid:sid}),keepalive:true});}catch(e){}}'
  + 'function upd(){fetch("/api/presence",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){if(!j)return;var v=j.total,k=String(v);h.textContent=v;if(last&&k!==last){el.classList.add("flash");setTimeout(function(){el.classList.remove("flash");},1400);}last=k;}).catch(function(){});}'
  + 'ping();setTimeout(upd,400);setInterval(function(){if(document.visibilityState==="visible"){ping();upd();}},15000);})();';
app.post('/api/presence/ping', (req, res) => {
  const sid = String((req.body || {}).sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (sid && !rateLimited('pp:' + req.ip, 240, 3600e3)) { PRES.set(sid, Date.now()); if (PRES.size > 20000) { const lim = Date.now() - 3600e3; for (const [k, v] of PRES) if (v < lim) PRES.delete(k); } }
  res.json({ ok: true });
});
app.get('/api/presence', (req, res) => {
  const now = Date.now(); let n = 0, hr = 0;
  for (const v of PRES.values()) { if (now - v < 120e3) n++; if (now - v < 3600e3) hr++; }
  res.set('Cache-Control', 'no-store').json({ now: n, hour: hr, total: Math.max(hr, n) });
});
const LH = require('./lm-header');
// Stránky mimo /cesta (úvod, Compounder, Prádlomaty): stejná lišta + počítadlo, bez přepínače jazyka
// Menu (<!--PRIV-->…<!--/PRIV-->) vidí jen přihlášený uživatel s účtem (správce z HolyOS se do nástrojů dostane přes „Správce“ → rozcestník)
// Správce z HolyOS se do zákaznických aplikací dostane i bez role — na to ten účet je.
// Aby si to nikdo nespletl se stavem běžného zákazníka, vidí o tom nahoře pruh.
const SPRAVCE_PRUH = '<div style="position:sticky;top:0;z-index:200;background:#422006;color:#fde68a;border-bottom:1px solid #a16207;padding:6px 16px;font:600 12.5px/1.4 Inter,system-ui,Arial,sans-serif;text-align:center">'
  + '⚠️ Vidíte to jako <b>správce z HolyOS</b> — zákazník bez odpovídající role se sem nedostane.'
  + ' <a href="/admin/logout" style="color:#fde68a;text-decoration:underline">Odhlásit správce</a></div>';
const spravcePruh = (html, req) => ((req && !req.account && adminOf(req))
  ? String(html).replace(/(<body[^>]*>)/, '$1' + SPRAVCE_PRUH)
  : String(html));
const liteRaw = (html, req) => String(html).replace(/<!--PUB-->([\s\S]*?)<!--\/PUB-->/g, (m, a) => ((req && req.account) ? '' : a)).replace(/<!--PRIV(?::([a-z]+))?-->([\s\S]*?)<!--\/PRIV-->/g, (m, k, a) => ((req && req.account && (!k || ACC.canSee(req, k))) ? a : '')).replace('<!--LACC-->', ACC.headerSlot(req)).replace('</style>', PRES_CSS + '</style>').replace('<span style="margin-left:auto"></span>', PRES_HTML + '<span style="margin-left:auto"></span>').replace('</body>', '<script>' + PRES_JS + '</script></body>');
const lite = (html, req) => spravcePruh(liteRaw(html, req), req);
const shell = (html, lang) => (String(html).replace('@@LHDR@@', LH.header({ lang, minimal: true })).replace('</style>', LH.CSS + '</style>').replace('@@LOGO@@', LOGO).replace('@@FOOTER@@', FOOTER).replace('</style>', FOOT_CSS + PRES_CSS + '</style>').replace('<!--PRESENCE-->', '').replace('<span style="margin-left:auto"></span>', PRES_HTML + '<span style="margin-left:auto"></span>').replace('</body>', '<script>' + PRES_JS + '</script></body>').replace('</body>', '<script src="/cesta/track.js" defer></script></body>'));
// ── Jazyk stránky ───────────────────────────────────────────────────────────
// Jazyk je v adrese: /en/… a /pl/…, čeština bez prefixu. Prefix se tady odřízne,
// zbytek adresy obslouží běžné routy a odpověď se na konci přeloží (i18n.js).
// Chybějící překlad = text zůstane česky, stránka se nikdy nerozbije.
const I18N = require('./i18n');
// Nové texty bez překladu se automaticky přeloží přes HolyOS (Claude) — viz i18n-auto.js
const I18N_AUTO = require('./i18n-auto')({ HOLYOS_URL, LM_SECRET });
const trAuto = (html, lang, req, js) => { const miss = new Set(); const out = js ? I18N.applyJs(html, lang, miss) : I18N.apply(html, lang, miss); const a = req && req.account; I18N_AUTO.collect(lang, miss, a ? [a.name, a.email, a.phone, a.company] : []); return out; };
const send = (res, html, req) => {
  const lang = (req && req.lang) || 'cs';
  let out = lang === 'cs' ? String(html) : trAuto(html, lang, req);
  // Odkazy na ostatní jazykové verze téže stránky — kvůli vyhledávačům, aby
  // nebraly překlady jako duplicitní obsah a aby každému nabídly tu jeho.
  if (req && !BEZ_JAZYKA.test(req.path) && out.indexOf('</head>') > 0 && out.indexOf('rel="alternate" hreflang=') === -1) {
    out = out.replace('</head>', I18N.hreflangTags(req.path, PUBLIC_URL) + '</head>');
  }
  return res.set('Cache-Control', 'no-cache').set('Vary', 'Accept-Language, Cookie').type('html').send(out);
};
// Odpověď s JavaScriptem (booking, kalkulačka) — texty v něm se překládají taky.
const sendJs = (res, js, req) => {
  const lang = (req && req.lang) || 'cs';
  return res.set('Cache-Control', 'no-cache').type('application/javascript').send(lang === 'cs' ? js : trAuto(js, lang, req, true));
};
const cestaHtml = () => fs.readFileSync(path.join(__dirname, 'cesta.html'), 'utf8');

app.use((req, res, next) => lmIdentity(req, res, next)); // identita návštěvníka v cookie (definice níž u /api/cesta/track)
// Účty registrovaných uživatelů (lm-account.js): req.account na každém požadavku
// Serverová událost (akce v aplikacích, přihlášení) do stejného deníku jako track.js
function trackServer(req, event, props) {
  try {
    const sid = SID_RE.test(cookies(req).lm_sid || '') ? cookies(req).lm_sid : ('server:' + (req.account ? 'acc:' + req.account.id : 'anon'));
    const p = Object.assign({ site: 'laundromats' }, props || {});
    if (req.account) { p.account_id = req.account.id; if (req.account.lead_id) p.lead_id = req.account.lead_id; }
    fetch(HOLYOS_URL + '/api/compounder/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': req.headers['user-agent'] || 'laundromats', 'X-Forwarded-For': req.ip || '' }, body: JSON.stringify({ sid, event, path: req.path, lang: 'cs', props: p }), signal: AbortSignal.timeout(8000) }).catch(() => {});
  } catch (e) { /* best-effort */ }
}
// Stránky účtu, podpory, aplikací a videohovoru: lite() + překlad do jazyka návštěvníka (/en, /pl)
const lmRender = (req, html) => { const out = lite(html, req); const lang = (req && req.lang) || 'cs'; return lang === 'cs' ? out : trAuto(out, lang, req); };
const ACC = require('./lm-account')({ HOLYOS_URL, LM_SECRET, PUBLIC_URL, rateLimited, cookies, ckDomain, sendMail: (p) => sendConfirmMail(p), adminOf: (req) => adminOf(req), render: lmRender, trackServer });
app.use((req, res, next) => (/^\/(cesta|api\/location|api\/cesta|api\/vc|videocall|uvod|$)/.test(req.path) ? ACC.attach(req, res, next) : next()));

// ── Záchranná brána: co není výslovně veřejné, chce přihlášení ──────────────
// Dosud si každá routa hlídala přístup sama. Stačilo by u jedné nové zapomenout
// `requirePage` a byla by otevřená všem. Tohle je druhá pojistka: seznam veřejných
// adres je taxativní, všechno ostatní pod /cesta, /api/cesta a /api/location
// projde přes requireAccount. Role (Začátečník / Ekonomika / Plný přístup) řeší
// dál `requirePage` u konkrétní routy — tahle brána ji nenahrazuje, jen doplňuje.
const VEREJNE = new Set([
  '/cesta', '/cesta/info', '/cesta/vlastni-kapital', '/cesta/financovani', '/cesta/schuzka',
  '/cesta/ekonomika', '/cesta/ekonomika/podrobne',
  '/cesta/ekonomika.js', '/cesta/pradlomat-economy.js', '/cesta/track.js',
  '/cesta/booking.js', '/cesta/booking.pl.js',
  // přihlášení a vše kolem účtu, co nutně musí jít i nepřihlášenému
  '/cesta/prihlaseni', '/cesta/registrace', '/cesta/overit', '/cesta/zapomenute-heslo',
  '/cesta/nove-heslo', '/cesta/aktivace', '/cesta/odhlasit',
  // měření a rezervace schůzky — zájemce ještě účet nemá
  '/api/cesta/track', '/api/cesta/meeting-slots', '/api/cesta/meeting-contact', '/api/cesta/meeting-reservation',
]);
const VEREJNE_PREFIX = [/^\/cesta\/pl(\/|$)/, /^\/videocall(\/|$)/, /^\/api\/vc(\/|$)/];
const HLIDANE = /^\/(cesta|api\/cesta|api\/location)(\/|$)/;
app.use((req, res, next) => {
  if (!HLIDANE.test(req.path)) return next();
  if (VEREJNE.has(req.path) || VEREJNE_PREFIX.some((re) => re.test(req.path))) return next();
  return ACC.requireAccount(req, res, next);
});
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /api/\n'));
// Úvodní stránka značky (home-page.js). Náhled vždy na /uvod; na / až s LM_HOME_LIVE=1 (do té doby / → /cesta jako dřív).
// Jedinečné odkazy ze SMS / e-mailu (?t= / ?l=) vedou dál na /cesta, ať funel zůstane beze změny.
const HP = require('./home-page');
const homeHtml = () => HP.homePage('cs');
app.get('/uvod', (req, res) => send(res, lite(homeHtml(), req), req));
app.get('/', (req, res) => {
  const q = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '';
  if (process.env.LM_HOME_LIVE === '1' && !req.query.t && !req.query.l) return send(res, lite(homeHtml(), req), req);
  res.redirect(302, '/cesta' + q);
});
// Poptávka z úvodní stránky → HolyOS (/api/compounder/lm-inquiry): založí / spáruje kontakt a upozorní vedení.
// Úspěch vracíme jen tehdy, když ho HolyOS skutečně potvrdí.
app.post('/api/inquiry', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot (bot) — tváříme se, že prošlo
  if (rateLimited('inq:' + req.ip, 5, 3600e3)) return res.status(429).json({ ok: false, error: 'Příliš mnoho odeslání, zkuste to později.' });
  const ck = cookies(req); let tl = {}; try { tl = JSON.parse(ck.lm_tl || '{}') || {}; } catch (_) {}
  const sid = SID_RE.test(String(b.sid || '')) ? b.sid : (SID_RE.test(ck.lm_sid || '') ? ck.lm_sid : undefined);
  try {
    const r = await fetch(HOLYOS_URL + '/api/compounder/lm-inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': req.ip || '', 'User-Agent': req.headers['user-agent'] || 'laundromats' },
      body: JSON.stringify({ name: b.name, email: b.email, phone: b.phone, interest: b.interest, place: b.place, note: b.note, lang: b.lang, sid, t: tlOk(tl.t, null) ? tl.t : undefined, l: tlOk(null, tl.l) ? tl.l : undefined }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return res.status(r.status >= 400 ? r.status : 502).json({ ok: false, error: j.error || 'Odeslání se nepodařilo' });
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ ok: false, error: 'Odeslání se nepodařilo' }); }
});
// „Mám zájem" u karty prádlomatu → HolyOS (/api/compounder/lm-pradlomat-zajem).
// Stránka prádlomatů je za přihlášením, takže zákazníka známe z jeho účtu — nic
// nevyplňuje, jen potvrdí zájem a my mu voláme (naléhavá notifikace do Velína).
// Cesta musí začínat /api/cesta, jinak se nenavěsí ACC.attach (viz app.use výš).
app.post('/api/cesta/pradlomat-zajem', async (req, res) => {
  const b = req.body || {};
  if (!req.account || !req.account.id) return res.status(401).json({ ok: false, error: 'Pro odeslání se prosím přihlaste.' });
  if (rateLimited('zajem:' + req.account.id, 5, 3600e3)) return res.status(429).json({ ok: false, error: 'Zájem už evidujeme, ozveme se vám.' });
  const ck = cookies(req);
  const sid = SID_RE.test(String(b.sid || '')) ? b.sid : (SID_RE.test(ck.lm_sid || '') ? ck.lm_sid : undefined);
  try {
    const j = await holyosSvc('POST', '/api/compounder/lm-pradlomat-zajem', { account_id: req.account.id, product: b.product, sid });
    if (!j || !j.ok) return res.status(502).json({ ok: false, error: (j && j.error) || 'Odeslání se nepodařilo' });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[laundromats] zájem o prádlomat:', e.message);
    res.status(e.status && e.status < 500 ? e.status : 502).json({ ok: false, error: 'Odeslání se nepodařilo' });
  }
});

app.get('/favicon.svg', (req, res) => res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(LOGO.replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '').replace('width="34" height="34"', 'width="64" height="64"')));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.use('/media', express.static(path.join(__dirname, 'media'), { maxAge: '7d', fallthrough: false })); // fotky provozoven + videa (Range pro přehrávání)
app.get('/img/pradlomat-flex.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(__dirname, 'pradlomat-flex.webp')));
app.get('/img/pradlomat-mini.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(__dirname, 'pradlomat-mini.webp')));

// ── stránky cesty (CZ) ──
app.get('/cesta', (req, res) => send(res, shell(cestaHtml(), req.lang), req));
app.get('/cesta/info', (req, res) => send(res, shell(CP.infoPage(), req.lang), req));
app.get('/cesta/vlastni-kapital', (req, res) => send(res, shell(CP.vlastniPage(), req.lang), req));
app.get('/cesta/financovani', (req, res) => send(res, shell(CP.financovaniPage(), req.lang), req));
app.get('/cesta/schuzka', (req, res) => send(res, shell(CP.schuzkaPage(), req.lang), req));
app.get('/cesta/ekonomika', (req, res) => send(res, shell(EP.economyPage('cs'), req.lang), req));
app.get('/cesta/ekonomika/podrobne', (req, res) => send(res, shell(EP.economyDetailPage('cs'), req.lang), req));
app.get('/ekonomika', (req, res) => res.redirect(302, '/cesta/ekonomika' + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '')));
app.get('/cesta/track.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(__dirname, 'track.js')));
// Sledování chování → HolyOS (/api/compounder/track). Kontakt se pozná podle t/l (HolyOS ověří podpis); IP a prohlížeč se předávají dál.
// Identita návštěvníka v cookie ze serveru (Safari maže localStorage po 7 dnech bez návštěvy, cookie ze serveru ne):
//   lm_sid — anonymní id prohlížeče (čte ho i track.js), lm_tl — t/l z jedinečného odkazu (jen server, HttpOnly).
const CK_AGE = 400 * 86400; // max. doba, kterou prohlížeče u cookie dovolí
function cookies(req) { const o = {}; String(req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) {} } }); return o; }
function setCk(res, name, val, httpOnly) { res.append('Set-Cookie', name + '=' + encodeURIComponent(val) + '; Path=/; Max-Age=' + CK_AGE + '; SameSite=Lax; Secure' + ckDomain(res.req) + (httpOnly ? '; HttpOnly' : '')); }
const SID_RE = /^lm-[a-z0-9]{4,60}$/;
const tlOk = (t, l) => (t && /^[0-9]+\.[A-Za-z0-9._-]{8,200}$/.test(String(t))) || (l && /^[0-9a-z]+\.[A-Za-z0-9_-]{4,40}$/.test(String(l)));
// Každá stránka: zapamatuj jedinečný odkaz (t/l) a zajisti trvalé sid (zapojeno nahoře před stránkami: app.use(lmIdentity))
function lmIdentity(req, res, next) {
  if (req.method === 'GET' && /^\/(cesta|pl|ekonomika|uvod|compounder|pradlomaty|hledat|zhodnotit|videocall|$)/.test(req.path)) {
    const ck = cookies(req); const t = req.query.t, l = req.query.l;
    if (tlOk(t, l)) setCk(res, 'lm_tl', JSON.stringify({ t: t || '', l: l || '' }), true);
    if (!SID_RE.test(ck.lm_sid || '')) setCk(res, 'lm_sid', 'lm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10), false);
  }
  next();
}
app.post('/api/cesta/track', (req, res) => {
  const b0 = req.body || {}; const ck = cookies(req);
  // sid z prohlížeče = sid v cookie (návrat po smazání localStorage pak naváže na stejného návštěvníka)
  if (SID_RE.test(String(b0.sid || '')) && ck.lm_sid !== b0.sid) setCk(res, 'lm_sid', b0.sid, false);
  const p0 = b0.props && typeof b0.props === 'object' ? b0.props : null;
  // Přihlášený uživatel: každá událost nese účet + kontakt → kompletní pohyb v detailu uživatele
  if (p0 && req.account) { p0.account_id = req.account.id; if (req.account.lead_id) p0.lead_id = req.account.lead_id; }
  if (p0 && tlOk(p0.t, p0.l)) { const v = JSON.stringify({ t: p0.t || '', l: p0.l || '' }); if (ck.lm_tl !== v) setCk(res, 'lm_tl', v, true); }
  else if (p0 && ck.lm_tl) { try { const s = JSON.parse(ck.lm_tl); if (s && tlOk(s.t, s.l)) { if (s.t) p0.t = s.t; if (s.l) p0.l = s.l; p0.ident_via = 'cookie'; } } catch (_) {} }
  res.status(204).end();
  try {
    const b = req.body || {};
    if (!b.event || !b.sid || rateLimited('trk:' + req.ip, 240, 60000)) return;
    fetch(HOLYOS_URL + '/api/compounder/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': req.headers['user-agent'] || 'laundromats', 'X-Forwarded-For': req.ip || '' }, body: JSON.stringify({ sid: String(b.sid).slice(0, 64), event: String(b.event).slice(0, 60), path: b.path, lang: b.lang, props: b.props && typeof b.props === 'object' ? b.props : {} }), signal: AbortSignal.timeout(8000) }).catch(() => {});
  } catch (e) { /* analytika je best-effort */ }
});
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
// Fotky strojů V2/V3 z HolyOS (jen ver + photo, bez cen a slev; cache 1 h) — používá stránka Ekonomika i podrobný model
let _mach = { at: 0, data: { machines: [], discount: null } };
app.get('/api/compounder/portal/machines', async (req, res) => {
  try {
    if (Date.now() - _mach.at > 3600000) {
      const r = await fetch(HOLYOS_URL + '/api/compounder/portal/machines'); const j = await r.json();
      _mach = { at: Date.now(), data: { machines: (j.machines || []).filter((m) => m && m.ver && m.photo).map((m) => ({ ver: m.ver, photo: m.photo })), discount: null } };
    }
  } catch (e) { _mach.at = Date.now() - 3000000; }
  res.set('Cache-Control', 'public, max-age=1800').json(_mach.data);
});
app.get('/cesta/booking.js', (req, res) => sendJs(res, CP.bookingJs(), req));
// ── polská verze ──
// Staré adresy /cesta/pl… vedou na nový jazykový prefix /pl/cesta… (jeden systém překladu).
const plStara = (cil) => (req, res) => res.redirect(301, '/pl' + cil + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : ''));
app.get('/cesta/pl', plStara('/cesta'));
app.get('/cesta/pl/ekonomika', plStara('/cesta/ekonomika'));
app.get('/cesta/pl/ekonomika/podrobne', plStara('/cesta/ekonomika/podrobne'));
app.get('/cesta/pl/info', plStara('/cesta/info'));
app.get('/cesta/pl/vlastni-kapital', plStara('/cesta/vlastni-kapital'));
app.get('/cesta/pl/financovani', plStara('/cesta/financovani'));
app.get('/cesta/pl/schuzka', plStara('/cesta/schuzka'));
// Sledovaný odkaz ze SMS / e-mailu (viditelná doména laundromats.eu) → HolyOS zaloguje otevření a přesměruje zpět na stránku
app.get('/r/:code/:variant?', (req, res) => {
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, HOLYOS_URL + '/r/' + encodeURIComponent(req.params.code) + (req.params.variant ? '/' + encodeURIComponent(req.params.variant) : '') + qs);
});
app.get('/cesta/booking.pl.js', (req, res) => { req.lang = 'pl'; sendJs(res, CP.bookingJs(), req); });

// Ochrana osobních údajů (stručné informace; správce Best Series s.r.o.)
const GDPR = require('./gdpr-page');
app.get('/gdpr', (req, res) => send(res, GDPR.page(), req));

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
      body: JSON.stringify({ slot_id: b.slot_id, t: b.t || undefined, l: b.l || undefined, change: b.change || undefined, mode: b.mode, path: b.path, lang: b.lang === 'pl' ? 'pl' : undefined, sid: /^lm-[a-z0-9]{4,60}$/.test(String(b.sid || '')) ? b.sid : undefined, name: f.first_name + ' ' + f.last_name, email: f.email, phone: f.phone, existing_account: false }) });
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
    res.set('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 8 * 3600 + ckDomain(req));
    res.set('Cache-Control', 'no-store').redirect(302, '/admin/meetings');
  } catch (e) { res.status(401).type('text/plain').send('Přihlášení vypršelo. Otevři sekci Laundromats znovu z HolyOS.'); }
});
app.get('/admin/logout', (req, res) => { res.set('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' + ckDomain(req)); res.redirect(302, '/cesta'); });
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
app.get('/admin/api/meetings', requireAdmin, api(async (req) => {
  const range = '?from=' + qs(req.query.from) + '&to=' + qs(req.query.to);
  const [slots, promises] = await Promise.all([
    holyosSvc('GET', P + range),
    holyosSvc('GET', '/api/auth/bs2/meetings-promises' + range).catch(() => []), // slíbené kroky Tomáše/Jana (žlutě); výpadek neshodí kalendář
  ]);
  return { ok: true, slots, promises: Array.isArray(promises) ? promises : [] };
}));
app.post('/admin/api/meetings/slots', requireAdmin, api((req) => holyosSvc('POST', P + '/slots', { slots: (req.body || {}).slots || [] })));
app.post('/admin/api/meetings/slots/:id(\\d+)/update', requireAdmin, api((req) => holyosSvc('PATCH', P + '/slots/' + req.params.id, req.body || {})));
app.post('/admin/api/meetings/slots/:id(\\d+)/delete', requireAdmin, api((req) => holyosSvc('DELETE', P + '/slots/' + req.params.id)));
app.post('/admin/api/meetings/reservations/:id(\\d+)', requireAdmin, api((req) => holyosSvc('PATCH', P + '/reservations/' + req.params.id, { status: (req.body || {}).status })));
// Jmenný seznam — kontakty označené v HolyOS jako „zajímavý kontakt".
app.post('/admin/api/leads/:id(\\d+)/hot', requireAdmin, api(async (req) => holyosSvc('POST', '/api/auth/bs2/leads/' + req.params.id + '/hot', { hot: !!(req.body || {}).hot })));
app.post('/admin/api/users/:id(\\d+)/role', requireAdmin, api((req) => holyosSvc('POST', '/api/auth/lm/accounts/' + req.params.id + '/plan', { plan: String((req.body || {}).plan || '') })));
app.get('/admin/api/users', requireAdmin, api(async () => ({ ok: true, users: (await holyosSvc('GET', '/api/auth/lm/accounts/list')).users || [] })));
app.post('/admin/api/users/:id(\\d+)/access', requireAdmin, api((req) => { const b = req.body || {}; return holyosSvc('POST', '/api/auth/lm/accounts/' + req.params.id + '/access', { page: String(b.page || ''), on: b.on === null || b.on === undefined ? null : !!b.on }); }));
app.post('/admin/api/users/:id(\\d+)/note', requireAdmin, api((req) => holyosSvc('POST', '/api/auth/lm/accounts/' + req.params.id + '/note', { note: String((req.body || {}).note || '').slice(0, 5000) })));
app.post('/admin/api/users/:id(\\d+)/profile', requireAdmin, api((req) => { const b = req.body || {}; return holyosSvc('POST', '/api/auth/lm/accounts/' + req.params.id + '/profile', { name: b.name, phone: b.phone, company: b.company }); }));
app.post('/admin/api/users/:id(\\d+)/marketplace', requireAdmin, api((req) => holyosSvc('POST', '/api/auth/lm/accounts/' + req.params.id + '/marketplace', { on: !!(req.body || {}).on })));
app.post('/admin/api/users/:id(\\d+)/disabled', requireAdmin, api((req) => holyosSvc('POST', '/api/auth/lm/accounts/' + req.params.id + '/disabled', { disabled: !!(req.body || {}).disabled })));
// Sloupcove filtry tabulek bereme primo z HolyOS (/js/column-filters.js), aby se admin
// ovladal uplne stejne jako tabulky v HolyOS a nevznikala druha kopie kodu. Servirujeme
// je ze stejne domeny (kvuli spolehlivosti) a drzime 10 minut v pameti; kdyz HolyOS
// nejede, vratime prazdno a tabulky se vykresli aspon bez filtru.
let _cf = { at: 0, body: '' };
app.get('/admin/column-filters.js', requireAdmin, async (req, res) => {
  res.type('application/javascript');
  if (_cf.body && Date.now() - _cf.at < 10 * 60e3) return res.set('Cache-Control', 'private, max-age=600').send(_cf.body);
  try {
    const r = await fetch(HOLYOS_URL + '/js/column-filters.js', { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const t = await r.text();
    if (!/ColFilters/.test(t)) throw new Error('neocekavany obsah');
    _cf = { at: Date.now(), body: t };
    res.set('Cache-Control', 'private, max-age=600').send(t);
  } catch (e) {
    res.set('Cache-Control', 'no-store').send('/* sloupcove filtry z HolyOS se nepodarilo nacist: ' + String(e.message).replace(/[*]\//g, '') + ' */');
  }
});

app.get('/admin/api/users/:id(\\d+)/activity', requireAdmin, api(async (req) => holyosSvc('GET', '/api/auth/lm/accounts/' + req.params.id + '/activity')));
// Statistika schuzek (tyden / mesic / rok) pro zalozku Statistiky v administraci.
app.get('/admin/api/meetings-stats', requireAdmin, api(async (req) => Object.assign({ ok: true },
  await holyosSvc('GET', '/api/auth/bs2/meetings-stats?group=' + qs(req.query.group) + '&n=' + qs(req.query.n) + '&src=' + qs(req.query.src || 'all')))));
app.get('/admin/api/hot-leads', requireAdmin, api(async () => ({ ok: true, leads: await holyosSvc('GET', '/api/auth/bs2/hot-leads') })));

// ── Stránky Compounder + Prádlomaty (převzato z BS2, upraveno pro zájemce) ──
// Nabídka strojů z HolyOS (ceník, aktivní stroje). LM_PRODUCT_IDS = čárkami oddělená ID pro zúžení nabídky.
let _prod = { at: 0, data: null };
async function fetchProducts() {
  if (_prod.data && Date.now() - _prod.at < 5 * 60e3) return _prod.data;
  if (!LM_SECRET) throw new Error('Chybí LM_SSO_SECRET');
  const token = jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
  const r = await fetch(HOLYOS_URL + '/api/auth/lm/products', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('HolyOS produkty HTTP ' + r.status);
  let list = await r.json(); if (!Array.isArray(list)) list = [];
  const ids = String(process.env.LM_PRODUCT_IDS || '').split(',').map((x) => parseInt(x, 10)).filter(Boolean);
  if (ids.length) list = list.filter((p) => ids.includes(p.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  _prod = { at: Date.now(), data: list };
  return list;
}
const COMP = require('./compounder-page');
const PRAD = require('./pradlomaty-page');
app.get('/cesta/compounder', ACC.requirePage('compounder'), (req, res) => send(res, lite(COMP.compounderPage(), req), req));
// Ekonomika pro přihlášené: stejný model jako /cesta/ekonomika (ten zůstává veřejný pro cestu z SMS), ale s menu
app.get('/cesta/ucet/ekonomika', ACC.requirePage('ekonomika'), (req, res) => send(res, lite(String(EP.economyPage('cs')).replace(/<a class="bx-back"[^>]*>[^<]*<\/a>/, '<a class="bx-back" href="/cesta/ucet">← zpět na nástroje</a>').replace('@@LHDR@@', LH.header({})).replace('</style>', LH.CSS + FOOT_CSS + '</style>').replace('@@LOGO@@', LOGO).replace('@@FOOTER@@', FOOTER).replace('</body>', '<script src="/cesta/track.js" defer></script></body>'), req), req));
// Nastavení produktů z administrace (viditelnost, pořadí, texty, ceny) — HolyOS AppSetting, cache 1 min
let _pcfg = { at: 0, data: null };
async function fetchProdConfig() {
  if (_pcfg.data && Date.now() - _pcfg.at < 60e3) return _pcfg.data;
  try { const j = await holyosSvc('GET', '/api/auth/lm/products-config'); _pcfg = { at: Date.now(), data: j.config || { items: {} } }; } catch (e) { if (!_pcfg.data) _pcfg = { at: Date.now() - 50e3, data: { items: {} } }; }
  return _pcfg.data;
}
app.get('/cesta/pradlomaty', ACC.requirePage('pradlomaty'), async (req, res) => { let list = []; try { list = await fetchProducts(); } catch (e) { console.warn('[laundromats] produkty:', e.message); if (_prod.data) list = _prod.data; } send(res, lite(PRAD.pradlomatyPage(list, await fetchProdConfig()), req), req); });
// ── Administrace → Produkty ──
app.get('/admin/api/products', requireAdmin, api(async () => { _prod.at = 0; const products = await fetchProducts(); const j = await holyosSvc('GET', '/api/auth/lm/products-config'); return { ok: true, products, config: j.config || { items: {} } }; }));
app.post('/admin/api/products/config', requireAdmin, api(async (req) => { const j = await holyosSvc('PUT', '/api/auth/lm/products-config', { config: (req.body || {}).config || {} }); _pcfg = { at: 0, data: null }; return j; }));
app.post('/admin/api/products/:id(\\d+)/image', requireAdmin, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '8mb' }), api(async (req) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) { const e = new Error('Chybí obrázek (PNG, JPG nebo WebP)'); e.status = 400; throw e; }
  const j = await holyosSvc('POST', '/api/auth/lm/products/' + req.params.id + '/lm-image', { mime: String(req.headers['content-type'] || '').split(';')[0], data: req.body.toString('base64') });
  _prod.at = 0; return j;
}));
app.post('/admin/api/products/:id(\\d+)/image/delete', requireAdmin, api(async (req) => { const j = await holyosSvc('DELETE', '/api/auth/lm/products/' + req.params.id + '/lm-image'); _prod.at = 0; return j; }));
app.get('/img/pradlomat.webp', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(__dirname, 'pradlomat-flex.webp')));
// Miniatura modelu (mini|flex|max) pro mapu na úvodní stránce — první stroj z ceníku s obrázkem, jehož
// varianta/název obsahuje dané slovo (přednost CZ). Bez shody → obecný obrázek prádlomatu.
app.get('/img/model/:kind(mini|flex|max)', async (req, res) => {
  try {
    const re = new RegExp('\\b' + req.params.kind + '\\b', 'i');
    const list = (await fetchProducts()).filter((p) => p.image_ext && (re.test(p.model_variant || '') || re.test(p.name_cs || '')));
    const p = list.find((x) => /\bCZ\b/.test(x.name_cs || '')) || list[0];
    if (p) return res.redirect(302, '/img/product/' + p.id + '?v=' + encodeURIComponent(String(p.image_updated_at || '')));
  } catch (e) { /* fallback níže */ }
  res.redirect(302, '/img/pradlomat.webp');
});
app.get('/img/product/:id(\\d+)', async (req, res) => {
  try {
    if (!LM_SECRET) return res.status(404).end();
    const token = jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
    const r = await fetch(HOLYOS_URL + '/api/auth/lm/products/' + req.params.id + '/image', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(404).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/webp').set('Cache-Control', 'public, max-age=86400').send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(404).end(); }
});
// ── Podpora Laundromats (chat /cesta/podpora + administrace → Podpora; data v HolyOS, odpovídá se i z Velínu) ──
const SUP = require('./lm-support')(app, { HOLYOS_URL, LM_SECRET, requireAccount: ACC.requireAccount, requireAdmin, render: lmRender, trackServer });
ACC.setSupportUnread(SUP.unread);
// ── Nabídky korporátům (administrace → 🤝 Korporáty, veřejná nabídka /nabidka/<token>; data v HolyOS) ──
require('./lm-offers')(app, { HOLYOS_URL, LM_SECRET, requireAdmin, rateLimited, fetchProducts, fetchProdConfig });
// ── Aplikace lokalit (/cesta/hledat, /cesta/zhodnotit) ──
ACC.mount(app);
// Videohovor s kompetentní osobou (/videocall) — WebRTC + SSE, upozornění přes HolyOS (Velín)
require('./lm-videocall')(app, { HOLYOS_URL, LM_SECRET, rateLimited, render: lmRender, trackServer });
require('./lm-apps')(app, { HOLYOS_URL, rateLimited, fetchProducts, requireAccount: ACC.requireAccount, requirePage: ACC.requirePage, render: lmRender, trackServer });

app.use((req, res) => res.status(404).type('text/plain').send('Stránka nenalezena'));
app.use((err, req, res, next) => { console.warn('[laundromats]', err && err.message); res.status(500).type('text/plain').send('Chyba serveru'); });

app.listen(PORT, () => console.log('[laundromats] běží na portu ' + PORT + ' · HolyOS ' + HOLYOS_URL + ' · veřejná adresa ' + PUBLIC_URL));
