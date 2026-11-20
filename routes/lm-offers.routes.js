// HolyOS — Nabídky korporátům (obchodní návrhy) pro laundromats.eu.
// Volá jen server Laundromats (servisní JWT LM_SSO_SECRET): administrace /admin/meetings → Korporáty
// i veřejná stránka nabídky laundromats.eu/nabidka/<token>. Data v AppSetting lm_corp_offers (JSON pole).
// Odeslání: e-mail s odkazem na webovou nabídku (sendMail, značka Laundromats, Reply-To = obchodník).
// Otevření a zájem („Mám zájem / domluvit schůzku") se evidují a zájem jde pushem do Velína (Tomáš + Jan).
'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const settings = require('../services/settings');

const router = express.Router();
router.use(express.json({ limit: '8mb' })); // obrázek personalizovaného prádlomatu jako base64
router.use((req, res, next) => {
  const secret = process.env.LM_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); return next(); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
});

const KEY = 'lm_corp_offers';
const LANGS = ['cs', 'en', 'pl'];
const CURS = ['CZK', 'EUR'];
const load = async () => { const v = await settings.getSetting(KEY, { type: 'json', defaultValue: [] }).catch(() => []); return Array.isArray(v) ? v : []; };
const save = (list) => settings.setSetting(KEY, list.slice(0, 1000), { type: 'json' });
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => { const x = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null; };
// Čitelná část adresy podle firmy: /nabidka/<slug>/<token>
const slugOf = (c) => String(c || 'nabidka').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'nabidka';
const LINK_LABEL = { cs: 'Zobrazit obchodní návrh', en: 'View the business proposal', pl: 'Zobacz propozycję biznesową' };

// Veřejná podoba nabídky (bez interních poznámek a kontaktů na odesílatele navíc)
function publicView(o) {
  return { token: o.token, company: o.company, contact_name: o.contact_name, lang: o.lang, currency: o.currency, title: o.title, intro: o.intro,
    points: o.points, perex: o.perex, refs: o.refs, image_v: o.image_v || null, hide_eco: !!o.hide_eco, model: o.model, units: o.units, unit_price: o.unit_price, monthly_revenue: o.monthly_revenue, conn_price: o.conn_price || null, footfall: o.footfall || null, stores: o.stores || null, warranty_years: o.warranty_years || null, valid_until: o.valid_until,
    sender_name: o.sender_name, sender_phone: o.sender_phone, reply_to: o.reply_to, interest: o.interest ? { at: o.interest.at } : null };
}

async function notifyBoss(title, body) {
  try {
    const { prisma } = require('../config/database');
    const { notifyPerson } = require('../services/push/expo-push');
    let createNotification = null; try { ({ createNotification } = require('./notifications.routes')); } catch (e) { /* bez zvonku */ }
    const ps = await prisma.person.findMany({ where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Jan', 'Tomáš'], mode: 'insensitive' } }, select: { id: true, user_id: true } });
    for (const p of ps) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'lm_corp_offer' }, sound: 'default' }).catch(() => {});
      if (p.user_id && createNotification) createNotification({ userId: p.user_id, type: 'system', title, body, meta: { kind: 'lm_corp_offer' } }).catch(() => {});
    }
  } catch (e) { console.warn('[lm-offers] notifikace:', e.message); }
}

// GET / — seznam nabídek (administrace)
router.get('/', async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json({ offers: (await load()).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))) }); } catch (e) { next(e); }
});

// POST / — založení / úprava nabídky {id?, ...}
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const list = await load();
    const now = new Date().toISOString();
    let o = b.id ? list.find((x) => x.id === Number(b.id)) : null;
    if (b.id && !o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    if (!o) { o = { id: (list.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1), token: crypto.randomBytes(16).toString('hex'), status: 'draft', created_at: now, views: 0 }; list.push(o); }
    const email = s(b.contact_email, 160);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Neplatný e-mail příjemce' });
    const reply = s(b.reply_to, 160);
    if (reply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reply)) return res.status(400).json({ error: 'Neplatný e-mail pro odpověď' });
    Object.assign(o, {
      company: s(b.company, 160), contact_name: s(b.contact_name, 160), contact_email: email, lang: LANGS.includes(b.lang) ? b.lang : 'cs',
      currency: CURS.includes(b.currency) ? b.currency : 'CZK', subject: s(b.subject, 200), title: s(b.title, 200), intro: s(b.intro, 6000),
      points: s(b.points, 4000), perex: s(b.perex, 600), refs: s(b.refs, 3000), model: s(b.model, 80), units: num(b.units), unit_price: num(b.unit_price), monthly_revenue: num(b.monthly_revenue), conn_price: num(b.conn_price), footfall: num(b.footfall), stores: num(b.stores) ? Math.round(num(b.stores)) : null, warranty_years: num(b.warranty_years) ? Math.min(4, Math.round(num(b.warranty_years))) : null,
      valid_until: /^\d{4}-\d{2}-\d{2}$/.test(String(b.valid_until || '')) ? b.valid_until : null, note: s(b.note, 2000),
      sender_name: s(b.sender_name, 120), sender_phone: s(b.sender_phone, 40), reply_to: reply, updated_at: now,
      // Skrýt sekci Ekonomika na webové nabídce. Formulář posílá eco_form=1 + show_eco (zaškrtávátko); jiné volání pole nemění.
      hide_eco: b.eco_form ? !(b.show_eco === '1' || b.show_eco === true || b.show_eco === 'on') : (b.hide_eco != null ? !!b.hide_eco : !!o.hide_eco),
    });
    if (!o.company) return res.status(400).json({ error: 'Vyplňte název společnosti' });
    await save(list);
    res.json({ offer: o });
  } catch (e) { next(e); }
});

// DELETE /:id — smazání (jen koncept nebo po potvrzení v administraci)
router.delete('/:id(\\d+)', async (req, res, next) => {
  try { const list = await load(); const i = list.findIndex((x) => x.id === Number(req.params.id)); if (i < 0) return res.status(404).json({ error: 'Nabídka nenalezena' }); const [o] = list.splice(i, 1); await save(list); console.log('[lm-offers] smazána nabídka #' + o.id + ' ' + o.company); res.json({ ok: true }); } catch (e) { next(e); }
});

// POST /:id/send — odeslání e-mailu s odkazem na webovou nabídku
router.post('/:id(\\d+)/send', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.id === Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    if (!o.contact_email) return res.status(400).json({ error: 'Chybí e-mail příjemce' });
    if (!o.intro) return res.status(400).json({ error: 'Chybí text e-mailu' });
    const base = String(process.env.LM_URL || 'https://laundromats.eu').replace(/\/$/, '');
    const link = base + '/nabidka/' + slugOf(o.company) + '/' + o.token;
    let from = process.env.LM_OFFER_FROM || null;
    if (!from) { try { from = await require('./compounder.routes').funnelMailFrom('schuzka', o.lang === 'pl' ? 'pl' : undefined); } catch (e) { from = null; } }
    from = from || process.env.COMPOUNDER_MAIL_FROM || undefined;
    const r = await require('../services/email').sendMail({
      to: o.contact_email, from, fromName: o.sender_name ? o.sender_name + ' · Laundromats.eu' : 'Laundromats.eu', brand: 'pradlomaty', lang: o.lang,
      subject: o.subject || o.title || ('Laundromats.eu — ' + o.company), body: o.intro, link, linkLabel: LINK_LABEL[o.lang] || LINK_LABEL.cs,
      replyTo: o.reply_to || undefined, unsubscribe: false,
    });
    console.log('[lm-offers] odeslání #' + o.id + ' → ' + o.contact_email + ': ' + JSON.stringify({ sent: !!(r && r.sent), error: r && (r.error || r.skipped) }));
    if (!r || !r.sent) return res.status(502).json({ error: (r && (r.error || r.skipped)) || 'E-mail se nepodařilo odeslat' });
    o.sent_at = new Date().toISOString(); o.sent_count = (o.sent_count || 0) + 1; if (o.status === 'draft') o.status = 'sent'; o.sent_from = r.from || from || null;
    await save(list);
    res.json({ ok: true, offer: o, link });
  } catch (e) { next(e); }
});

// GET /public/:token — veřejná nabídka (eviduje otevření, ?track=0 = náhled z administrace bez evidence)
router.get('/public/:token([a-f0-9]{32})', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.token === req.params.token);
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    if (req.query.track !== '0') {
      const first = !o.viewed_at;
      o.views = (o.views || 0) + 1; o.last_view_at = new Date().toISOString(); if (first) o.viewed_at = o.last_view_at;
      if (o.status === 'sent') o.status = 'viewed';
      await save(list);
      if (first && o.sent_at) notifyBoss('👀 Nabídku otevřeli: ' + o.company, (o.contact_name ? o.contact_name + ' · ' : '') + 'obchodní návrh Laundromats.eu byl právě otevřen.');
    }
    res.set('Cache-Control', 'no-store').json({ offer: publicView(o) });
  } catch (e) { next(e); }
});

// POST /public/:token/interest — „Mám zájem / domluvit schůzku" {name, phone, email, note}
router.post('/public/:token([a-f0-9]{32})/interest', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.token === req.params.token);
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    const b = req.body || {};
    o.interest = { at: new Date().toISOString(), name: s(b.name, 120), phone: s(b.phone, 40), email: s(b.email, 160), note: s(b.note, 1500) };
    o.status = 'interested';
    await save(list);
    notifyBoss('🤝 Zájem o nabídku: ' + o.company, [o.interest.name, o.interest.phone, o.interest.email].filter(Boolean).join(' · ') + (o.interest.note ? ' — ' + o.interest.note.slice(0, 160) : ''));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /public/:token/events — pohyb na stránce nabídky {visit, did, fp, vw, secs, scroll, events:[{k, v}], mv:[[ms,druh,a,b]]}
// k: section (viděná sekce), click (tlačítko/odkaz), video (přehrání), form (otevření/odeslání formuláře)
// mv druhy: 0 pohyb myši/prstu (x,y na stránce), 1 scroll (y), 2 klik/dotek (x,y), 3 velikost okna (šířka,výška)
// IP, prohlížeč a jazyk návštěvníka přicházejí v hlavičkách X-Fwd-* (volá nás server Laundromats).
const TRK_KEY = (id, vid) => 'lm_corp_offer_trk.' + id + '.' + vid;
const TRK_MAX = 3000; // max. vzorků pohybu na návštěvu
const BOT_RE = /bot|crawl|spider|preview|headless|python|curl|wget|safelinks|proofpoint|mimecast|barracuda|slurp|facebookexternalhit|whatsapp|telegram|skype|outlook|lighthouse/i;
let _chain = Promise.resolve();
const serial = (fn) => { const p = _chain.then(fn, fn); _chain = p.catch(() => {}); return p; }; // zápisy po jednom (bez ztráty dat při souběhu)

router.post('/public/:token([a-f0-9]{32})/events', async (req, res, next) => {
  try {
    const b = req.body || {}; const vid = s(b.visit, 40);
    if (!/^[a-z0-9-]{6,40}$/.test(vid)) return res.status(400).json({ error: 'Chybí návštěva' });
    const ip = s(req.headers['x-fwd-ip'], 60).replace(/^::ffff:/, ''), ua = s(req.headers['x-fwd-ua'] || b.ua, 300), lang = s(b.lang || req.headers['x-fwd-lang'], 40);
    const out = await serial(async () => {
      const list = await load(); const o = list.find((x) => x.token === req.params.token);
      if (!o) return null;
      o.visits = Array.isArray(o.visits) ? o.visits : [];
      let v = o.visits.find((x) => x.id === vid);
      const now = new Date().toISOString();
      let isNew = false;
      if (!v) {
        isNew = true;
        v = { id: vid, at: now, last: now, secs: 0, scroll: 0, sections: [], clicks: [], videos: [], form: null, ua: s(ua, 200), device: /mobi|android|iphone/i.test(ua) ? 'mobil' : 'počítač',
          ip: ip || null, did: s(b.did, 40) || null, fp: s(b.fp, 20) || null, lang, vw: Math.round(Number(b.vw)) || null, vh: Math.round(Number(b.vh)) || null, bot: BOT_RE.test(ua) };
        o.visits.push(v); if (o.visits.length > 300) o.visits = o.visits.slice(-300);
      }
      v.last = now;
      const secs = Number(b.secs); if (isFinite(secs) && secs >= 0) v.secs = Math.max(v.secs || 0, Math.min(Math.round(secs), 6 * 3600));
      const sc = Number(b.scroll); if (isFinite(sc)) v.scroll = Math.max(v.scroll || 0, Math.min(100, Math.round(sc)));
      (Array.isArray(b.events) ? b.events.slice(0, 50) : []).forEach((e) => {
        const k = s(e && e.k, 20), val = s(e && e.v, 80); if (!val) return;
        if (k === 'section' && !v.sections.includes(val)) v.sections.push(val);
        else if (k === 'click') { v.clicks.push(val); v.clicks = v.clicks.slice(-40); }
        else if (k === 'video' && !v.videos.includes(val)) v.videos.push(val);
        else if (k === 'form') v.form = val;
      });
      o.time_total = o.visits.reduce((a, x) => a + (x.secs || 0), 0);
      // Nové zařízení = jiné did (cookie/localStorage), příp. otisk; roboti (skenery pošty) se nepočítají
      let alert = null;
      if (isNew && !v.bot) {
        const key = v.did || ('fp:' + v.fp);
        const prev = o.visits.filter((x) => x.id !== vid && !x.bot);
        const known = new Set(prev.map((x) => x.did || ('fp:' + x.fp)));
        if (prev.length && !known.has(key)) {
          const sameNet = !!ip && prev.some((x) => x.ip === ip);
          o.forward = { at: now, level: sameNet ? 'same_net' : 'other_net', ip: ip || null, devices: known.size + 1 };
          alert = sameNet ? 'Nabídku otevřelo další zařízení ve stejné síti (kolega / jiný počítač).' : 'Nabídku otevřelo nové zařízení z jiné sítě — odkaz byl pravděpodobně někomu přeposlán.';
        } else o.forward = o.forward || null;
      }
      // Pohyb (vzorky) ukládáme zvlášť po návštěvách
      const mv = (Array.isArray(b.mv) ? b.mv : []).slice(0, 320).map((m) => Array.isArray(m) ? [Math.round(Number(m[0])) || 0, Math.round(Number(m[1])) || 0, Math.round(Number(m[2])) || 0, Math.round(Number(m[3])) || 0] : null).filter((m) => m && m[1] >= 0 && m[1] <= 3);
      if (mv.length && !v.bot) {
        const cur = await settings.getSetting(TRK_KEY(o.id, vid), { type: 'json', defaultValue: null }).catch(() => null) || { mv: [] };
        if (cur.mv.length < TRK_MAX) { cur.mv = cur.mv.concat(mv).slice(0, TRK_MAX); await settings.setSetting(TRK_KEY(o.id, vid), cur, { type: 'json', scope: 'laundromats' }); v.mvn = cur.mv.length; }
      }
      await save(list);
      return { isNew, ip, company: o.company, alert, bot: v.bot, id: o.id, vid };
    });
    if (!out) return res.status(404).json({ error: 'Nabídka nenalezena' });
    res.json({ ok: true });
    if (out.isNew && out.ip && !out.bot) { // poloha IP na pozadí
      setImmediate(async () => {
        try {
          const g = await require('../services/game/geo').dohledej(out.ip);
          if (g) await serial(async () => { const list = await load(); const o = list.find((x) => x.id === out.id); const v = o && (o.visits || []).find((x) => x.id === out.vid); if (v) { v.geo = { city: g.city || null, region: g.region || null, country: g.country || null, cc: g.cc || null, isp: g.isp || null, tip: g.tip || null }; await save(list); } });
        } catch (e) { /* bez polohy */ }
      });
    }
    if (out.alert) notifyBoss('↗️ Nabídka pro ' + out.company + ': nové zařízení', out.alert + (out.ip ? ' (IP ' + out.ip + ')' : ''));
  } catch (e) { next(e); }
});

// GET /:id/session/:vid — záznam pohybu jedné návštěvy (administrace, přehrání)
router.get('/:id(\\d+)/session/:vid([a-z0-9-]{6,40})', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.id === Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    const v = (o.visits || []).find((x) => x.id === req.params.vid);
    const t = await settings.getSetting(TRK_KEY(o.id, req.params.vid), { type: 'json', defaultValue: null }).catch(() => null);
    res.set('Cache-Control', 'no-store').json({ mv: (t && t.mv) || [], vw: v && v.vw, vh: v && v.vh, secs: v && v.secs });
  } catch (e) { next(e); }
});

// GET /public/:token/pdf — PDF nabídky (headless Chromium načte stránku ?print=1 z laundromats.eu), cache 10 min
const _pdfCache = new Map();
let _pdfBrowser = null;
router.get('/public/:token([a-f0-9]{32})/pdf', async (req, res, next) => {
  let page = null;
  try {
    const list = await load(); const o = list.find((x) => x.token === req.params.token);
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    const ck = 'v2:' + o.token + ':' + (o.updated_at || '') + ':' + (o.image_v || '');
    const slug = slugOf(o.company);
    const hdr = { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Nabidka-Laundromats-' + slug + '.pdf"', 'Cache-Control': 'no-store' };
    const hit = _pdfCache.get(ck);
    if (hit && Date.now() - hit.at < 600000) return res.set(hdr).send(hit.buf);
    const puppeteer = require('puppeteer');
    if (!_pdfBrowser || !_pdfBrowser.isConnected()) _pdfBrowser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'] });
    page = await _pdfBrowser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    await page.emulateMediaType('print');
    const base = String(process.env.LM_URL || 'https://laundromats.eu').replace(/\/$/, '');
    await page.goto(base + '/nabidka/' + slug + '/' + o.token + '?print=1', { waitUntil: 'networkidle0', timeout: 45000 });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
    // Hlavička a zápatí na každé straně (šablony Puppeteer: bez externích obrázků, logo jako inline SVG)
    const H = { cs: ['Obchodní návrh', 'Strana', 'z'], en: ['Business proposal', 'Page', 'of'], pl: ['Propozycja biznesowa', 'Strona', 'z'] }[o.lang] || ['Obchodní návrh', 'Strana', 'z'];
    const x = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const logo = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0b7fb8" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="2" width="18" height="20" rx="3"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2" fill="#0b7fb8"/></svg>';
    const headerTemplate = '<div style="width:100%;font-family:Arial,sans-serif;font-size:8.5px;color:#64748b;padding:0 18mm;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;color:#0f172a">' + logo + 'Laundromats<span style="color:#0b7fb8">.eu</span></span><span>' + x(H[0]) + ' · ' + x(o.company) + '</span></div>';
    const contact = [o.sender_name, o.sender_phone, o.reply_to].filter(Boolean).map(x).join(' · ');
    const footerTemplate = '<div style="width:100%;box-sizing:border-box;font-family:Arial,sans-serif;font-size:8px;color:#64748b;padding:0 18mm"><div style="display:flex;justify-content:space-between;border-top:1px solid #cbd5e1;padding-top:5px"><span>Laundromats.eu' + (contact ? ' · ' + contact : '') + '</span><span>' + x(H[1]) + ' <span class="pageNumber"></span> ' + x(H[2]) + ' <span class="totalPages"></span></span></div></div>';
    const buf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate, footerTemplate, margin: { top: '24mm', right: '18mm', bottom: '20mm', left: '18mm' } }));
    if (_pdfCache.size > 30) _pdfCache.clear();
    _pdfCache.set(ck, { at: Date.now(), buf });
    res.set(hdr).send(buf);
  } catch (e) { next(e); } finally { if (page) { try { await page.close(); } catch (e) { /* nic */ } } }
});

// ── Obrázek personalizovaného prádlomatu (v barvách firmy) — samostatně v AppSetting lm_corp_offer_img.<id> ──
const IMG_KEY = (id) => 'lm_corp_offer_img.' + id;
router.post('/:id(\\d+)/image', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.id === Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    const b = req.body || {}; const mime = String(b.mime || '');
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return res.status(400).json({ error: 'Obrázek musí být JPG, PNG nebo WEBP' });
    const data = String(b.data || '').replace(/^data:[^,]*,/, '');
    if (!data || data.length > 7.5 * 1024 * 1024) return res.status(400).json({ error: 'Obrázek je prázdný nebo větší než 5 MB' });
    await settings.setSetting(IMG_KEY(o.id), { mime, data }, { type: 'json', description: 'Laundromats – obrázek nabídky #' + o.id, scope: 'laundromats' });
    o.image_v = Date.now(); await save(list);
    res.json({ ok: true, offer: o });
  } catch (e) { next(e); }
});
router.delete('/:id(\\d+)/image', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.id === Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    await settings.setSetting(IMG_KEY(o.id), null, { type: 'json' }).catch(() => {});
    o.image_v = null; await save(list); res.json({ ok: true, offer: o });
  } catch (e) { next(e); }
});
router.get('/public/:token([a-f0-9]{32})/image', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.token === req.params.token);
    if (!o || !o.image_v) return res.status(404).end();
    const v = await settings.getSetting(IMG_KEY(o.id), { type: 'json', defaultValue: null }).catch(() => null);
    if (!v || !v.data) return res.status(404).end();
    res.set('Content-Type', v.mime || 'image/jpeg').set('Cache-Control', 'public, max-age=86400').send(Buffer.from(v.data, 'base64'));
  } catch (e) { next(e); }
});

module.exports = router;
