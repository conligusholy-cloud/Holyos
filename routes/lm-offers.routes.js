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
router.use(express.json({ limit: '200kb' }));
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
    points: o.points, perex: o.perex, refs: o.refs, model: o.model, units: o.units, unit_price: o.unit_price, monthly_revenue: o.monthly_revenue, valid_until: o.valid_until,
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
      points: s(b.points, 4000), perex: s(b.perex, 600), refs: s(b.refs, 3000), model: s(b.model, 80), units: num(b.units), unit_price: num(b.unit_price), monthly_revenue: num(b.monthly_revenue),
      valid_until: /^\d{4}-\d{2}-\d{2}$/.test(String(b.valid_until || '')) ? b.valid_until : null, note: s(b.note, 2000),
      sender_name: s(b.sender_name, 120), sender_phone: s(b.sender_phone, 40), reply_to: reply, updated_at: now,
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

// POST /public/:token/events — pohyb na stránce nabídky {visit, events:[{k, v}], scroll, secs, ua}
// k: section (viděná sekce), click (tlačítko/odkaz), video (přehrání), form (otevření/odeslání formuláře)
router.post('/public/:token([a-f0-9]{32})/events', async (req, res, next) => {
  try {
    const list = await load(); const o = list.find((x) => x.token === req.params.token);
    if (!o) return res.status(404).json({ error: 'Nabídka nenalezena' });
    const b = req.body || {}; const vid = s(b.visit, 40); if (!/^[a-z0-9-]{6,40}$/.test(vid)) return res.status(400).json({ error: 'Chybí návštěva' });
    o.visits = Array.isArray(o.visits) ? o.visits : [];
    let v = o.visits.find((x) => x.id === vid);
    const now = new Date().toISOString();
    if (!v) { v = { id: vid, at: now, last: now, secs: 0, scroll: 0, sections: [], clicks: [], videos: [], form: null, ua: s(b.ua, 160), device: /mobi|android|iphone/i.test(String(b.ua || '')) ? 'mobil' : 'počítač' }; o.visits.unshift(v); o.visits = o.visits.slice(0, 100); }
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
    await save(list);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
