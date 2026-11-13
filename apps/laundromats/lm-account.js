// Laundromats — účty registrovaných uživatelů (registrace, ověření e-mailu, přihlášení, obnova hesla, Můj účet).
// Účty jsou v HolyOS (LmAccount, /api/auth/lm/accounts/*); tady je jen relace v cookie lm_acc (JWT, 30 dní)
// s průběžnou kontrolou platnosti v HolyOS (zablokování / změna hesla odhlásí do 5 minut).
'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { layout, esc } = require('./lm-layout');

module.exports = function createAccounts(ctx) {
  const { HOLYOS_URL, LM_SECRET, PUBLIC_URL, rateLimited, cookies, ckDomain, sendMail, adminOf } = ctx;
  const KEY = crypto.createHmac('sha256', LM_SECRET || 'lm-dev').update('lm-account-session').digest('hex');
  const CK = 'lm_acc'; const AGE = 30 * 86400;
  const cache = new Map(); // id → { at, account }

  async function hos(method, p, body) {
    if (!LM_SECRET) return { status: 500, j: { error: 'Chybí LM_SSO_SECRET' } };
    const token = jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
    try {
      const r = await fetch(HOLYOS_URL + '/api/auth/lm/accounts' + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
      return { status: r.status, j: await r.json().catch(() => ({})) };
    } catch (e) { return { status: 502, j: { error: 'Služba je dočasně nedostupná, zkuste to prosím za chvíli.' } }; }
  }
  // Napojení prohlížeče (sid) na kontakt + událost do deníku pohybu
  function linkAndTrack(req, a, event) {
    const sid = cookies(req).lm_sid;
    if (sid) hos('POST', '/' + a.id + '/link-sid', { sids: [sid] }).catch(() => {});
    if (ctx.trackServer) { const r2 = Object.assign({}, req, { account: a, headers: req.headers, path: req.path, ip: req.ip }); ctx.trackServer(r2, event, {}); }
  }
  function setSession(req, res, a) {
    const t = jwt.sign({ sub: a.id, v: a.v, aud: 'lm-account', iss: 'laundromats' }, KEY, { expiresIn: AGE });
    res.append('Set-Cookie', CK + '=' + t + '; Path=/; Max-Age=' + AGE + '; HttpOnly; Secure; SameSite=Lax' + ckDomain(req));
    cache.set(a.id, { at: Date.now(), account: a });
  }
  function clearSession(req, res) { res.append('Set-Cookie', CK + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' + ckDomain(req)); }

  // Middleware: req.account (nebo null)
  async function attachInner(req, res, next) {
    req.account = null;
    const raw = cookies(req)[CK];
    if (!raw) return next();
    let t; try { t = jwt.verify(raw, KEY, { audience: 'lm-account', issuer: 'laundromats' }); } catch (e) { clearSession(req, res); return next(); }
    const c = cache.get(t.sub);
    if (c && c.account.v === t.v && Date.now() - c.at < 5 * 60e3) { req.account = c.account; return next(); }
    const r = await hos('GET', '/' + Number(t.sub) + '/session?v=' + encodeURIComponent(t.v));
    if (r.status === 200 && r.j.account) { cache.set(t.sub, { at: Date.now(), account: r.j.account }); req.account = r.j.account; }
    else if (r.status === 401) { cache.delete(t.sub); clearSession(req, res); }
    else if (c) req.account = c.account; // HolyOS nedostupný → ponecháme poslední známý stav
    if (cache.size > 5000) cache.clear();
    next();
  }
  const safeNext = (n) => (/^\/cesta\/[A-Za-z0-9/_.?=&%-]*$/.test(String(n || '')) && !/^\/cesta\/(prihlaseni|registrace|odhlasit)/.test(String(n)) ? String(n) : '/cesta/ucet');
  // ── Role (LmAccount.plan): co uživatel uvidí. Nová registrace = Začátečník. Role nastavuje správce v administraci → Uživatelé.
  const ROLES = {
    beginner: { label: 'Začátečník', pages: ['podpora', 'compounder', 'pradlomaty'] },
    economy: { label: 'Ekonomika', pages: ['podpora', 'compounder', 'pradlomaty', 'ekonomika'] },
    full: { label: 'Plný přístup', pages: ['podpora', 'compounder', 'pradlomaty', 'ekonomika', 'hledat', 'zhodnotit'] },
  };
  const roleOf = (a) => (a && ROLES[a.plan] ? a.plan : 'beginner'); // 'free' (původní výchozí) = Začátečník
  const canSee = (req, page) => !!(req && ((req.account && ROLES[roleOf(req.account)].pages.includes(page)) || (!req.account && adminOf(req))));
  function requirePage(page) {
    return (req, res, next) => {
      if (!req.account && !adminOf(req)) return requireAccount(req, res, next);
      if (canSee(req, page)) return next();
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Tato část není ve vašem přístupu.' });
      send(req, res, 'Bez přístupu', box('Tato část zatím není ve vašem přístupu', '', '<p>Váš účet má roli <b>' + esc(ROLES[roleOf(req.account)].label) + '</b>. Přístup k dalším nástrojům vám rádi otevřeme – stačí se nám ozvat.</p><div class="acc-links"><a href="/cesta/ucet">← Moje nástroje</a><a href="/cesta/schuzka">Domluvit online schůzku</a></div>'), 403);
    };
  }
  function requireAccount(req, res, next) {
    if (req.account || adminOf(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Přihlaste se prosím.' });
    res.redirect(302, '/cesta/prihlaseni?next=' + encodeURIComponent(req.originalUrl));
  }

  // ── stránky ──
  const CSS = `<style>.acc-box{max-width:460px;margin:30px auto 0}.acc-box h1{margin:0 0 6px;font-size:28px;text-align:center}.acc-box>p.muted{text-align:center}.acc-logo{display:flex;align-items:center;justify-content:center;gap:0;margin:4px 0 16px;font-weight:800;font-size:22px;letter-spacing:.01em}.acc-logo b{background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}.acc-box label{display:block;margin-top:12px}.acc-box .btn{width:100%;margin-top:18px;justify-content:center}
  .acc-links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:14px}.acc-links a{color:var(--accent2)}
  .acc-lock{position:relative;text-align:left;font:inherit;color:inherit;cursor:pointer;filter:grayscale(1);opacity:.5;width:100%}.acc-lock:hover{opacity:.75;transform:none}.acc-lock .ic{box-shadow:none}.acc-lk{position:absolute;top:14px;right:14px;font-size:18px}.acc-tile{position:relative}.acc-badge{position:absolute;top:14px;right:14px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#ef4444;color:#fff;font-size:12px;font-weight:800;display:grid;place-items:center;box-shadow:0 0 0 3px rgba(239,68,68,.25)}
  .acc-ov{position:fixed;inset:0;z-index:9000;background:rgba(2,5,12,.78);display:flex;align-items:center;justify-content:center;padding:18px}.acc-ov[hidden]{display:none}.acc-ovc{position:relative;max-width:440px;width:100%;text-align:center;margin:0}.acc-x{position:absolute;top:8px;right:12px;background:none;border:0;color:var(--text2);font-size:24px;cursor:pointer}
  .acc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:18px}.acc-tile{display:block;text-decoration:none;color:inherit;margin:0;transition:transform .15s,border-color .15s}.acc-tile:hover{transform:translateY(-2px);border-color:rgba(79,209,255,.45)}.acc-tile .ic{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;color:#9fe6ff;background:linear-gradient(135deg,rgba(79,209,255,.18),rgba(124,92,255,.22));border:1px solid rgba(120,160,255,.32);box-shadow:0 10px 26px -12px rgba(79,140,255,.7),inset 0 1px 0 rgba(255,255,255,.06);transition:transform .2s,box-shadow .2s,color .2s}.acc-tile:hover .ic{transform:translateY(-1px) scale(1.04);color:#fff;box-shadow:0 14px 34px -12px rgba(124,92,255,.85),inset 0 1px 0 rgba(255,255,255,.08)}.acc-tile h3{margin-top:14px!important}.acc-tile h3{margin:8px 0 4px}.acc-tile p{margin:0;color:var(--text2);font-size:14px}</style>`;
  const LOGO = require('./lm-header').LOGO.replace('width="34" height="34"', 'width="46" height="46"');
  const box = (title, sub, inner) => CSS + `<div class="card acc-box"><div class="acc-logo">${LOGO}<span>Laundromats<b>.eu</b></span></div><h1>${title}</h1>${sub ? `<p class="muted" style="margin:0 0 6px">${sub}</p>` : ''}${inner}</div>`;
  const msgHtml = (err, ok) => (err ? `<div class="msg err">${esc(err)}</div>` : '') + (ok ? `<div class="msg ok">${esc(ok)}</div>` : '');
  const urlenc = require('express').urlencoded({ extended: false, limit: '20kb' });
  // opts se predava do layout() - rozcestnik si jim vypina vlastni odkaz 'zpet na nastroje'
  const send = (req, res, title, body, code, opts) => res.status(code || 200).set('Cache-Control', 'no-store').type('html').send(ctx.render(req, layout(Object.assign({ title, body }, opts || {}))));

  const loginPage = (q, err, ok) => box('Přihlášení do prostředí', '', `${msgHtml(err, ok)}
    <form method="post" action="/cesta/prihlaseni"><input type="hidden" name="next" value="${esc(safeNext(q.next))}">
    <label>E-mail<input name="email" type="email" required maxlength="160" autocomplete="email" value="${esc(q.email || '')}"></label>
    <label>Heslo<input name="password" type="password" required maxlength="200" autocomplete="current-password"></label>
    <button class="btn" type="submit">Přihlásit se</button></form>
    <div class="acc-links"><span></span><a href="/cesta/zapomenute-heslo">Zapomenuté heslo?</a></div>
    <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border);text-align:center"><p class="muted" style="margin:0 0 4px">Ještě nemáte účet?</p>
    <a class="btn sec" style="width:100%;justify-content:center;margin-top:6px" href="/cesta/registrace${q.next ? '?next=' + encodeURIComponent(safeNext(q.next)) : ''}">Vytvořit účet zdarma</a></div>`);
  const regPage = (q, err) => box('Registrace', 'Vytvořte si zdarma účet a získejte přístup ke všem nástrojům.', `${msgHtml(err)}
    <form method="post" action="/cesta/registrace"><input type="hidden" name="next" value="${esc(safeNext(q.next))}">
    <label>Jméno a příjmení<input name="name" required maxlength="120" autocomplete="name" value="${esc(q.name || '')}"></label>
    <label>E-mail<input name="email" type="email" required maxlength="160" autocomplete="email" value="${esc(q.email || '')}"></label>
    <label>Telefon<input name="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(q.phone || '')}"></label>
    <label>Firma (nepovinné)<input name="company" maxlength="160" autocomplete="organization" value="${esc(q.company || '')}"></label>
    <label>Heslo<input name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"><small class="muted">alespoň 8 znaků</small></label>
    <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--text2);margin-top:14px;white-space:nowrap"><input type="checkbox" name="gdpr" value="1" required style="width:auto;margin:0;flex:none"><span>Souhlasím se <a href="/gdpr" target="_blank">zpracováním osobních údajů</a></span></label>
    <button class="btn" type="submit">Vytvořit účet</button></form>
    <div class="acc-links"><a href="/cesta/prihlaseni">Už máte účet? Přihlaste se</a></div>`);

  async function sendVerify(acc, token) {
    await sendMail({ to: acc.email, subject: 'Potvrďte prosím svůj e-mail – Laundromats', body: 'Dobrý den,\n\nděkujeme za registraci na laundromats.eu. Pro dokončení potvrďte svůj e-mail kliknutím na tlačítko níže.\n\nPokud jste se neregistrovali, tento e-mail ignorujte.', link: PUBLIC_URL + '/cesta/overit?t=' + token, linkLabel: 'Potvrdit e-mail' });
  }
  const sentPage = (email) => box('Zkontrolujte e-mail', '', `<p>Na adresu <b>${esc(email)}</b> jsme poslali odkaz pro potvrzení účtu. Po kliknutí budete rovnou přihlášeni.</p><p class="small muted">E-mail nedorazil? Podívejte se do spamu, případně se zkuste <a href="/cesta/prihlaseni">přihlásit</a> – pošleme odkaz znovu.</p>`);

  // Ikony dlaždic — tenké linky (stroke), barva z gradientu v odznaku; ladí s logem a sítí v pozadí
  const SV = (d) => '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const IC = {
    podpora: SV('<path d="M20.5 11.5a8 8 0 0 1-11.6 7.2L3.5 20.5l1.8-4.9A8 8 0 1 1 20.5 11.5z"/><path d="M8.5 10.2h7M8.5 13.5h4.6"/>'),
    compounder: SV('<circle cx="12" cy="12" r="2.6"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="4.5" cy="18" r="1.8"/><circle cx="19.5" cy="18" r="1.8"/><path d="M6.1 7.1 9.9 10.4M17.9 7.1l-3.8 3.3M6.1 16.9l3.8-3.3M17.9 16.9l-3.8-3.3"/>'),
    pradlomaty: SV('<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M4 7h16"/><circle cx="7.3" cy="4.8" r=".5" fill="currentColor"/><circle cx="12" cy="14" r="4.6"/><path d="M8.6 14.6c1.2-1 2.2 1 3.4 0s2.2 1 3.4 0"/>'),
    ekonomika: SV('<path d="M3 3v18h18"/><path d="m6.5 15 4-4.5 3 3L20 6.5"/><path d="M15.5 6.5H20V11"/>'),
    hledat: SV('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 1.1-.3 2.2-.7 3.2"/><circle cx="12" cy="10" r="2.3"/><circle cx="17.6" cy="17.6" r="2.6"/><path d="m19.5 19.5 2 2"/>'),
    zhodnotit: SV('<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 13.5 4-4.5"/><circle cx="12" cy="13.5" r="1.4"/><path d="M8 21h8"/>'),
    sis: SV('<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8.5 20.5h7M12 17v3.5"/><path d="M6 12.2h2.2l1.6-3.4 2 5.4 1.7-3.6 1.2 1.6H18"/>'),
    // Marketplace: obchod (markýza) se špendlíkem lokality
    marketplace: SV('<path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M3.5 9.5c0 1.4 1.1 2.5 2.5 2.5S8.5 10.9 8.5 9.5c0 1.4 1.1 2.5 2.5 2.5h2c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5"/><path d="M5 12v7.5h6"/><path d="M19 12v1.5"/><path d="M17 21.5s-3.5-3-3.5-5.6a3.5 3.5 0 0 1 7 0c0 2.6-3.5 5.6-3.5 5.6z"/><circle cx="17" cy="15.9" r="1.1"/>'),
    pripojky: SV('<path d="M2.5 19.5h19"/><path d="M5.5 19.5v2M18.5 19.5v2"/><path d="M12 19.5v-6.2"/><circle cx="12" cy="10.8" r="2.5"/><path d="M12 8.3V5.4M9.5 10.8H6.8M14.5 10.8h2.7M10.3 4.2h3.4"/>'),
    hugo: SV('<rect x="4" y="7.5" width="16" height="12" rx="3.5"/><path d="M12 7.5V4M10.3 2.8h3.4"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M9.5 16.6h5"/><path d="M1.8 11.5v4M22.2 11.5v4"/>'),
    infolinka: SV('<path d="M4.5 13.5v-1.8a7.5 7.5 0 0 1 15 0v1.8"/><rect x="2.5" y="12.8" width="4" height="6" rx="1.8"/><rect x="17.5" y="12.8" width="4" height="6" rx="1.8"/><path d="M19.5 18.8v.7a2.5 2.5 0 0 1-2.5 2.5h-3"/>'),
    udrzba: SV('<circle cx="9" cy="9" r="3.2"/><path d="M9 5.8V3M9 15v-2.8M5.8 9H3M15 9h-2.8M6.7 6.7 5 5M13 13l-1.7-1.7M11.3 6.7 13 5M5 13l1.7-1.7"/><path d="M15.2 14.3a2.6 2.6 0 0 0 3.5 3.5l3 3-1.7 1.7-3-3a2.6 2.6 0 0 1-3.5-3.5z"/>'),
    tools: SV('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
    user: SV('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>'),
    logout: SV('<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>'),
  };
  const A = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async chyby → error handler (ne pád procesu)
  function mount(app) {
    app.get('/cesta/prihlaseni', (req, res) => { if (req.account) return res.redirect(302, safeNext(req.query.next)); send(req, res, 'Přihlášení', loginPage(req.query)); });
    app.post('/cesta/prihlaseni', urlenc, A(async (req, res) => {
      const b = req.body || {}; const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
      if (rateLimited('lgn:' + req.ip, 20, 900e3) || rateLimited('lgn:' + email, 8, 900e3)) return send(req, res, 'Přihlášení', loginPage(b, 'Příliš mnoho pokusů. Zkuste to prosím za 15 minut.'), 429);
      const r = await hos('POST', '/login', { email, password: String(b.password || '') });
      if (r.status === 403 && r.j.error === 'not_verified' && r.j.verify_token) {
        if (!rateLimited('vrf:' + email, 3, 3600e3)) sendVerify(r.j.account, r.j.verify_token).catch((e) => console.warn('[lm-acc] verify mail:', e.message));
        return send(req, res, 'Potvrďte e-mail', sentPage(email));
      }
      if (r.status !== 200 || !r.j.account) return send(req, res, 'Přihlášení', loginPage(b, r.j.error || 'Přihlášení se nepodařilo.'), r.status === 401 ? 401 : 400);
      setSession(req, res, r.j.account);
      linkAndTrack(req, r.j.account, 'account_login');
      res.redirect(302, safeNext(b.next));
    }));
    app.get('/cesta/registrace', (req, res) => { if (req.account) return res.redirect(302, '/cesta/ucet'); send(req, res, 'Registrace', regPage(req.query)); });
    app.post('/cesta/registrace', urlenc, A(async (req, res) => {
      const b = req.body || {};
      if (b.website) return send(req, res, 'Zkontrolujte e-mail', sentPage(String(b.email || '')));
      if (rateLimited('reg:' + req.ip, 6, 3600e3)) return send(req, res, 'Registrace', regPage(b, 'Příliš mnoho registrací z této sítě, zkuste to později.'), 429);
      if (!b.gdpr) return send(req, res, 'Registrace', regPage(b, 'Potvrďte prosím souhlas se zpracováním údajů.'), 400);
      const sid = (cookies(req).lm_sid || '');
      const r = await hos('POST', '/register', { name: b.name, email: b.email, phone: b.phone, company: b.company, password: b.password, sid });
      if (r.status !== 200 || !r.j.verify_token) return send(req, res, 'Registrace', regPage(b, r.j.error || 'Registrace se nepodařila.'), r.status >= 400 ? r.status : 400);
      try { await sendVerify(r.j.account, r.j.verify_token); } catch (e) { console.warn('[lm-acc] verify mail:', e.message); return send(req, res, 'Registrace', regPage(b, 'Účet je vytvořený, ale potvrzovací e-mail se nepodařilo odeslat. Zkuste se za chvíli přihlásit – pošleme ho znovu.'), 502); }
      send(req, res, 'Zkontrolujte e-mail', sentPage(r.j.account.email));
    }));
    app.get('/cesta/overit', A(async (req, res) => {
      if (rateLimited('vfy:' + req.ip, 30, 3600e3)) return send(req, res, 'Ověření', box('Ověření e-mailu', '', msgHtml('Příliš mnoho pokusů, zkuste to později.')), 429);
      const r = await hos('POST', '/verify', { token: String(req.query.t || '') });
      if (r.status !== 200 || !r.j.account) return send(req, res, 'Ověření', box('Ověření e-mailu', '', msgHtml(r.j.error || 'Odkaz je neplatný.') + '<div class="acc-links"><a href="/cesta/prihlaseni">Přihlásit se</a></div>'), 400);
      setSession(req, res, r.j.account);
      linkAndTrack(req, r.j.account, 'account_verified');
      res.redirect(302, '/cesta/ucet?vitejte=1');
    }));
    app.get('/cesta/zapomenute-heslo', (req, res) => send(req, res, 'Zapomenuté heslo', box('Zapomenuté heslo', 'Pošleme vám odkaz pro nastavení nového hesla.', `<form method="post" action="/cesta/zapomenute-heslo"><label>E-mail<input name="email" type="email" required maxlength="160" autocomplete="email"></label><button class="btn" type="submit">Poslat odkaz</button></form><div class="acc-links"><a href="/cesta/prihlaseni">← Zpět na přihlášení</a></div>`)));
    app.post('/cesta/zapomenute-heslo', urlenc, A(async (req, res) => {
      const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 160);
      const done = () => send(req, res, 'Zapomenuté heslo', box('Zkontrolujte e-mail', '', `<p>Pokud u nás účet s adresou <b>${esc(email)}</b> existuje, poslali jsme na ni odkaz pro nastavení nového hesla. Odkaz platí 1 hodinu.</p><div class="acc-links"><a href="/cesta/prihlaseni">← Zpět na přihlášení</a></div>`));
      if (rateLimited('rst:' + req.ip, 10, 3600e3) || rateLimited('rst:' + email, 3, 3600e3)) return done();
      const r = await hos('POST', '/reset-request', { email });
      if (r.status === 200 && r.j.token) sendMail({ to: r.j.account.email, subject: 'Nové heslo – Laundromats', body: 'Dobrý den,\n\npro nastavení nového hesla ke svému účtu na laundromats.eu klikněte na tlačítko níže. Odkaz platí 1 hodinu.\n\nPokud jste o změnu nežádali, tento e-mail ignorujte – heslo zůstane beze změny.', link: PUBLIC_URL + '/cesta/nove-heslo?t=' + r.j.token, linkLabel: 'Nastavit nové heslo' }).catch((e) => console.warn('[lm-acc] reset mail:', e.message));
      done();
    }));
    const newPwPage = (t, err) => box('Nové heslo', '', `${msgHtml(err)}<form method="post" action="/cesta/nove-heslo"><input type="hidden" name="t" value="${esc(t)}"><label>Nové heslo<input name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"><small class="muted">alespoň 8 znaků</small></label><button class="btn" type="submit">Uložit heslo a přihlásit</button></form>`);
    app.get('/cesta/nove-heslo', (req, res) => send(req, res, 'Nové heslo', newPwPage(String(req.query.t || '').slice(0, 100))));
    app.post('/cesta/nove-heslo', urlenc, A(async (req, res) => {
      const b = req.body || {}; const t = String(b.t || '').slice(0, 100);
      if (rateLimited('npw:' + req.ip, 10, 3600e3)) return send(req, res, 'Nové heslo', newPwPage(t, 'Příliš mnoho pokusů, zkuste to později.'), 429);
      const r = await hos('POST', '/reset', { token: t, password: String(b.password || '') });
      if (r.status !== 200 || !r.j.account) return send(req, res, 'Nové heslo', newPwPage(t, r.j.error || 'Heslo se nepodařilo uložit.'), 400);
      setSession(req, res, r.j.account);
      res.redirect(302, '/cesta/ucet/nastaveni?heslo=1');
    }));
    // Dokončení účtu založeného obchodem (odkaz na Ekonomiku z aplikace Obchodník): zákazník si jen nastaví heslo
    // Chybějící údaje (e-mail, telefon) si zákazník doplní rovnou tady — účet mu mohl
    // obchod založit i tehdy, když jsme na něj kontakt neměli. Co už vyplněné je,
    // ukážeme jen pro kontrolu a needitovatelně.
    const actPage = (t, info, err, b) => {
      b = b || {};
      const podtitul = (info.needs_email || info.needs_phone)
        ? 'Účet jsme vám připravili. Doplňte prosím chybějící údaje a nastavte si heslo — pak se vám rovnou otevře ekonomika prádlomatu.'
        : 'Účet jsme vám připravili, stačí si nastavit heslo. Pak se vám rovnou otevře ekonomika prádlomatu.';
      const poleEmail = info.needs_email
        ? `<label>E-mail (bude to vaše přihlašovací jméno)<input name="email" type="email" required maxlength="160" autocomplete="email" value="${esc(b.email || '')}"></label>`
        : `<label>E-mail (přihlašovací jméno)<input value="${esc(info.email)}" readonly style="opacity:.75"></label>`;
      const poleTelefon = info.needs_phone
        ? `<label>Telefon<input name="phone" type="tel" required maxlength="40" autocomplete="tel" value="${esc(b.phone || '')}"></label>`
        : '';
      const poleJmeno = info.needs_email
        ? `<label>Jméno a příjmení<input name="name" required maxlength="120" value="${esc(b.name != null ? b.name : (info.name || ''))}"></label>`
        : '';
      return box('Dokončete svůj účet', podtitul, `${msgHtml(err)}
      <form method="post" action="/cesta/aktivace"><input type="hidden" name="t" value="${esc(t)}">
      ${poleJmeno}${poleEmail}${poleTelefon}
      <label>Heslo<input name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"><small class="muted">alespoň 8 znaků</small></label>
      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--text2);margin-top:14px;white-space:nowrap"><input type="checkbox" name="gdpr" value="1" required style="width:auto;margin:0;flex:none"><span>Souhlasím se <a href="/gdpr" target="_blank">zpracováním osobních údajů</a></span></label>
      <button class="btn" type="submit">Nastavit heslo a otevřít ekonomiku</button></form>`);
    };
    const actUsed = () => box('Odkaz už byl použit', '', '<p>Účet je už dokončený, nebo odkaz vypršel. Přihlaste se svým e-mailem a heslem.</p><div class="acc-links"><a href="/cesta/prihlaseni?next=%2Fcesta%2Fucet%2Fekonomika">Přihlásit se →</a><a href="/cesta/zapomenute-heslo">Zapomenuté heslo</a></div>');
    app.get('/cesta/aktivace', A(async (req, res) => {
      const t = String(req.query.t || '').slice(0, 100);
      if (req.account) return res.redirect(302, '/cesta/ucet/ekonomika');
      const r = await hos('POST', '/setup-info', { token: t });
      if (r.status !== 200 || !r.j.ok) return send(req, res, 'Dokončení účtu', actUsed());
      send(req, res, 'Dokončení účtu', actPage(t, r.j));
    }));
    app.post('/cesta/aktivace', urlenc, A(async (req, res) => {
      const b = req.body || {}; const t = String(b.t || '').slice(0, 100);
      if (rateLimited('act:' + req.ip, 10, 3600e3)) return send(req, res, 'Dokončení účtu', box('Dokončení účtu', '', msgHtml('Příliš mnoho pokusů, zkuste to později.')), 429);
      const info = await hos('POST', '/setup-info', { token: t });
      if (info.status !== 200 || !info.j.ok) return send(req, res, 'Dokončení účtu', actUsed());
      if (!b.gdpr) return send(req, res, 'Dokončení účtu', actPage(t, info.j, 'Potvrďte prosím souhlas se zpracováním údajů.', b), 400);
      const r = await hos('POST', '/setup-complete', { token: t, password: String(b.password || ''), email: b.email, phone: b.phone, name: b.name });
      if (r.status !== 200 || !r.j.account) return send(req, res, 'Dokončení účtu', actPage(t, info.j, r.j.error || 'Účet se nepodařilo dokončit.', b), 400);
      setSession(req, res, r.j.account);
      linkAndTrack(req, r.j.account, 'account_activated');
      res.redirect(302, '/cesta/ucet/ekonomika?vitejte=1');
    }));
    const logout = (req, res) => { if (req.account && ctx.trackServer) ctx.trackServer(req, 'account_logout', {}); clearSession(req, res); res.redirect(302, '/'); };
    app.get('/cesta/odhlasit', logout); app.post('/cesta/odhlasit', logout);

    // Můj účet = rozcestník nástrojů + údaje + změna hesla
    const TILES = [
      ['/cesta/podpora', 'podpora', 'Podpora Laundromats', 'Máte dotaz? Napište nám do chatu — odpovíme co nejdříve.'],
      ['/cesta/compounder', 'compounder', 'Compounder', 'Jak roste síť prádlomatů a co znamená pro vaše podnikání.'],
      ['/cesta/pradlomaty', 'pradlomaty', 'Prádlomaty', 'Nabídka strojů a služby kolem nich.'],
      ['', 'sis', 'SIS', 'Systém inteligentní správy v reálném čase: kompletní správa strojů, statistiky, doporučení, účetní exporty i API napojení na váš systém.', true],
      ['/cesta/ucet/ekonomika', 'ekonomika', 'Ekonomika', 'Kalkulačka: vymodelujte si vlastní představu – investici, obrat i návratnost.'],
      ['/cesta/hledat', 'hledat', 'Najít místo', 'Spádová oblast, kapacita a provozované prádlomaty v okolí.'],
      ['/cesta/zhodnotit', 'zhodnotit', 'Zhodnotit místo', 'Orientační ekonomika vašeho konkrétního místa.'],
      // Chystané nástroje — pátý prvek `true` = dlaždice je zamčená vždy (i pro správce z HolyOS),
      // protože v Laundromats zatím žádnou takovou stránku nemáme. Klik nabídne online schůzku jako u ostatních.
      ['', 'hugo', 'HUGO', 'AI servisní asistent s chytrým e-shopem.', true],
      ['', 'infolinka', 'Infolinka', 'Řízení infolinky: AI zpracování požadavku, delegování a řízení servisních požadavků.', true],
      ['', 'udrzba', 'Údržba', 'Řízení údržbového plánu, intervalů, odečtů a personální řízení údržby.', true],
      ['', 'pripojky', 'Přípojky', 'Odhad ceny přípojek a přesný postup při jejich zadání i realizaci.', true],
      ['', 'marketplace', 'Marketplace lokalit', 'Připravená a předjednaná místa pro prádlomat — vyberte si lokalitu a jděte rovnou do realizace.', true],
    ];
    app.get('/cesta/ucet', requireAccount, A(async (req, res) => {
      const supUnread = req.account && supportUnread ? await supportUnread(req.account.id) : 0;
      const a = req.account || { name: (adminOf(req) || {}).name || 'Správce', email: '' };
      const welcome = req.query.vitejte === '1' ? 'Účet je potvrzený. Vítejte!' : '';
      const err = String(req.query.err || '').slice(0, 200);
      const body = CSS + `<div class="hero" style="padding-bottom:6px"><span class="eyebrow"><i></i>Moje nástroje</span><h1>Dobrý den, <span class="g">${esc(String(a.name).split(/\s+/)[0])}</span></h1><p>Vaše nástroje Laundromats na jednom místě.</p></div>${msgHtml(err, welcome)}
        <div class="acc-tiles">${TILES.map(([h, i, t, d, lock]) => (!lock && (!req.account || canSee(req, i)))
          ? `<a class="card acc-tile" href="${h}"><div class="ic">${IC[i]}</div>${i === 'podpora' && supUnread ? `<span class="acc-badge" title="Nepřečtené odpovědi">${supUnread}</span>` : ''}<h3>${t}</h3><p>${d}</p></a>`
          : `<button type="button" class="card acc-tile acc-lock" data-lock="${esc(t)}"><div class="ic">${IC[i]}</div><span class="acc-lk" title="Zatím uzamčeno">🔒</span><h3>${t}</h3><p>${d}</p></button>`).join('')}</div>
        <div class="acc-ov" id="acc-ov" hidden><div class="card acc-ovc"><button type="button" class="acc-x" aria-label="Zavřít">×</button><div class="ic" style="margin:0 auto 12px">${IC.user}</div>
          <h2 style="margin:0 0 6px"><span id="acc-ovt"></span> odemkneme na online schůzce</h2>
          <p class="muted" style="margin:0 0 16px">Tento nástroj zpřístupňujeme po krátké online schůzce, na které spolu projdeme váš záměr. Vyberte si termín, který vám vyhovuje — trvá zhruba 17 minut.</p>
          <a class="btn" href="/cesta/schuzka" style="width:100%;justify-content:center">📅 Domluvit online schůzku</a></div></div>
        <script>(function(){var ov=document.getElementById('acc-ov'),t=document.getElementById('acc-ovt');if(!ov)return;
          document.querySelectorAll('.acc-lock').forEach(function(b){b.addEventListener('click',function(){t.textContent=b.getAttribute('data-lock');ov.hidden=false;try{if(window.lmTrack)lmTrack('locked_tile',{tile:b.getAttribute('data-lock')});}catch(e){}});});
          function cl(){ov.hidden=true;}ov.addEventListener('click',function(e){if(e.target===ov||e.target.closest('.acc-x'))cl();});document.addEventListener('keydown',function(e){if(e.key==='Escape')cl();});})();</script>
`;
      send(req, res, 'Moje nástroje', body, 200, { back: false });
    }));
    // Můj účet = údaje, změna hesla, odhlášení (z tlačítka 👤 v liště)
    app.get('/cesta/ucet/nastaveni', requireAccount, (req, res) => {
      const a = req.account || { name: (adminOf(req) || {}).name || 'Správce', email: '' };
      const welcome = req.query.heslo === '1' ? 'Heslo bylo změněno.' : req.query.ok === '1' ? 'Uloženo.' : '';
      const err = String(req.query.err || '').slice(0, 200);
      const body = CSS + `<div class="hero" style="padding-bottom:6px"><span class="eyebrow"><i></i>Můj účet</span><h1>${esc(a.name)}</h1><p>${esc(a.email || 'Správce přihlášený z HolyOS')}</p></div>${msgHtml(err, welcome)}
        ${req.account ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:10px">
          <form class="card" method="post" action="/cesta/ucet/profil" style="margin:0"><h2 style="margin:0 0 4px">Moje údaje</h2><p class="small muted" style="margin:0">${a.email ? esc(a.email) : 'Účet zatím nemá e-mail'}</p>
            <label>Jméno a příjmení<input name="name" required maxlength="120" value="${esc(a.name)}"></label><label>Telefon<input name="phone" maxlength="40" value="${esc(a.phone || '')}"></label><label>Firma<input name="company" maxlength="160" value="${esc(a.company || '')}"></label>
            <div style="margin-top:14px"><button class="btn sec" type="submit">Uložit údaje</button></div></form>
          <form class="card" method="post" action="/cesta/ucet/heslo" style="margin:0"><h2 style="margin:0 0 4px">Změna hesla</h2><p class="small muted" style="margin:0">Po změně se odhlásí ostatní zařízení.</p>
            <label>Současné heslo<input name="old" type="password" required maxlength="200" autocomplete="current-password"></label><label>Nové heslo<input name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>
            <div class="row" style="margin-top:14px;gap:10px;justify-content:space-between;flex-wrap:wrap"><button class="btn sec" type="submit">Změnit heslo</button></div></form>
        </div>` : ''}
        <form method="post" action="/cesta/odhlasit" style="margin-top:18px"><button class="btn sec sm" type="submit">Odhlásit se</button></form>`;
      send(req, res, 'Můj účet', body);
    });
    app.post('/cesta/ucet/profil', urlenc, A(async (req, res) => {
      if (!req.account) return res.redirect(302, '/cesta/prihlaseni');
      const r = await hos('POST', '/' + req.account.id + '/profile', req.body || {});
      if (r.status === 200 && r.j.account) cache.set(req.account.id, { at: Date.now(), account: r.j.account });
      res.redirect(302, '/cesta/ucet/nastaveni?' + (r.status === 200 ? 'ok=1' : 'err=' + encodeURIComponent(r.j.error || 'Uložení se nepodařilo.')));
    }));
    app.post('/cesta/ucet/heslo', urlenc, A(async (req, res) => {
      if (!req.account) return res.redirect(302, '/cesta/prihlaseni');
      if (rateLimited('chpw:' + req.account.id, 8, 3600e3)) return res.redirect(302, '/cesta/ucet/nastaveni?err=' + encodeURIComponent('Příliš mnoho pokusů, zkuste to později.'));
      const r = await hos('POST', '/' + req.account.id + '/password', { old: (req.body || {}).old, password: (req.body || {}).password });
      if (r.status !== 200 || !r.j.account) return res.redirect(302, '/cesta/ucet/nastaveni?err=' + encodeURIComponent(r.j.error || 'Heslo se nepodařilo změnit.'));
      setSession(req, res, r.j.account);
      res.redirect(302, '/cesta/ucet/nastaveni?heslo=1');
    }));
  }
  // Odkazy účtu do horní lišty (slot <!--LACC-->)
  function headerSlot(req) {
    if (req && req.account) return '<details class="lmenu"><summary class="lacc" title="Můj účet">' + IC.user + ' ' + esc(String(req.account.name || 'Účet').split(/\s+/)[0]) + ' ▾</summary><div class="lmenu-b">'
      + '<div class="lmenu-h"><b>' + esc(req.account.name || '') + '</b><span>' + esc(req.account.email || '') + '</span></div>'
      + '<a href="/cesta/ucet">' + IC.tools + 'Moje nástroje</a><a href="/cesta/ucet/nastaveni">' + IC.user + 'Můj účet</a><form method="post" action="/cesta/odhlasit"><button type="submit">' + IC.logout + 'Odhlásit se</button></form></div></details>'
      + '<script>document.addEventListener("click",function(e){document.querySelectorAll("details.lmenu[open]").forEach(function(d){if(!d.contains(e.target))d.removeAttribute("open");});});</script>';
    return '<a class="lcta" href="/cesta/prihlaseni">Přihlásit se</a>';
  }
  const attach = (req, res, next) => attachInner(req, res, next).catch((e) => { console.warn('[lm-acc] relace:', e.message); req.account = null; next(); });
  let supportUnread = null; const setSupportUnread = (fn) => { supportUnread = fn; };
  return { attach, requireAccount, requirePage, canSee, ROLES, mount, headerSlot, setSupportUnread };
};
