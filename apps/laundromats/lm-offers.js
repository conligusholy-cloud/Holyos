// Laundromats — Nabídky korporátům (obchodní návrhy). Data žijí v HolyOS (/api/auth/lm/offers, AppSetting
// lm_corp_offers). Administrace: /admin/meetings → záložka 🤝 Korporáty (vytvořit, náhled, odeslat e-mailem).
// Korporát dostane e-mail s odkazem na webovou nabídku laundromats.eu/nabidka/<token> (CZ / EN / PL, Kč / EUR);
// otevření i „Mám zájem" se evidují a zájem chodí pushem do Velína.
'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const { layout, esc } = require('./lm-layout');

// ── Šablony (výchozí text návrhu; v administraci jde vše přepsat) ──
const TPL = {
  cs: {
    subject: (f) => `Obchodní návrh Laundromats.eu pro ${f.company}`,
    title: (f) => `Samoobslužné prádelny pod značkou ${f.company}`,
    intro: (f) => `Dobrý den,

na základě dnešního telefonátu s centrálou ${f.company} Vám posílám obchodní návrh s prosbou o předání ${f.handover || 'osobě, která má na starosti strategii a rozvoj nových formátů prodejen'}${f.handover ? ', případně osobě, která má na starosti strategii a rozvoj nových formátů prodejen' : ''}.

Projekt Laundromats.eu nabízí možnost rozšířit služby zákazníkům ${f.company} o samoobslužné prádelny u vybraných prodejen. Navrhujeme, aby ${f.company} prádlomaty koupil do svého vlastnictví a provozoval je pod vlastní značkou. Laundromats.eu může zajistit dodání, instalaci, servis i provozní podporu.

Nejde o nabídku pronájmu plochy. Rád bych představil investiční a provozní model a navrhl pilot na několika vhodných lokalitách. Pokud tuto oblast řeší někdo jiný, budu vděčný za předání správné osobě.

Bylo by možné domluvit krátkou dvacetiminutovou schůzku?

S pozdravem
${f.sender || 'Tomáš Holý'}
Laundromats.eu`,
    points: (f) => [
      `Pilot na 3 vybraných prodejnách — výběr lokalit podle dat (návštěvnost, okolí, konkurence) připravíme zdarma.`,
      `Prádlomaty ve vlastnictví ${f.company}, provoz pod vlastní značkou (white-label) — celá tržba zůstává ${f.company}.`,
      `Dodání, instalace a zaškolení personálu na klíč, bez zásahu do chodu prodejny.`,
      `Servis, náhradní díly a vzdálený dohled nad provozem 24/7.`,
      `Provozní podpora: bezhotovostní platby, zákaznická linka, měsíční reporting tržeb.`,
      `Vyhodnocení pilotu se společně nastavenými KPI — teprve potom rozhodnutí o rozšíření.`,
    ].join('\n'),
  },
  en: {
    subject: (f) => `Business proposal from Laundromats.eu for ${f.company}`,
    title: (f) => `Self-service laundries under the ${f.company} brand`,
    intro: (f) => `Dear Sir or Madam,

following today's call with the ${f.company} head office, I am sending you a business proposal and kindly ask you to forward it to ${f.handover || 'the person responsible for strategy and the development of new store formats'}${f.handover ? ', or to the person responsible for strategy and the development of new store formats' : ''}.

Laundromats.eu offers ${f.company} the opportunity to extend its customer services with self-service laundries at selected stores. We propose that ${f.company} purchases the laundry machines into its own ownership and operates them under its own brand. Laundromats.eu can provide delivery, installation, service and operational support.

This is not an offer to rent floor space. I would like to present the investment and operating model and propose a pilot at several suitable locations. If this area is handled by someone else, I would be grateful if you could pass this on to the right person.

Would it be possible to arrange a short twenty-minute meeting?

Kind regards
${f.sender || 'Tomáš Holý'}
Laundromats.eu`,
    points: (f) => [
      `Pilot at 3 selected stores — we prepare the data-based location selection (footfall, surroundings, competition) free of charge.`,
      `Machines owned by ${f.company}, operated under its own brand (white-label) — all revenue stays with ${f.company}.`,
      `Turnkey delivery, installation and staff training, without disrupting store operations.`,
      `Service, spare parts and 24/7 remote monitoring.`,
      `Operational support: cashless payments, customer hotline, monthly revenue reporting.`,
      `Pilot evaluation against jointly agreed KPIs — only then a decision on roll-out.`,
    ].join('\n'),
  },
  pl: {
    subject: (f) => `Propozycja biznesowa Laundromats.eu dla ${f.company}`,
    title: (f) => `Pralnie samoobsługowe pod marką ${f.company}`,
    intro: (f) => `Dzień dobry,

w nawiązaniu do dzisiejszej rozmowy telefonicznej z centralą ${f.company} przesyłam propozycję biznesową z prośbą o przekazanie jej ${f.handover || 'osobie odpowiedzialnej za strategię i rozwój nowych formatów sklepów'}${f.handover ? ', ewentualnie osobie odpowiedzialnej za strategię i rozwój nowych formatów sklepów' : ''}.

Projekt Laundromats.eu daje ${f.company} możliwość rozszerzenia usług dla klientów o pralnie samoobsługowe przy wybranych sklepach. Proponujemy, aby ${f.company} zakupił urządzenia na własność i prowadził je pod własną marką. Laundromats.eu może zapewnić dostawę, instalację, serwis i wsparcie operacyjne.

Nie jest to oferta najmu powierzchni. Chciałbym przedstawić model inwestycyjny i operacyjny oraz zaproponować pilotaż w kilku odpowiednich lokalizacjach. Jeśli tym obszarem zajmuje się ktoś inny, będę wdzięczny za przekazanie wiadomości właściwej osobie.

Czy byłoby możliwe umówienie krótkiego, dwudziestominutowego spotkania?

Z poważaniem
${f.sender || 'Tomáš Holý'}
Laundromats.eu`,
    points: (f) => [
      `Pilotaż w 3 wybranych sklepach — analizę lokalizacji opartą na danych (ruch, otoczenie, konkurencja) przygotujemy bezpłatnie.`,
      `Urządzenia na własność ${f.company}, działające pod własną marką (white-label) — cały przychód pozostaje w ${f.company}.`,
      `Dostawa, instalacja i szkolenie personelu pod klucz, bez zakłócania pracy sklepu.`,
      `Serwis, części zamienne i zdalny nadzór 24/7.`,
      `Wsparcie operacyjne: płatności bezgotówkowe, infolinia dla klientów, miesięczne raporty przychodów.`,
      `Ocena pilotażu według wspólnie ustalonych KPI — dopiero potem decyzja o rozszerzeniu.`,
    ].join('\n'),
  },
};

// Popisky veřejné stránky
const L = {
  cs: { prop: 'Obchodní návrh', for: 'pro', what: 'Co navrhujeme', nums: 'Orientační čísla pilotu', units: 'Počet prádlomatů', unit: 'Cena za prádlomat', inv: 'Investice celkem', rev: 'Očekávaná tržba / prádlomat / měsíc', revAll: 'Tržba pilotu / měsíc', payback: 'Návratnost', months: 'měsíců', model: 'Model', valid: 'Platnost návrhu do', vat: 'Ceny bez DPH, orientační — upřesníme podle lokalit.',
    cta: 'Mám zájem — domluvit 20min schůzku', ctaSub: 'Ozveme se do jednoho pracovního dne.', name: 'Jméno a příjmení', phone: 'Telefon', email: 'E-mail', note: 'Poznámka (nepovinné)', send: 'Odeslat', thanks: 'Děkujeme! Brzy se vám ozveme a domluvíme termín.', contact: 'Kontakt', write: 'Napsat e-mail', done: 'Zájem jsme už zaznamenali — děkujeme.', err: 'Nepodařilo se odeslat. Zkuste to prosím znovu.' },
  en: { prop: 'Business proposal', for: 'for', what: 'What we propose', nums: 'Indicative pilot figures', units: 'Number of machines', unit: 'Price per machine', inv: 'Total investment', rev: 'Expected revenue / machine / month', revAll: 'Pilot revenue / month', payback: 'Payback', months: 'months', model: 'Model', valid: 'Proposal valid until', vat: 'Prices excl. VAT, indicative — to be specified per location.',
    cta: "I'm interested — book a 20-minute meeting", ctaSub: 'We will get back to you within one business day.', name: 'Full name', phone: 'Phone', email: 'E-mail', note: 'Note (optional)', send: 'Send', thanks: 'Thank you! We will contact you shortly to arrange a time.', contact: 'Contact', write: 'Write an e-mail', done: 'Your interest has already been recorded — thank you.', err: 'Sending failed. Please try again.' },
  pl: { prop: 'Propozycja biznesowa', for: 'dla', what: 'Co proponujemy', nums: 'Orientacyjne liczby pilotażu', units: 'Liczba urządzeń', unit: 'Cena za urządzenie', inv: 'Inwestycja łącznie', rev: 'Oczekiwany przychód / urządzenie / miesiąc', revAll: 'Przychód pilotażu / miesiąc', payback: 'Zwrot', months: 'miesięcy', model: 'Model', valid: 'Propozycja ważna do', vat: 'Ceny netto, orientacyjne — doprecyzujemy dla lokalizacji.',
    cta: 'Jestem zainteresowany — umówić 20-minutowe spotkanie', ctaSub: 'Odezwiemy się w ciągu jednego dnia roboczego.', name: 'Imię i nazwisko', phone: 'Telefon', email: 'E-mail', note: 'Uwagi (opcjonalnie)', send: 'Wyślij', thanks: 'Dziękujemy! Wkrótce się odezwiemy i ustalimy termin.', contact: 'Kontakt', write: 'Napisz e-mail', done: 'Twoje zainteresowanie zostało już zapisane — dziękujemy.', err: 'Nie udało się wysłać. Spróbuj ponownie.' },
};

module.exports = function mountOffers(app, ctx) {
  const { HOLYOS_URL, LM_SECRET, requireAdmin, rateLimited } = ctx;
  // MINI / FLEX / MAX z produktů Best Series 2.0 (HolyOS) + texty z administrace Produkty
  async function models() {
    try {
      const list = ctx.fetchProducts ? await ctx.fetchProducts() : []; const cfg = ctx.fetchProdConfig ? await ctx.fetchProdConfig() : {}; const items = (cfg && cfg.items) || {};
      return ['mini', 'flex', 'max'].map((k) => { const re = new RegExp('\\b' + k + '\\b', 'i'); const c = list.filter((p) => re.test(p.model_variant || '') || re.test(p.name_cs || '')); const p = c.find((x) => /\bCZ\b/.test(x.name_cs || '')) || c[0]; const ic = (p && items[p.id]) || {}; return { kind: k, name: p ? (ic.title || p.name_cs) : '', desc: ic.desc || '' }; });
    } catch (e) { return null; }
  }
  const BASE = '/api/auth/lm/offers';
  const tok = () => jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
  async function hos(method, p, body) {
    if (!LM_SECRET) { const e = new Error('Chybí LM_SSO_SECRET'); e.status = 500; throw e; }
    const r = await fetch(HOLYOS_URL + BASE + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + tok() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('Nabídky ' + r.status)); e.status = r.status >= 500 ? 502 : r.status; throw e; }
    return j;
  }
  const J = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((j) => res.set('Cache-Control', 'no-store').json(j)).catch((e) => res.status(e.status || 502).json({ error: e.message || 'Nabídky jsou dočasně nedostupné' }));
  const js = express.json({ limit: '200kb' });

  // ── Administrace ──
  app.get('/admin/api/offers', requireAdmin, J(() => hos('GET', '/')));
  app.post('/admin/api/offers', requireAdmin, js, J((req) => hos('POST', '/', req.body || {})));
  app.post('/admin/api/offers/:id(\\d+)/send', requireAdmin, J((req) => hos('POST', '/' + req.params.id + '/send')));
  app.post('/admin/api/offers/:id(\\d+)/delete', requireAdmin, J((req) => hos('DELETE', '/' + req.params.id)));
  // Personalizovaný obrázek prádlomatu (v barvách firmy) — nahrání / odebrání / zobrazení
  app.post('/admin/api/offers/:id(\\d+)/image', requireAdmin, J((req) => { const b = req.body || {}; return hos('POST', '/' + req.params.id + '/image', { mime: String(b.mime || ''), data: String(b.data || '') }); }));
  app.post('/admin/api/offers/:id(\\d+)/image/delete', requireAdmin, J((req) => hos('DELETE', '/' + req.params.id + '/image')));
  app.get('/nabidka/:token([a-f0-9]{32})/img', async (req, res) => {
    try {
      const r = await fetch(HOLYOS_URL + BASE + '/public/' + req.params.token + '/image', { headers: { Authorization: 'Bearer ' + tok() }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) return res.status(404).end();
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg').set('Cache-Control', 'public, max-age=86400').set('X-Content-Type-Options', 'nosniff').send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.status(502).end(); }
  });
  app.post('/admin/api/offers/template', requireAdmin, js, J((req) => {
    const b = req.body || {}; const t = TPL[b.lang] || TPL.cs;
    const f = { company: String(b.company || '').trim() || '…', handover: String(b.handover || '').trim(), sender: String(b.sender || '').trim() };
    const P = require('./lm-offer-page'); const L = TPL[b.lang] ? b.lang : 'cs';
    return { subject: t.subject(f), title: t.title(f), intro: t.intro(f), points: t.points(f), perex: P.T[L].heroSub(f.company), refs: P.REFS[L] };
  }));

  // ── Veřejná stránka nabídky ──
  // Odeslání pohybu na stránce (sekce, čas, scroll, kliky, videa) → HolyOS
  app.post('/nabidka/:token([a-f0-9]{32})/ev', async (req, res) => {
    if (rateLimited && rateLimited('offev:' + req.ip, 600, 3600e3)) return res.status(429).end();
    try { await hos('POST', '/public/' + req.params.token + '/events', req.body || {}); res.status(204).end(); } catch (e) { res.status(e.status || 502).end(); }
  });
  // Každá nabídka má vlastní adresu: /nabidka/<firma>/<token> (i krátká /nabidka/<token>)
  app.get(['/nabidka/:slug([a-z0-9-]{1,40})/:token([a-f0-9]{32})', '/nabidka/:token([a-f0-9]{32})'], async (req, res) => {
    let o;
    try { o = (await hos('GET', '/public/' + req.params.token + (req.query.preview === '1' ? '?track=0' : ''))).offer; }
    catch (e) { return res.status(e.status === 404 ? 404 : 502).type('html').send(layout({ title: 'Nabídka', back: false, body: `<div class="card" style="max-width:560px;margin:40px auto"><h1 style="margin-top:0">${e.status === 404 ? 'Nabídka nenalezena' : 'Nabídka je dočasně nedostupná'}</h1><p class="muted">${e.status === 404 ? 'Odkaz už neplatí nebo je neúplný.' : 'Zkuste to prosím za chvíli.'}</p></div>` })); }
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').type('html').send(require('./lm-offer-page').offerPage(o, req.params.token, { preview: req.query.preview === '1', models: await models() }));
  });
  app.post('/nabidka/:token([a-f0-9]{32})/zajem', js, async (req, res) => {
    if (rateLimited && rateLimited('offer:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho pokusů.' });
    const b = req.body || {};
    try { await hos('POST', '/public/' + req.params.token + '/interest', { name: String(b.name || '').slice(0, 120), phone: String(b.phone || '').slice(0, 40), email: String(b.email || '').slice(0, 160), note: String(b.note || '').slice(0, 1500) }); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
};

function money(v, cur) { return Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + (cur === 'EUR' ? ' €' : ' Kč'); }
function offerPage(o, token) {
  const t = L[o.lang] || L.cs;
  const paras = String(o.intro || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const pts = String(o.points || '').split('\n').map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  const nums = [];
  if (o.model) nums.push([t.model, esc(o.model)]);
  if (o.units) nums.push([t.units, esc(String(o.units))]);
  if (o.unit_price) nums.push([t.unit, money(o.unit_price, o.currency)]);
  if (o.units && o.unit_price) nums.push([t.inv, '<b>' + money(o.units * o.unit_price, o.currency) + '</b>']);
  if (o.monthly_revenue) nums.push([t.rev, money(o.monthly_revenue, o.currency)]);
  if (o.monthly_revenue && o.units) nums.push([t.revAll, money(o.monthly_revenue * o.units, o.currency)]);
  if (o.monthly_revenue && o.unit_price) nums.push([t.payback, '≈ ' + Math.ceil(o.unit_price / o.monthly_revenue) + ' ' + t.months]);
  const valid = o.valid_until ? new Date(o.valid_until + 'T12:00:00').toLocaleDateString(o.lang === 'en' ? 'en-GB' : o.lang === 'pl' ? 'pl-PL' : 'cs-CZ') : '';
  const body = `<style>
.of{max-width:860px;margin:24px auto 60px;padding:0 4px}.of h1{font-size:30px;line-height:1.2;margin:6px 0 4px}.of .kick{color:#5eead4;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
.of .card{margin-top:16px}.of .intro p{margin:0 0 12px;line-height:1.6}.of ul.pts{list-style:none;padding:0;margin:0}.of ul.pts li{padding:10px 0 10px 32px;position:relative;border-bottom:1px solid rgba(255,255,255,.06);line-height:1.5}
.of ul.pts li:before{content:'✓';position:absolute;left:4px;top:9px;color:#22c55e;font-weight:800}.of table{width:100%;border-collapse:collapse}.of td{padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.06)}.of td:last-child{text-align:right;white-space:nowrap}
.of .cta{border-color:rgba(45,212,191,.5)}.of .cta .btn{font-size:16px;padding:13px 20px}.of label{display:block;font-size:13px;margin:10px 0 4px;color:var(--text2,#9fb0c8)}.of input,.of textarea{width:100%;box-sizing:border-box}
.of .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.of .two{grid-template-columns:1fr}.of h1{font-size:24px}}</style>
<div class="of">
  <div class="kick">${esc(t.prop)} · Laundromats.eu</div>
  <h1>${esc(o.title || t.prop)}</h1>
  <div class="muted">${esc(t.prop)} ${esc(t.for)} <b>${esc(o.company || '')}</b>${valid ? ' · ' + esc(t.valid) + ' ' + esc(valid) : ''}</div>
  <div class="card intro">${paras}</div>
  ${pts.length ? `<div class="card"><h2 style="margin-top:0">${esc(t.what)}</h2><ul class="pts">${pts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  ${nums.length ? `<div class="card"><h2 style="margin-top:0">${esc(t.nums)}</h2><table>${nums.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`).join('')}</table><p class="muted small" style="margin:8px 0 0">${esc(t.vat)}</p></div>` : ''}
  <div class="card cta" id="zajem">
    ${o.interest ? `<p style="margin:0;font-weight:700">✓ ${esc(t.done)}</p>` : `<button class="btn" type="button" id="of-open">${esc(t.cta)}</button><div class="muted small" style="margin-top:6px">${esc(t.ctaSub)}</div>
    <form id="of-form" style="display:none;margin-top:10px"><div class="two"><div><label>${esc(t.name)}</label><input name="name" required maxlength="120"></div><div><label>${esc(t.phone)}</label><input name="phone" maxlength="40"></div></div>
      <label>${esc(t.email)}</label><input name="email" type="email" maxlength="160"><label>${esc(t.note)}</label><textarea name="note" rows="3" maxlength="1500"></textarea>
      <div style="margin-top:12px"><button class="btn" type="submit">${esc(t.send)}</button> <span class="small" id="of-msg"></span></div></form>`}
  </div>
  ${o.sender_name || o.reply_to || o.sender_phone ? `<div class="card"><h2 style="margin-top:0">${esc(t.contact)}</h2><div><b>${esc(o.sender_name || 'Laundromats.eu')}</b></div>${o.sender_phone ? `<div><a href="tel:${esc(o.sender_phone.replace(/\s/g, ''))}">${esc(o.sender_phone)}</a></div>` : ''}${o.reply_to ? `<div><a href="mailto:${esc(o.reply_to)}">${esc(t.write)}: ${esc(o.reply_to)}</a></div>` : ''}</div>` : ''}
</div>
<script>(function(){var b=document.getElementById('of-open'),f=document.getElementById('of-form');if(!b)return;b.onclick=function(){f.style.display='';b.style.display='none';f.querySelector('input').focus();};
f.onsubmit=function(e){e.preventDefault();var m=document.getElementById('of-msg'),d={};new FormData(f).forEach(function(v,k){d[k]=v;});f.querySelector('button').disabled=true;
fetch('/nabidka/${token}/zajem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){if(!r.ok)throw 0;f.parentNode.innerHTML='<p style="margin:0;font-weight:700">✓ ${esc(t.thanks).replace(/'/g, "\\'")}</p>';}).catch(function(){m.textContent='${esc(t.err).replace(/'/g, "\\'")}';f.querySelector('button').disabled=false;});};})();<\/script>`;
  return layout({ title: (o.title || t.prop) + ' — ' + (o.company || ''), back: false, body }).replace('<html lang="cs">', '<html lang="' + (o.lang || 'cs') + '">');
}

// ── Panel v administraci (/admin/meetings → 🤝 Korporáty) ──
module.exports.PANEL = `<div class="mt-corp" style="display:none">
  <div class="mt-bar"><h2>🤝 Nabídky korporátům</h2><span style="flex:1"></span><button class="btn sm of-new">+ Nová nabídka</button></div>
  <p class="muted small" style="margin:-6px 0 14px">Obchodní návrh pro řetězce a korporáty. Korporát dostane e-mail s odkazem na webovou nabídku (CZ / EN / PL, Kč / EUR). Uvidíte, kdy ji otevřel, a když klikne „Mám zájem“, přijde vám notifikace do Velína.</p>
  <div class="of-edit card" style="display:none"></div>
  <div class="of-list card"></div>
</div>`;
module.exports.CSS = `.of-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.of-grid .w2{grid-column:span 2}.of-grid .w4{grid-column:span 4}@media(max-width:900px){.of-grid{grid-template-columns:1fr 1fr}.of-grid .w4{grid-column:span 2}}
.of-edit label{display:block;font-size:12.5px;color:var(--text2);margin-bottom:3px}.of-edit input,.of-edit select,.of-edit textarea{width:100%;box-sizing:border-box;background:var(--bg2,#0b1220);color:var(--text);border:1px solid var(--border2);border-radius:8px;padding:7px 9px;font:inherit}
.of-edit textarea{line-height:1.45}.of-st{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:700;border:1px solid var(--border2)}.of-st.draft{color:#94a3b8}.of-st.sent{color:#60a5fa;border-color:#60a5fa66}.of-st.viewed{color:#fbbf24;border-color:#fbbf2466}.of-st.interested{color:#22c55e;border-color:#22c55e66}
.of-tbl{width:100%;border-collapse:collapse}.of-tbl th,.of-tbl td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--border);font-size:13.5px;vertical-align:top}.of-tbl td.a{white-space:nowrap}`;
module.exports.JS = `(function(){
var root=document.getElementById('mt'),P=root.querySelector('.mt-corp');if(!P)return;
var list=null,cur=null;
function req(u,b){return fetch(u,{method:b===undefined?'GET':'POST',headers:b===undefined?{}:{'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('Chyba '+r.status));return j;});});}
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function dt(s){return s?new Date(s).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}
var ST={draft:'koncept',sent:'odesláno',viewed:'otevřeno',interested:'má zájem'};
function slug(c){return String(c||'nabidka').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'nabidka';}
function link(o){return location.origin+'/nabidka/'+slug(o.company)+'/'+o.token;}
function renderList(){var w=P.querySelector('.of-list');if(!list){w.innerHTML='<div class="muted">Načítám…</div>';return;}
 if(!list.length){w.innerHTML='<div class="muted">Zatím žádná nabídka. Klikněte na „+ Nová nabídka“.</div>';return;}
 w.innerHTML='<table class="of-tbl"><thead><tr><th>Společnost</th><th>Kontakt</th><th>Jazyk</th><th>Stav</th><th>Odesláno</th><th>Otevřeno</th><th>Zájem</th><th></th></tr></thead><tbody>'+list.map(function(o){
  return '<tr><td><b>'+e(o.company)+'</b><div class="muted small">'+e(o.title||'')+'</div></td><td>'+e(o.contact_name||'')+'<div class="muted small">'+e(o.contact_email||'—')+'</div></td><td>'+e((o.lang||'cs').toUpperCase())+' · '+e(o.currency||'CZK')+'</td>'
  +'<td><span class="of-st '+e(o.status)+'">'+e(ST[o.status]||o.status)+'</span></td><td class="small">'+dt(o.sent_at)+(o.sent_count>1?' ('+o.sent_count+'×)':'')+'</td><td class="small">'+(o.viewed_at?dt(o.viewed_at)+(o.views>1?'<div class="muted">'+o.views+'× otevřeno</div>':'')+(o.time_total?'<div class="muted">⏱ '+mm(o.time_total)+'</div>':''):'—')+'</td>'
  +'<td class="small">'+(o.interest?'<b style="color:#22c55e">'+dt(o.interest.at)+'</b><div>'+e([o.interest.name,o.interest.phone,o.interest.email].filter(Boolean).join(' · '))+'</div>'+(o.interest.note?'<div class="muted">'+e(o.interest.note)+'</div>':''):'—')+'</td>'
  +'<td class="a"><button class="btn sec sm" data-of-edit="'+o.id+'">Upravit</button> <a class="btn sec sm" target="_blank" href="/nabidka/'+slug(o.company)+'/'+e(o.token)+'?preview=1">Náhled</a> <button class="btn sec sm" data-of-act="'+o.id+'">Aktivita'+((o.visits||[]).length?' ('+o.visits.length+')':'')+'</button> <button class="btn sec sm" data-of-copy="'+o.id+'" title="Zkopírovat odkaz na nabídku">🔗</button> <button class="btn sm" data-of-send="'+o.id+'">'+(o.sent_at?'Odeslat znovu':'Odeslat')+'</button> <button class="btn sec sm" data-of-del="'+o.id+'" title="Smazat" style="color:#f87171">🗑</button></td></tr>';}).join('')+'</tbody></table>';}
var SEC={uvod:'Úvod',provozovny:'Provozovny','o-co-jde':'O co jde','co-umi':'Co umí',prinosy:'Přínosy',pilot:'Pilot',ekonomika:'Ekonomika',video:'Videa',zajem:'Další krok / zájem'};
function mm(sec){sec=sec||0;return sec<60?sec+' s':Math.floor(sec/60)+' min '+(sec%60)+' s';}
function activity(o){var w=P.querySelector('.of-act');if(!w){w=document.createElement('div');w.className='of-act card';P.querySelector('.of-list').before(w);}w.style.display='';
 var vs=o.visits||[];w.innerHTML='<div style="display:flex;align-items:center;gap:10px"><h3 style="margin:0">Aktivita na nabídce — '+e(o.company)+'</h3><span style="flex:1"></span><button class="btn sec sm of-actclose">Zavřít</button></div>'
 +'<div class="muted small" style="margin:6px 0 10px">Adresa nabídky: <a href="'+e(link(o))+'" target="_blank">'+e(link(o))+'</a> · '+vs.length+' návštěv · celkem '+mm(o.time_total||0)+'</div>'
 +(vs.length?'<table class="of-tbl"><thead><tr><th>Kdy</th><th>Zařízení</th><th>Čas na stránce</th><th>Dočteno</th><th>Viděné sekce</th><th>Videa</th><th>Kliknutí / formulář</th></tr></thead><tbody>'+vs.map(function(v){
  return '<tr><td class="small">'+dt(v.at)+(v.last&&v.last!==v.at?'<div class="muted">do '+new Date(v.last).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})+'</div>':'')+'</td><td class="small">'+e(v.device||'')+'</td><td><b>'+mm(v.secs)+'</b></td><td>'+(v.scroll||0)+' %</td>'
  +'<td class="small">'+(v.sections||[]).map(function(x){return e(SEC[x]||x);}).join(', ')+'</td><td class="small">'+e((v.videos||[]).join(', ')||'—')+'</td><td class="small">'+e((v.clicks||[]).slice(-8).join(' · ')||'—')+(v.form?'<div style="color:#22c55e">formulář '+e(v.form)+'</div>':'')+'</td></tr>';}).join('')+'</tbody></table>':'<div class="muted">Zatím nikdo stránku neotevřel (náhled z administrace se nepočítá).</div>');
 w.scrollIntoView({behavior:'smooth',block:'start'});}
function load(){list=null;renderList();req('/admin/api/offers').then(function(j){list=j.offers||[];renderList();}).catch(function(er){P.querySelector('.of-list').innerHTML='<div style="color:#f87171">'+e(er.message)+'</div>';});}
function F(n,l,v,cls,t){return '<div class="'+(cls||'')+'"><label>'+l+'</label>'+(t==='ta'?'<textarea name="'+n+'" rows="'+(cls==='w4'?10:6)+'">'+e(v)+'</textarea>':'<input name="'+n+'" value="'+e(v)+'"'+(t?' type="'+t+'"':'')+'>')+'</div>';}
function edit(o){cur=o||{lang:'cs',currency:'CZK',sender_name:'Tomáš Holý'};var w=P.querySelector('.of-edit');w.style.display='';
 w.innerHTML='<h3 style="margin:0 0 10px">'+(o&&o.id?'Upravit nabídku':'Nová nabídka')+'</h3><div class="of-grid">'
 +F('company','Společnost (korporát) *',cur.company,'w2')+F('contact_name','Kontaktní osoba',cur.contact_name)+F('contact_email','E-mail příjemce',cur.contact_email,'','email')
 +'<div><label>Jazyk</label><select name="lang"><option value="cs">čeština</option><option value="en">English</option><option value="pl">polski</option></select></div><div><label>Měna</label><select name="currency"><option value="CZK">Kč</option><option value="EUR">EUR</option></select></div>'
 +F('handover','Předat komu (do textu, např. panu Tomáši Vlkovi)',cur.handover||'','w2')
 +'<div class="w4" style="display:flex;gap:8px;align-items:center"><button class="btn sec sm of-tpl" type="button">✨ Vyplnit text podle šablony</button><span class="muted small">Doplní předmět, nadpis, text e-mailu a body návrhu podle jazyka a firmy — pak vše upravte.</span></div>'
 +F('subject','Předmět e-mailu',cur.subject,'w2')+F('title','Nadpis nabídky (web)',cur.title,'w2')
 +F('intro','Text e-mailu (posílá se e-mailem, na webové nabídce se neukazuje)',cur.intro,'w4','ta')+F('perex','Podnadpis webové nabídky (1–2 věty pod nadpisem)',cur.perex,'w4')+F('points','Pilotní projekt — kroky na webu (každý na nový řádek)',cur.points,'w4','ta')+F('refs','Reference na webu — řádek: Název | popis | obrázek (/media/provozovna-1.webp …)',cur.refs,'w4','ta')
 +F('model','Model prádlomatu (nepovinné)',cur.model)+F('units','Počet prádlomatů v pilotu',cur.units)+F('unit_price','Cena za prádlomat bez DPH',cur.unit_price)+F('monthly_revenue','Očekávaná tržba / prádlomat / měsíc (bez DPH)',cur.monthly_revenue)+F('visits','Návštěvnost (zákazníků / den, výchozí 7)',cur.visits)+F('stores','Celkový potenciál — počet prodejen (prázdné = sekce se nezobrazí)',cur.stores)+F('conn_price','Cena přípojky / prádlomat bez DPH',cur.conn_price)+F('warranty_years','Prodloužená záruka (0–4 roky navíc)',cur.warranty_years)
 +F('valid_until','Platnost do',cur.valid_until,'','date')+F('sender_name','Odesílatel (jméno)',cur.sender_name)+F('sender_phone','Telefon odesílatele',cur.sender_phone)+F('reply_to','E-mail pro odpovědi',cur.reply_to,'','email')
 +'<div class="w4"><label>Personalizovaný obrázek prádlomatu v barvách firmy (zobrazí se v sekci „Prádlomat v barvách …“ hned pod úvodem)</label>'+(cur.id?'<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">'+(cur.image_v?'<img src="/nabidka/'+e(cur.token)+'/img?v='+cur.image_v+'" style="height:120px;border-radius:10px;border:1px solid var(--border2)">':'<span class="muted small">zatím bez obrázku — na webu se ukáže obecný prádlomat</span>')+'<input type="file" class="of-img" accept="image/jpeg,image/png,image/webp" style="width:auto">'+(cur.image_v?'<button class="btn sec sm of-imgdel" type="button" style="color:#f87171">Odebrat obrázek</button>':'')+'<span class="muted small of-imgmsg"></span></div>':'<span class="muted small">Obrázek půjde nahrát po prvním uložení nabídky.</span>')+'</div>'
 +F('note','Interní poznámka (korporát ji nevidí)',cur.note,'w4')
 +'</div><div style="margin-top:12px;display:flex;gap:8px"><button class="btn of-save" type="button">Uložit</button><button class="btn sec of-cancel" type="button">Zavřít</button><span class="muted small" style="align-self:center">Čísla jsou nepovinná — když nevyplníte, blok s čísly se na webu neukáže.</span></div>';
 w.querySelector('[name=lang]').value=cur.lang||'cs';w.querySelector('[name=currency]').value=cur.currency||'CZK';w.scrollIntoView({behavior:'smooth',block:'start'});}
function form(){var w=P.querySelector('.of-edit'),d={};w.querySelectorAll('[name]').forEach(function(x){d[x.name]=x.value;});if(cur&&cur.id)d.id=cur.id;return d;}
P.addEventListener('change',function(ev){var inp=ev.target.closest('.of-img');if(!inp||!inp.files||!inp.files[0]||!cur||!cur.id)return;var f=inp.files[0],m=P.querySelector('.of-imgmsg');
 if(f.size>5*1024*1024){alert('Obrázek je větší než 5 MB.');inp.value='';return;}m.textContent='Nahrávám…';var rd=new FileReader();rd.onload=function(){req('/admin/api/offers/'+cur.id+'/image',{mime:f.type,data:String(rd.result)}).then(function(j){cur=j.offer;var i=(list||[]).findIndex(function(x){return x.id===cur.id;});if(i>=0)list[i]=cur;edit(cur);}).catch(function(er){m.textContent='';alert(er.message);});};rd.readAsDataURL(f);});
P.addEventListener('click',function(ev){var t=ev.target;
 if(t.closest('.of-imgdel')){if(!confirm('Odebrat personalizovaný obrázek?'))return;req('/admin/api/offers/'+cur.id+'/image/delete',{}).then(function(j){cur=j.offer;var i=(list||[]).findIndex(function(x){return x.id===cur.id;});if(i>=0)list[i]=cur;edit(cur);}).catch(function(er){alert(er.message);});return;}
 if(t.closest('.of-new')){edit(null);return;}
 if(t.closest('.of-cancel')){P.querySelector('.of-edit').style.display='none';cur=null;return;}
 if(t.closest('.of-tpl')){var d=form();if(!d.company){alert('Nejdřív vyplňte společnost.');return;}if((d.intro||d.points)&&!confirm('Přepsat předmět, nadpis, text a body podle šablony?'))return;
  req('/admin/api/offers/template',{lang:d.lang,company:d.company,handover:d.handover,sender:d.sender_name}).then(function(j){var w=P.querySelector('.of-edit');['subject','title','intro','points','perex','refs'].forEach(function(k){var el=w.querySelector('[name='+k+']');if(el)el.value=j[k]||'';});}).catch(function(er){alert(er.message);});return;}
 if(t.closest('.of-save')){var b=t.closest('.of-save');b.disabled=true;req('/admin/api/offers',form()).then(function(j){cur=j.offer;b.disabled=false;P.querySelector('.of-edit').style.display='none';load();}).catch(function(er){b.disabled=false;alert(er.message);});return;}
 var id;
 if((id=t.getAttribute('data-of-edit'))){var o=(list||[]).find(function(x){return x.id==id;});if(o)edit(o);return;}
 if((id=t.getAttribute('data-of-act'))){var oa=(list||[]).find(function(x){return x.id==id;});if(oa)activity(oa);return;}
 if(t.closest('.of-actclose')){P.querySelector('.of-act').style.display='none';return;}
 if((id=t.getAttribute('data-of-copy'))){var o2=(list||[]).find(function(x){return x.id==id;});if(o2&&navigator.clipboard)navigator.clipboard.writeText(link(o2)).then(function(){t.textContent='✓';setTimeout(function(){t.textContent='🔗';},1500);});return;}
 if((id=t.getAttribute('data-of-send'))){var o3=(list||[]).find(function(x){return x.id==id;});if(!o3)return;if(!o3.contact_email){alert('Nabídka nemá e-mail příjemce.');return;}
  if(!confirm('Odeslat nabídku „'+(o3.subject||o3.title||o3.company)+'“\\nna '+o3.contact_email+'?\\n\\nE-mail obsahuje text a odkaz na webovou nabídku.'))return;t.disabled=true;
  req('/admin/api/offers/'+id+'/send',{}).then(function(){load();alert('Odesláno na '+o3.contact_email+'.');}).catch(function(er){t.disabled=false;alert('Nepodařilo se odeslat: '+er.message);});return;}
 if((id=t.getAttribute('data-of-del'))){var o4=(list||[]).find(function(x){return x.id==id;});if(!o4||!confirm('Smazat nabídku pro '+o4.company+'? Odkaz na webovou nabídku přestane fungovat. Akci nelze vrátit.'))return;
  req('/admin/api/offers/'+id+'/delete',{}).then(load).catch(function(er){alert(er.message);});return;}
});
window.__lmOffersLoad=function(){if(list===null)load();};
if(P.style.display!=='none')load(); // obnovení stránky na záložce Korporáty
})();`;
