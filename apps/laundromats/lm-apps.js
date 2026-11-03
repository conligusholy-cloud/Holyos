// Laundromats — aplikace lokalit: Najít místo (/cesta/hledat) a Zhodnotit místo (/cesta/zhodnotit).
// Přístup řídí env LM_APPS_ACCESS:
//   open   = volně pro všechny
//   code   = (výchozí) jen s přístupovým kódem z LM_APPS_CODES (čárkami oddělené); bez kódu formulář „Požádat o přístup"
//   closed = jen formulář „Požádat o přístup" (a správci přihlášení z HolyOS)
// Připraveno na placený přístup: kód lze později vydávat po zaplacení.
'use strict';
const crypto = require('crypto');
const LAPP = require('./lm-location-app');
const { layout, esc, MAIN_URL } = require('./lm-layout');

const mode = () => { const m = String(process.env.LM_APPS_ACCESS || 'code').toLowerCase(); return ['open', 'code', 'closed'].includes(m) ? m : 'code'; };
const codes = () => String(process.env.LM_APPS_CODES || '').split(',').map((s) => s.trim()).filter((s) => s.length >= 4);
const ACK = 'lm_apps';
const sign = (secret, code) => crypto.createHmac('sha256', secret || 'lm-apps').update('apps:' + code).digest('hex').slice(0, 32);

module.exports = function mountApps(app, ctx) {
  const { HOLYOS_URL, LM_SECRET, rateLimited, cookies, adminOf, ckDomain, fetchProducts } = ctx;
  const hasAccess = (req) => {
    if (mode() === 'open') return true;
    if (adminOf(req)) return true;
    if (mode() === 'closed') return false;
    const v = cookies(req)[ACK] || '';
    return !!v && codes().some((c) => sign(LM_SECRET, c) === v);
  };
  const gate = (req, res, next) => {
    if (hasAccess(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Aplikace je dostupná jen s přístupem.' });
    res.status(200).set('Cache-Control', 'no-store').type('html').send(accessPage(req.originalUrl, ''));
  };
  function accessPage(back, err) {
    const showCode = mode() === 'code' && codes().length > 0;
    const body = `<div class="hero"><span class="eyebrow"><i></i>Aplikace Laundromats</span><h1><span class="g">Najít místo</span> a <span class="g">zhodnotit místo</span></h1>
    <p>Naše aplikace pro výběr lokality: spádová oblast 15 km, odhad kapacity, provozované prádlomaty v okolí, tipy na konkrétní místa a orientační ekonomika vybraného místa. Přístup otevíráme po domluvě.</p></div>
    ${err ? `<div class="msg err">${esc(err)}</div>` : ''}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
      <form class="card" id="acc-req" style="margin:0"><h2 style="margin:0 0 6px">Požádat o přístup</h2><p class="muted small" style="margin:0 0 10px">Ozveme se vám a přístup domluvíme.</p>
        <label>Jméno<input name="name" required maxlength="120" autocomplete="name"></label>
        <label>E-mail<input name="email" type="email" required maxlength="160" autocomplete="email"></label>
        <label>Telefon<input name="phone" required maxlength="40" autocomplete="tel"></label>
        <label>Kde hledáte místo?<input name="place" required maxlength="160" placeholder="např. Tábor"></label>
        <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <div class="row" style="margin-top:12px;gap:10px;align-items:center"><button class="btn" type="submit">Odeslat žádost</button><span class="small muted" id="acc-st"></span></div>
        <p class="small muted" style="margin:10px 0 0">Odesláním souhlasíte se zpracováním údajů pro vyřízení žádosti (<a href="${MAIN_URL()}/gdpr">ochrana osobních údajů</a>).</p></form>
      ${showCode ? `<form class="card" method="post" action="/cesta/pristup" style="margin:0;align-self:start"><h2 style="margin:0 0 6px">Mám přístupový kód</h2>
        <input type="hidden" name="back" value="${esc(back || '/cesta/hledat')}"><label>Kód<input name="code" required maxlength="80" autocomplete="off"></label>
        <div style="margin-top:12px"><button class="btn sec" type="submit">Vstoupit</button></div></form>` : ''}
    </div>
    <script>(function(){var f=document.getElementById('acc-req'),st=document.getElementById('acc-st');f.addEventListener('submit',function(e){e.preventDefault();var d={};new FormData(f).forEach(function(v,k){d[k]=v;});d.interest='apps';d.note='Žádost o přístup k aplikacím Najít místo / Zhodnotit místo';var b=f.querySelector('button');b.disabled=true;st.textContent='Odesílám…';
      fetch('/api/inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok&&j.ok,j:j};});}).then(function(x){if(x.ok){f.innerHTML='<h2 style="margin:0 0 6px">Děkujeme</h2><p class="muted" style="margin:0">Žádost jsme přijali, brzy se vám ozveme.</p>';}else{b.disabled=false;st.textContent=(x.j&&x.j.error)||'Odeslání se nepodařilo.';}}).catch(function(){b.disabled=false;st.textContent='Chyba spojení.';});});})();</script>`;
    return layout({ title: 'Aplikace lokalit', body, active: 'hledat' });
  }
  const urlenc = require('express').urlencoded({ extended: false, limit: '60kb' });
  app.post('/cesta/pristup', urlenc, (req, res) => {
    if (rateLimited('acc:' + req.ip, 10, 3600e3)) return res.status(429).type('html').send(accessPage('/cesta/hledat', 'Příliš mnoho pokusů, zkuste to později.'));
    const code = String((req.body || {}).code || '').trim();
    const back = /^\/cesta\/(hledat|zhodnotit)/.test(String((req.body || {}).back || '')) ? req.body.back : '/cesta/hledat';
    if (mode() !== 'code' || !codes().includes(code)) return res.status(200).type('html').send(accessPage(back, 'Kód není platný.'));
    res.append('Set-Cookie', ACK + '=' + sign(LM_SECRET, code) + '; Path=/; Max-Age=' + 30 * 86400 + '; HttpOnly; Secure; SameSite=Lax' + ckDomain(req));
    res.redirect(302, back);
  });

  // ── Najít místo ──
  const S = { nick: '' };
  app.get('/cesta/hledat', gate, (req, res) => res.set('Cache-Control', 'no-store').type('html').send(LAPP.analyzerPage(S, String(req.query.q || '').slice(0, 80), null, '')));
  // ── Zhodnotit místo (výpočet bez ukládání) ──
  async function products() {
    try { return (await fetchProducts()).map((p) => ({ id: p.id, name: p.name_cs, price_czk: p.price_czk })).filter((p) => p.price_czk > 0); } catch (e) { return []; }
  }
  app.get('/cesta/zhodnotit', gate, async (req, res, next) => {
    try {
      const pre = { city: String(req.query.city || '').slice(0, 120), address: String(req.query.address || '').slice(0, 300) };
      if (isFinite(+req.query.lat) && isFinite(+req.query.lng) && +req.query.lat) { pre.lat = String(+req.query.lat); pre.lng = String(+req.query.lng); if (pre.address) pre.name = pre.address; }
      res.set('Cache-Control', 'no-store').type('html').send(LAPP.siteForm(S, null, pre, '', false, false, await products()));
    } catch (e) { next(e); }
  });
  app.post('/cesta/zhodnotit', gate, urlenc, async (req, res, next) => {
    try {
      if (rateLimited('eval:' + req.ip, 30, 3600e3)) return res.status(429).type('text/plain').send('Příliš mnoho vyhodnocení, zkuste to později.');
      const d = LAPP.clean(req.body || {});
      if (!d.name || !d.address) return res.status(400).type('html').send(LAPP.siteForm(S, null, d, 'Vyplňte název a adresu místa.', false, false, await products()));
      const c = LAPP.calc(d), ev = LAPP.evaluate(d, c);
      res.set('Cache-Control', 'no-store').type('html').send(reportPage(d, c, ev));
    } catch (e) { next(e); }
  });
  function reportPage(d, c, ev) {
    const R = LAPP.reportSections({ name: d.name }, d, c, ev);
    // „Upravit údaje" = stejné údaje zpět do formuláře (nic se neukládá na server)
    const hidden = Object.keys(d).map((k) => `<input type="hidden" name="${esc(k)}" value="${esc(d[k])}">`).join('');
    const body = `<div class="row no-print" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><a class="btn sec sm" href="/cesta/hledat">← Najít místo</a><div class="row" style="gap:8px">
      <form method="post" action="/cesta/zhodnotit/upravit" style="margin:0">${hidden}<button class="btn sec sm" type="submit">Upravit údaje</button></form><button class="btn sm" type="button" onclick="window.print()">🖨️ Uložit do PDF</button></div></div>
    <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><div class="small muted">Orientační vyhodnocení místa · ${new Date().toLocaleDateString('cs-CZ')}</div><h1 style="margin:2px 0 4px">${esc(d.name)}</h1><div class="muted">${esc(d.address || '')}</div></div><span class="res ${ev.cls}">${esc(ev.result)}</span></div>
    <p class="small muted" style="margin:10px 0 0">Výpočet je orientační a vychází jen ze zadaných údajů a modelových předpokladů. Podrobnou studii místa s námi můžete probrat.</p></div>
    ${R.map}${R.scenarios}${R.facts}
    <div class="lm-cta no-print"><div><h3>Chcete místo probrat s námi?</h3><p>Projdeme vyhodnocení, doplníme zkušenosti z provozu a navrhneme další postup.</p></div><a class="btn" href="${MAIN_URL()}${process.env.LM_HOME_LIVE === '1' ? '/' : '/uvod'}#kontakt">Probrat můj záměr →</a></div>`;
    return LAPP.page(S, 'Vyhodnocení – ' + (d.name || ''), 'loc', body, (d.lat && d.lng) ? LAPP.LEAFLET_HEAD : '');
  }
  app.post('/cesta/zhodnotit/upravit', gate, urlenc, async (req, res, next) => {
    try { res.set('Cache-Control', 'no-store').type('html').send(LAPP.siteForm(S, null, LAPP.clean(req.body || {}), '', false, false, await products())); } catch (e) { next(e); }
  });

  // ── API pro aplikace: proxy na veřejné API HolyOS (bez ukládání), limity per IP ──
  async function holyosPublic(p) { try { const r = await fetch(HOLYOS_URL + p, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; } catch (e) { return { ok: false, status: 502, j: { error: 'Analýza momentálně není dostupná, zkuste to prosím později.' } }; } }
  const send = (res, r) => res.status(r.ok ? 200 : (r.status || 502)).json(r.j);
  app.get('/api/location/area', gate, async (req, res) => {
    const area = String(req.query.area || '').trim().slice(0, 80); if (area.length < 2) return res.status(400).json({ error: 'Zadejte město.' });
    if (rateLimited('area:' + req.ip, 30, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho analýz, zkuste to za chvíli.' });
    send(res, await holyosPublic('/api/pradlomat-spots/public/area-analysis?area=' + encodeURIComponent(area) + '&radius_km=15'));
  });
  app.get('/api/location/candidates', gate, async (req, res) => {
    const area = String(req.query.area || '').trim().slice(0, 80); if (area.length < 2) return res.status(400).json({ error: 'Zadejte město.' });
    if (rateLimited('cand:' + req.ip, 30, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho dotazů, zkuste to za chvíli.' });
    const r = await holyosPublic('/api/pradlomat-spots/public/candidates?area=' + encodeURIComponent(area));
    if (r.ok && r.j && typeof r.j === 'object') r.j.contacts = r.j.contacts || {};
    send(res, r);
  });
  app.get('/api/location/contact', gate, async (req, res) => {
    const name = String(req.query.name || '').trim().slice(0, 120); if (name.length < 2) return res.status(400).json({ error: 'Chybí název místa.' });
    if (rateLimited('contact:' + req.ip, 15, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho dotazů, zkuste to za chvíli.' });
    const qs = ['name', 'city', 'lat', 'lon', 'kind', 'address'].filter((k) => req.query[k]).map((k) => k + '=' + encodeURIComponent(String(req.query[k]).slice(0, 200))).join('&');
    send(res, await holyosPublic('/api/pradlomat-spots/public/contact?' + qs));
  });
  let _ex = { at: 0, data: [] };
  app.get('/api/location/existing', gate, async (req, res) => {
    if (Date.now() - _ex.at > 3600e3) { const r = await holyosPublic('/api/pradlomat-spots/public/existing-laundromats'); if (r.ok && Array.isArray(r.j)) _ex = { at: Date.now(), data: r.j }; }
    res.json(_ex.data);
  });
  // Geokódování: RÚIAN (ČÚZK) → Nominatim (záloha)
  app.get('/api/location/geocode', gate, async (req, res) => {
    const addr = String(req.query.address || req.query.q || '').trim().slice(0, 200), city = String(req.query.city || '').trim().slice(0, 100);
    if (addr.length < 2 && city.length < 2) return res.status(400).json({ error: 'Zadejte adresu.' });
    if (rateLimited('geo:' + req.ip, 60, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho dotazů, zkuste to za chvíli.' });
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    try {
      const q1 = [addr, city].filter(Boolean).join(', ');
      const r = await fetch('https://ags.cuzk.cz/arcgis/rest/services/RUIAN/Vyhledavaci_sluzba_nad_daty_RUIAN/MapServer/exts/GeocodeSOE/findAddressCandidates?outSR=4326&maxLocations=10&f=json&SingleLine=' + encodeURIComponent(q1), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      const j = await r.json().catch(() => ({}));
      let cands = Array.isArray(j.candidates) ? j.candidates : [];
      if (cands.length) {
        const cn = norm(city);
        const score = (c) => ((c.attributes && c.attributes.Type) === 'AdresniMisto' ? 2 : 0) + (cn && norm(c.address).includes(cn) ? 4 : 0) + (cn && norm(c.address).endsWith(cn) ? 1 : 0);
        cands = cands.map((c) => ({ lat: c.location.y, lon: c.location.x, display_name: c.address, s: score(c) })).sort((a, b) => b.s - a.s).slice(0, 8);
        const best = cands[0];
        return res.json({ lat: best.lat, lon: best.lon, display_name: best.display_name, level: 'exact', source: 'RÚIAN', candidates: cands.map(({ lat, lon, display_name }) => ({ lat, lon, display_name })) });
      }
    } catch (e) { /* RÚIAN nedostupný → Nominatim */ }
    const H = { 'User-Agent': 'Laundromats/1.0 (+https://laundromats.eu)', Accept: 'application/json', 'Accept-Language': 'cs' };
    async function nom(params) { try { const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,sk&' + params, { headers: H, signal: AbortSignal.timeout(9000) }); const j = await r.json().catch(() => []); return Array.isArray(j) && j.length ? j[0] : null; } catch (e) { return null; } }
    const tries = [];
    if (addr) tries.push(['exact', 'q=' + encodeURIComponent([addr, city].filter(Boolean).join(', '))]);
    if (city) tries.push(['town', 'city=' + encodeURIComponent(city)]);
    for (const [level, params] of tries) { const x = await nom(params); if (x) return res.json({ lat: parseFloat(x.lat), lon: parseFloat(x.lon), display_name: x.display_name, level, source: 'OSM' }); await new Promise((r) => setTimeout(r, 1100)); }
    res.json({ error: 'Adresa nenalezena – přibližte mapu a klikněte na místo ručně.' });
  });
};
