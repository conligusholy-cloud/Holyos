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
  function requireAccount(req, res, next) {
    if (req.account || adminOf(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Přihlaste se prosím.' });
    res.redirect(302, '/cesta/prihlaseni?next=' + encodeURIComponent(req.originalUrl));
  }

  // ── stránky ──
  const CSS = `<style>.acc-box{max-width:460px;margin:30px auto 0}.acc-box h1{margin:0 0 6px;font-size:30px}.acc-box label{display:block;margin-top:12px}.acc-box .btn{width:100%;margin-top:18px;justify-content:center}
  .acc-links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:14px}.acc-links a{color:var(--accent2)}
  .acc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:18px}.acc-tile{display:block;text-decoration:none;color:inherit;margin:0;transition:transform .15s,border-color .15s}.acc-tile:hover{transform:translateY(-2px);border-color:rgba(79,209,255,.45)}.acc-tile .ic{font-size:26px}.acc-tile h3{margin:8px 0 4px}.acc-tile p{margin:0;color:var(--text2);font-size:14px}</style>`;
  const box = (title, sub, inner) => CSS + `<div class="card acc-box"><h1>${title}</h1>${sub ? `<p class="muted" style="margin:0 0 6px">${sub}</p>` : ''}${inner}</div>`;
  const msgHtml = (err, ok) => (err ? `<div class="msg err">${esc(err)}</div>` : '') + (ok ? `<div class="msg ok">${esc(ok)}</div>` : '');
  const urlenc = require('express').urlencoded({ extended: false, limit: '20kb' });
  const send = (req, res, title, body, code) => res.status(code || 200).set('Cache-Control', 'no-store').type('html').send(ctx.render(req, layout({ title, body })));

  const loginPage = (q, err, ok) => box('Přihlášení', 'Do prostředí Laundromats: Compounder, Prádlomaty, Ekonomika, Najít místo a Zhodnotit místo.', `${msgHtml(err, ok)}
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
    <label style="display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:var(--text2)"><input type="checkbox" name="gdpr" value="1" required style="width:auto;margin-top:3px"> Souhlasím se zpracováním osobních údajů (<a href="/gdpr" target="_blank">ochrana osobních údajů</a>).</label>
    <button class="btn" type="submit">Vytvořit účet</button></form>
    <div class="acc-links"><a href="/cesta/prihlaseni">Už máte účet? Přihlaste se</a></div>`);

  async function sendVerify(acc, token) {
    await sendMail({ to: acc.email, subject: 'Potvrďte prosím svůj e-mail – Laundromats', body: 'Dobrý den,\n\nděkujeme za registraci na laundromats.eu. Pro dokončení potvrďte svůj e-mail kliknutím na tlačítko níže.\n\nPokud jste se neregistrovali, tento e-mail ignorujte.', link: PUBLIC_URL + '/cesta/overit?t=' + token, linkLabel: 'Potvrdit e-mail' });
  }
  const sentPage = (email) => box('Zkontrolujte e-mail', '', `<p>Na adresu <b>${esc(email)}</b> jsme poslali odkaz pro potvrzení účtu. Po kliknutí budete rovnou přihlášeni.</p><p class="small muted">E-mail nedorazil? Podívejte se do spamu, případně se zkuste <a href="/cesta/prihlaseni">přihlásit</a> – pošleme odkaz znovu.</p>`);

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
      res.redirect(302, '/cesta/ucet?heslo=1');
    }));
    const logout = (req, res) => { clearSession(req, res); res.redirect(302, '/'); };
    app.get('/cesta/odhlasit', logout); app.post('/cesta/odhlasit', logout);

    // Můj účet = rozcestník nástrojů + údaje + změna hesla
    const TILES = [
      ['/cesta/compounder', '🧩', 'Compounder', 'Jak roste síť prádlomatů a co znamená pro vaše podnikání.'],
      ['/cesta/pradlomaty', '🧺', 'Prádlomaty', 'Nabídka strojů a služby kolem nich.'],
      ['/cesta/ucet/ekonomika', '📈', 'Ekonomika', 'Živý model: investice, obrat, zisk a návratnost.'],
      ['/cesta/hledat', '🔎', 'Najít místo', 'Spádová oblast, kapacita a provozované prádlomaty v okolí.'],
      ['/cesta/zhodnotit', '🧠', 'Zhodnotit místo', 'Orientační ekonomika vašeho konkrétního místa.'],
    ];
    app.get('/cesta/ucet', requireAccount, (req, res) => {
      const a = req.account || { name: (adminOf(req) || {}).name || 'Správce', email: '' };
      const welcome = req.query.vitejte === '1' ? 'Účet je potvrzený. Vítejte!' : req.query.heslo === '1' ? 'Heslo bylo změněno.' : req.query.ok === '1' ? 'Uloženo.' : '';
      const err = String(req.query.err || '').slice(0, 200);
      const body = CSS + `<div class="hero" style="padding-bottom:6px"><span class="eyebrow"><i></i>Můj účet</span><h1>Dobrý den, <span class="g">${esc(String(a.name).split(/\s+/)[0])}</span></h1><p>Vaše nástroje Laundromats na jednom místě.</p></div>${msgHtml(err, welcome)}
        <div class="acc-tiles">${TILES.map(([h, i, t, d]) => `<a class="card acc-tile" href="${h}"><div class="ic">${i}</div><h3>${t}</h3><p>${d}</p></a>`).join('')}</div>
        ${req.account ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:22px">
          <form class="card" method="post" action="/cesta/ucet/profil" style="margin:0"><h2 style="margin:0 0 4px">Moje údaje</h2><p class="small muted" style="margin:0">${esc(a.email)}</p>
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
      res.redirect(302, '/cesta/ucet?' + (r.status === 200 ? 'ok=1' : 'err=' + encodeURIComponent(r.j.error || 'Uložení se nepodařilo.')));
    }));
    app.post('/cesta/ucet/heslo', urlenc, A(async (req, res) => {
      if (!req.account) return res.redirect(302, '/cesta/prihlaseni');
      if (rateLimited('chpw:' + req.account.id, 8, 3600e3)) return res.redirect(302, '/cesta/ucet?err=' + encodeURIComponent('Příliš mnoho pokusů, zkuste to později.'));
      const r = await hos('POST', '/' + req.account.id + '/password', { old: (req.body || {}).old, password: (req.body || {}).password });
      if (r.status !== 200 || !r.j.account) return res.redirect(302, '/cesta/ucet?err=' + encodeURIComponent(r.j.error || 'Heslo se nepodařilo změnit.'));
      setSession(req, res, r.j.account);
      res.redirect(302, '/cesta/ucet?heslo=1');
    }));
  }
  // Odkazy účtu do horní lišty (slot <!--LACC-->)
  function headerSlot(req) {
    if (req && req.account) return '<a class="lacc" href="/cesta/ucet" title="Můj účet">👤 ' + esc(String(req.account.name || 'Účet').split(/\s+/)[0]) + '</a>';
    return '<a class="lcta" href="/cesta/prihlaseni">Přihlásit se</a>';
  }
  const attach = (req, res, next) => attachInner(req, res, next).catch((e) => { console.warn('[lm-acc] relace:', e.message); req.account = null; next(); });
  return { attach, requireAccount, mount, headerSlot };
};
