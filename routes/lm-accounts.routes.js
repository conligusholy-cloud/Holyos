// HolyOS — účty registrovaných uživatelů laundromats.eu (LmAccount).
// Volá jen server Laundromats (servisní JWT podepsaný LM_SSO_SECRET, aud holyos-api, iss laundromats).
// Hesla: bcrypt. Tokeny pro ověření e-mailu / obnovu hesla: náhodné, v DB jen SHA-256 otisk.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));
router.use((req, res, next) => {
  const secret = process.env.LM_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); return next(); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
});

const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const pub = (a) => ({ id: a.id, lead_id: a.compounder_lead_id || null, email: a.email, name: a.name, phone: a.phone, company: a.company, plan: a.plan, v: a.token_version, verified: !!a.email_verified_at, created_at: a.created_at });
// Přístupy k nástrojům po jednotlivých účtech (přebíjí výchozí nastavení role) a interní poznámky správce.
// AppSetting lm_account_access = { "<id účtu>": { "<stránka>": true|false } }, lm_account_notes = { "<id>": "text" }.
// Marketplace lokalit nemá výchozí přístup v žádné roli — vidí ho jen ten, komu ho správce zapne.
const ACCESS_KEY = 'lm_account_access', NOTES_KEY = 'lm_account_notes';
const ACCESS_PAGES = ['podpora', 'compounder', 'pradlomaty', 'ekonomika', 'hledat', 'zhodnotit', 'marketplace'];
async function jsonSetting(key) { try { const v = await require('../services/settings').getSetting(key, { type: 'json', defaultValue: {} }); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }
const saveJson = (key, val, description) => require('../services/settings').setSetting(key, val, { type: 'json', description });
const pubMp = async (a) => { const acc = (await jsonSetting(ACCESS_KEY))[a.id] || {}; return Object.assign(pub(a), { access: acc, marketplace: acc.marketplace === true }); };
const pwErr = (p) => (String(p || '').length < 8 ? 'Heslo musí mít alespoň 8 znaků.' : String(p).length > 200 ? 'Heslo je příliš dlouhé.' : null);

// Spáruje / založí kontakt v CRM (CompounderLead), ať obchod účet vidí
async function linkLead(acc, sid) {
  try {
    const line = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' · Registrace účtu na laundromats.eu';
    let lead = await prisma.compounderLead.findFirst({ where: { email: { equals: acc.email, mode: 'insensitive' } }, select: { id: true, activity_log: true, phone: true } });
    if (lead) await prisma.compounderLead.update({ where: { id: lead.id }, data: { activity_log: line + (lead.activity_log ? '\n' + lead.activity_log : ''), phone: lead.phone || acc.phone || null } });
    else {
      const parts = acc.name.split(/\s+/);
      lead = await prisma.compounderLead.create({ data: { name: acc.name, first_name: parts[0] || null, last_name: parts.slice(1).join(' ') || null, email: acc.email, phone: acc.phone || null, company: acc.company || null, source: 'laundromats_account', status: 'new', role: 'compounder', lang: 'cs', activity_log: line }, select: { id: true } });
    }
    await prisma.lmAccount.update({ where: { id: acc.id }, data: { compounder_lead_id: lead.id } });
    if (sid && /^lm-[a-z0-9]{4,60}$/.test(String(sid))) {
      try { await require('./compounder.routes')._linkSidToLead(String(sid), lead.id); } catch (e) { /* volitelné */ }
    }
    prisma.compounderEvent.create({ data: { sid: String(sid || ('server:acc:' + acc.id)).slice(0, 64), event: 'account_register', path: '/cesta/registrace', props: { site: 'laundromats', lead_id: lead.id, account_id: acc.id } } }).catch(() => {});
    return lead.id;
  } catch (e) { console.warn('[lm-accounts] lead:', e.message); return null; }
}
async function notifyOwners(acc, leadId) {
  try {
    const { notifyPerson } = require('../services/push/expo-push');
    const { createNotification } = require('./notifications.routes');
    const title = '🆕 Nový účet na laundromats.eu';
    const body = acc.name + ' · ' + acc.email + (acc.phone ? ' · ' + acc.phone : '');
    const ps = await prisma.person.findMany({ where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Jan', 'Tomáš'], mode: 'insensitive' } }, select: { id: true, user_id: true } });
    for (const p of ps) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'lm_account', lead_id: leadId }, sound: 'default' }).catch(() => {});
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link: leadId ? '/modules/prodejni-objednavky/index.html?lead=' + leadId : undefined, meta: { lead_id: leadId } }).catch(() => {});
    }
  } catch (e) { console.warn('[lm-accounts] upozornění:', e.message); }
}

// POST /register {name,email,phone,company,password,sid} → { ok, verify_token, account }
router.post('/register', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = s(b.name, 120), email = s(b.email, 160).toLowerCase(), phone = s(b.phone, 40), company = s(b.company, 160);
    if (name.length < 2) return res.status(400).json({ error: 'Vyplňte jméno.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Zadejte platný e-mail.' });
    if (phone && phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Zadejte platný telefon.' });
    const pe = pwErr(b.password); if (pe) return res.status(400).json({ error: pe });
    const exist = await prisma.lmAccount.findUnique({ where: { email } });
    if (exist && exist.email_verified_at) return res.status(409).json({ error: 'Účet s tímto e-mailem už existuje. Přihlaste se, nebo si obnovte heslo.' });
    const token = newToken();
    const data = { name, phone: phone || null, company: company || null, password_hash: await bcrypt.hash(String(b.password), 12), verify_token_hash: sha(token) };
    const acc = exist ? await prisma.lmAccount.update({ where: { id: exist.id }, data }) : await prisma.lmAccount.create({ data: Object.assign({ email, plan: 'beginner' }, data) });
    const leadId = await linkLead(acc, b.sid);
    if (!exist) notifyOwners(acc, leadId);
    console.log('[lm-accounts] registrace #' + acc.id + (exist ? ' (znovu, neověřený)' : ''));
    res.json({ ok: true, verify_token: token, account: await pubMp(acc) });
  } catch (err) { next(err); }
});
// POST /verify {token} → ověří e-mail
router.post('/verify', async (req, res, next) => {
  try {
    const t = s((req.body || {}).token, 100); if (t.length < 20) return res.status(400).json({ error: 'Neplatný odkaz.' });
    const acc = await prisma.lmAccount.findFirst({ where: { verify_token_hash: sha(t) } });
    if (!acc || acc.disabled) return res.status(404).json({ error: 'Odkaz je neplatný nebo už byl použit.' });
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { email_verified_at: acc.email_verified_at || new Date(), verify_token_hash: null, last_login_at: new Date(), login_count: { increment: 1 } } });
    res.json({ ok: true, account: await pubMp(upd) });
  } catch (err) { next(err); }
});
// POST /login {email,password}
router.post('/login', async (req, res, next) => {
  try {
    const b = req.body || {}; const email = s(b.email, 160).toLowerCase();
    const acc = EMAIL_RE.test(email) ? await prisma.lmAccount.findUnique({ where: { email } }) : null;
    const ok = acc && !acc.disabled && !String(acc.password_hash || '').startsWith('!setup:') && await bcrypt.compare(String(b.password || ''), acc.password_hash).catch(() => false);
    if (!ok) return res.status(401).json({ error: 'Nesprávný e-mail nebo heslo.' });
    if (!acc.email_verified_at) {
      const token = newToken();
      await prisma.lmAccount.update({ where: { id: acc.id }, data: { verify_token_hash: sha(token) } });
      return res.status(403).json({ error: 'not_verified', verify_token: token, account: await pubMp(acc) });
    }
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { last_login_at: new Date(), login_count: { increment: 1 } } });
    res.json({ ok: true, account: await pubMp(upd) });
  } catch (err) { next(err); }
});
// POST /reset-request {email} → { ok, token? } (token jen pokud účet existuje — e-mail odešle Laundromats)
router.post('/reset-request', async (req, res, next) => {
  try {
    const email = s((req.body || {}).email, 160).toLowerCase();
    const acc = EMAIL_RE.test(email) ? await prisma.lmAccount.findUnique({ where: { email } }) : null;
    if (!acc || acc.disabled) return res.json({ ok: true });
    const token = newToken();
    await prisma.lmAccount.update({ where: { id: acc.id }, data: { reset_token_hash: sha(token), reset_expires_at: new Date(Date.now() + 3600e3) } });
    res.json({ ok: true, token, account: await pubMp(acc) });
  } catch (err) { next(err); }
});
// POST /reset {token,password} → nové heslo (odhlásí ostatní zařízení)
router.post('/reset', async (req, res, next) => {
  try {
    const b = req.body || {}; const t = s(b.token, 100);
    const pe = pwErr(b.password); if (pe) return res.status(400).json({ error: pe });
    const acc = t.length >= 20 ? await prisma.lmAccount.findFirst({ where: { reset_token_hash: sha(t) } }) : null;
    if (!acc || acc.disabled || !acc.reset_expires_at || acc.reset_expires_at < new Date()) return res.status(400).json({ error: 'Odkaz pro obnovu hesla je neplatný nebo vypršel.' });
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { password_hash: await bcrypt.hash(String(b.password), 12), reset_token_hash: null, reset_expires_at: null, token_version: { increment: 1 }, email_verified_at: acc.email_verified_at || new Date(), last_login_at: new Date() } });
    res.json({ ok: true, account: await pubMp(upd) });
  } catch (err) { next(err); }
});
// GET /:id/session?v= → platnost relace (účet existuje, není zablokovaný, verze tokenu sedí)
router.get('/:id(\\d+)/session', async (req, res, next) => {
  try {
    const acc = await prisma.lmAccount.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!acc || acc.disabled || !acc.email_verified_at || String(acc.token_version) !== String(req.query.v)) return res.status(401).json({ error: 'Relace neplatná' });
    res.json({ ok: true, account: await pubMp(acc) });
  } catch (err) { next(err); }
});
// POST /:id/profile {name,phone,company}
router.post('/:id(\\d+)/profile', async (req, res, next) => {
  try {
    const b = req.body || {}; const name = s(b.name, 120), phone = s(b.phone, 40), company = s(b.company, 160);
    if (name.length < 2) return res.status(400).json({ error: 'Vyplňte jméno.' });
    const upd = await prisma.lmAccount.update({ where: { id: parseInt(req.params.id, 10) }, data: { name, phone: phone || null, company: company || null } });
    res.json({ ok: true, account: await pubMp(upd) });
  } catch (err) { next(err); }
});
// POST /:id/password {old,password} → změna hesla (odhlásí ostatní zařízení)
router.post('/:id(\\d+)/password', async (req, res, next) => {
  try {
    const b = req.body || {}; const pe = pwErr(b.password); if (pe) return res.status(400).json({ error: pe });
    const acc = await prisma.lmAccount.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!acc || !(await bcrypt.compare(String(b.old || ''), acc.password_hash))) return res.status(400).json({ error: 'Současné heslo nesouhlasí.' });
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { password_hash: await bcrypt.hash(String(b.password), 12), token_version: { increment: 1 } } });
    res.json({ ok: true, account: await pubMp(upd) });
  } catch (err) { next(err); }
});

// GET /list — přehled účtů pro administraci Laundromats (záložka Uživatelé)
router.get('/list', async (req, res, next) => {
  try {
    const rows = await prisma.lmAccount.findMany({ orderBy: { created_at: 'desc' }, take: 2000,
      select: { id: true, email: true, name: true, phone: true, company: true, plan: true, disabled: true, email_verified_at: true, last_login_at: true, login_count: true, compounder_lead_id: true, created_at: true, password_hash: true } });
    // Kdo zákazníkovi poslal odkaz na Ekonomiku (aplikace Obchodník) — první odeslání ke kontaktu
    const lids = [...new Set(rows.map((r) => r.compounder_lead_id).filter(Boolean))];
    const sent = lids.length ? await prisma.compounderEvent.findMany({ where: { event: 'economy_link_sent', OR: lids.map((id) => ({ props: { path: ['lead_id'], equals: id } })) }, orderBy: { created_at: 'asc' }, select: { props: true, created_at: true }, take: 5000 }).catch(() => []) : [];
    const inv = new Map(); sent.forEach((e) => { const p = e.props || {}; const k = Number(p.lead_id); if (!inv.has(k)) inv.set(k, { by: p.by || null, channel: p.channel || null, at: e.created_at, count: 0 }); inv.get(k).count++; inv.get(k).last_at = e.created_at; });
    const accAll = await jsonSetting(ACCESS_KEY), notes = await jsonSetting(NOTES_KEY);
    res.json({ ok: true, users: rows.map((r) => { const { password_hash, ...u } = r; const ac = accAll[r.id] || {}; return Object.assign(u, { access: ac, marketplace: ac.marketplace === true, admin_note: notes[r.id] || '', pending_password: String(password_hash || '').startsWith('!setup:'), invited: r.compounder_lead_id ? (inv.get(r.compounder_lead_id) || null) : null }); }) });
  } catch (err) { next(err); }
});
// POST /:id/disabled {disabled} — zablokovat / odblokovat účet (zablokovaný se odhlásí do 5 minut)
// POST /:id/plan {plan} — role uživatele: beginner (Začátečník) | economy (Ekonomika) | full (Plný přístup)
router.post('/:id(\\d+)/plan', async (req, res, next) => {
  try {
    const plan = String((req.body || {}).plan || '');
    if (!['beginner', 'economy', 'full'].includes(plan)) return res.status(400).json({ error: 'Neznámá role' });
    const upd = await prisma.lmAccount.update({ where: { id: parseInt(req.params.id, 10) }, data: { plan }, select: { id: true, plan: true } });
    res.json({ ok: true, plan: upd.plan });
  } catch (err) { next(err); }
});
// GET /marketplace — zveřejněné lokality pro Marketplace (zdroj: HolyOS Lokality → záložka Marketplace).
// Jen veřejná pole; poloha zaokrouhlená (~1 km), bez adresy a vlastníka.
router.get('/marketplace', async (req, res, next) => {
  try {
    const all = await jsonSetting('site_marketplace');
    const ids = Object.keys(all).filter((k) => all[k] && all[k].published).map(Number);
    if (!ids.length) return res.json({ ok: true, items: [] });
    const sites = await prisma.site.findMany({ where: { id: { in: ids } }, select: { id: true, city: true, country: true, latitude: true, longitude: true, area_m2: true, rent_monthly: true, rent_currency: true } });
    const by = new Map(sites.map((x) => [x.id, x]));
    const r2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
    const items = ids.filter((id) => by.has(id)).map((id) => { const m = all[id], x = by.get(id);
      return { code: 'L' + id, name: m.title, highlight: m.highlight || null, description: m.description || null, city: x.city, country: x.country,
        lat: r2(x.latitude), lon: r2(x.longitude), area_m2: m.area_m2 != null ? m.area_m2 : (x.area_m2 != null ? Number(x.area_m2) : null),
        rent_monthly: m.rent_monthly != null ? m.rent_monthly : (x.rent_monthly != null ? Number(x.rent_monthly) : null), rent_currency: x.rent_currency || 'CZK',
        price_note: m.price_note || null, availability: m.availability || null, parking: m.parking || null, footfall: m.footfall || null,
        image_url: m.image_url || null, photo: !!m.photo_id, reserved: !!m.reserved, updated_at: m.updated_at || null };
    }).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    res.json({ ok: true, items });
  } catch (err) { next(err); }
});
// GET /marketplace/photo/:siteId — vybraná fotka lokality pro Marketplace (Laundromats ji proxuje přihlášeným)
router.get('/marketplace/photo/:sid(\\d+)', async (req, res, next) => {
  try {
    const sid = parseInt(req.params.sid, 10), m = (await jsonSetting('site_marketplace'))[sid];
    if (!m || !m.published || !m.photo_id) return res.status(404).end();
    const ph = await prisma.sitePhoto.findUnique({ where: { id: Number(m.photo_id) } });
    if (!ph || ph.site_id !== sid) return res.status(404).end();
    const path = require('path'), fs = require('fs');
    const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'site-photos');
    const file = path.join(dir, path.basename(String(ph.file_path || (ph.url || '').split('/').pop() || '')));
    if (!file.startsWith(dir) || !fs.existsSync(file)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600'); if (ph.mime_type) res.type(ph.mime_type);
    res.sendFile(file);
  } catch (err) { next(err); }
});
// POST /:id/access {page, on|null} — přístup k nástroji (null = podle role). Projeví se do 5 minut.
async function setAccess(id, page, on) {
  const all = await jsonSetting(ACCESS_KEY); const cur = Object.assign({}, all[id] || {});
  if (on === null) delete cur[page]; else cur[page] = !!on;
  if (Object.keys(cur).length) all[id] = cur; else delete all[id];
  await saveJson(ACCESS_KEY, all, 'Laundromats — přístupy k nástrojům po účtech (přebíjí roli)');
  return cur;
}
router.post('/:id(\\d+)/access', async (req, res, next) => {
  try {
    const b = req.body || {}, page = String(b.page || '');
    if (!ACCESS_PAGES.includes(page)) return res.status(400).json({ error: 'Neznámý nástroj' });
    res.json({ ok: true, access: await setAccess(parseInt(req.params.id, 10), page, b.on === null || b.on === undefined ? null : !!b.on) });
  } catch (err) { next(err); }
});
// POST /:id/marketplace {on} — zkratka pro sloupec v tabulce uživatelů
router.post('/:id(\\d+)/marketplace', async (req, res, next) => {
  try { const on = !!(req.body || {}).on; await setAccess(parseInt(req.params.id, 10), 'marketplace', on); res.json({ ok: true, marketplace: on }); } catch (err) { next(err); }
});
// POST /:id/note {note} — interní poznámka správce k účtu (uživatel ji nevidí)
router.post('/:id(\\d+)/note', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10), note = s((req.body || {}).note, 5000);
    const all = await jsonSetting(NOTES_KEY); if (note) all[id] = note; else delete all[id];
    await saveJson(NOTES_KEY, all, 'Laundromats — interní poznámky správce k účtům');
    res.json({ ok: true, note });
  } catch (err) { next(err); }
});
router.post('/:id(\\d+)/disabled', async (req, res, next) => {
  try {
    const upd = await prisma.lmAccount.update({ where: { id: parseInt(req.params.id, 10) }, data: { disabled: !!(req.body || {}).disabled, token_version: { increment: 1 } }, select: { id: true, disabled: true } });
    res.json({ ok: true, disabled: upd.disabled });
  } catch (err) { next(err); }
});

// POST /:id/link-sid {sids:[…]} — prohlížeč(e) přihlášeného uživatele napojit na jeho kontakt (celá historie návštěv)
router.post('/:id(\\d+)/link-sid', async (req, res, next) => {
  try {
    const acc = await prisma.lmAccount.findUnique({ where: { id: parseInt(req.params.id, 10) }, select: { compounder_lead_id: true } });
    if (!acc || !acc.compounder_lead_id) return res.json({ ok: false });
    const sids = [].concat((req.body || {}).sids || []).map(String).filter((x) => /^lm-[a-z0-9]{4,60}$/.test(x)).slice(0, 5);
    const link = require('./compounder.routes')._linkSidToLead;
    for (const sid of sids) await link(sid, acc.compounder_lead_id).catch(() => {});
    res.json({ ok: true, linked: sids.length });
  } catch (err) { next(err); }
});
// GET /:id/activity — veškerý pohyb uživatele na laundromats.eu (události kontaktu + napojených prohlížečů)
router.get('/:id(\\d+)/activity', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const acc = await prisma.lmAccount.findUnique({ where: { id }, select: { id: true, compounder_lead_id: true } });
    if (!acc) return res.status(404).json({ error: 'Účet nenalezen' });
    const lid = acc.compounder_lead_id;
    const or = [{ props: { path: ['account_id'], equals: id } }];
    if (lid) {
      or.push({ props: { path: ['lead_id'], equals: lid } });
      const linked = await prisma.compounderEvent.findMany({ where: { event: 'lead_linked', props: { path: ['lead_id'], equals: lid } }, select: { sid: true }, distinct: ['sid'], take: 30 });
      linked.forEach((x) => { if (x.sid) or.push({ sid: x.sid }); });
    }
    const events = (await prisma.compounderEvent.findMany({ where: { OR: or }, orderBy: { created_at: 'desc' }, take: 1500, select: { event: true, props: true, path: true, created_at: true, sid: true, ua: true } })).reverse();
    res.json({ ok: true, lead_id: lid, events: events.map((e) => ({ event: e.event, props: e.props, path: e.path, at: e.created_at, sid: e.sid, mobile: /Mobi|Android|iPhone/i.test(e.ua || '') })) });
  } catch (err) { next(err); }
});

// POST /setup-info {token} → { email, name, phone, needs_email, needs_phone }
// Kontrola odkazu „dokončit účet" (heslo ještě nenastavené). `needs_*` říká Laundromats,
// které údaje musí zákazník na aktivační stránce doplnit — účet mohl vzniknout
// u kontaktu, u kterého jsme e-mail ani telefon neměli.
router.post('/setup-info', async (req, res, next) => {
  try {
    const t = s((req.body || {}).token, 100);
    const acc = t.length >= 20 ? await prisma.lmAccount.findFirst({ where: { reset_token_hash: sha(t) }, select: { email: true, name: true, phone: true, reset_expires_at: true, disabled: true } }) : null;
    if (!acc || acc.disabled || !acc.reset_expires_at || acc.reset_expires_at < new Date()) return res.status(404).json({ error: 'Odkaz už byl použit nebo vypršel.' });
    res.json({ ok: true, email: acc.email || '', name: acc.name || '', phone: acc.phone || '', needs_email: !acc.email, needs_phone: !acc.phone });
  } catch (err) { next(err); }
});

// POST /setup-complete {token, email, phone, name, password} → dokončení účtu z odkazu.
// Oproti /reset umí doplnit chybějící e-mail (= přihlašovací jméno) a telefon a zapsat je
// zpátky ke kontaktu v CRM. Údaje, které účet už má, se odsud nepřepisují.
router.post('/setup-complete', async (req, res, next) => {
  try {
    const b = req.body || {}; const t = s(b.token, 100);
    const acc = t.length >= 20 ? await prisma.lmAccount.findFirst({ where: { reset_token_hash: sha(t) } }) : null;
    if (!acc || acc.disabled || !acc.reset_expires_at || acc.reset_expires_at < new Date()) return res.status(400).json({ error: 'Odkaz už byl použit nebo vypršel.' });

    const data = {};
    // E-mail = přihlašovací jméno. Doplňuje se jen tehdy, když ho účet ještě nemá.
    if (!acc.email) {
      const email = s(b.email, 160).toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Vyplňte prosím platný e-mail — bude to vaše přihlašovací jméno.' });
      const obsazeno = await prisma.lmAccount.findUnique({ where: { email }, select: { id: true } });
      if (obsazeno && obsazeno.id !== acc.id) return res.status(409).json({ error: 'Tento e-mail už je u nás registrovaný. Přihlaste se k původnímu účtu, nebo použijte jiný e-mail.' });
      data.email = email;
    }
    // Telefon — povinný, pokud ho u účtu nemáme.
    if (!acc.phone) {
      const phone = s(b.phone, 40);
      if (String(phone).replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Vyplňte prosím telefonní číslo.' });
      data.phone = phone;
    }
    const name = s(b.name, 120);
    if (name) data.name = name;

    const pe = pwErr(b.password); if (pe) return res.status(400).json({ error: pe });
    Object.assign(data, {
      password_hash: await bcrypt.hash(String(b.password), 12),
      reset_token_hash: null, reset_expires_at: null,
      token_version: { increment: 1 },
      email_verified_at: acc.email_verified_at || new Date(),
      last_login_at: new Date(),
    });
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data });

    // Doplněné údaje zpátky ke kontaktu v CRM — ať je obchod má u sebe.
    if (acc.compounder_lead_id && (data.email || data.phone)) {
      try {
        const lead = await prisma.compounderLead.findUnique({ where: { id: acc.compounder_lead_id }, select: { email: true, phone: true, activity_log: true } });
        if (lead) {
          const zmeny = {};
          if (data.email && !lead.email) zmeny.email = data.email;
          if (data.phone && !lead.phone) zmeny.phone = data.phone;
          if (Object.keys(zmeny).length) {
            const popis = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' · Zákazník doplnil při aktivaci účtu: ' + Object.keys(zmeny).map((k) => (k === 'email' ? 'e-mail' : 'telefon')).join(', ');
            await prisma.compounderLead.update({ where: { id: acc.compounder_lead_id }, data: Object.assign(zmeny, { activity_log: popis + (lead.activity_log ? '\n' + lead.activity_log : '') }) });
          }
        }
      } catch (e) { console.warn('[lm-accounts] doplnění kontaktu:', e.message); }
    }
    res.json({ ok: true, account: await pubMp(upd) });
  } catch (err) { next(err); }
});

module.exports = router;

// Účet laundromats.eu pro kontakt, kterému posíláme odkaz na Ekonomiku (aplikace Obchodník).
// Neexistuje → založí se s rolí Ekonomika a bez hesla; vrátí jednorázový token, se kterým si zákazník heslo nastaví
// (/cesta/aktivace, platí 30 dní). Existuje → povýší roli Začátečník na Ekonomika; token jen když heslo ještě nemá.
const SETUP_PREFIX = '!setup:';
module.exports.ensureAccountForLead = async function ensureAccountForLead(lead) {
  const email = s(lead && lead.email, 160).toLowerCase();
  const maEmail = EMAIL_RE.test(email);
  // Účet vzniká i bez e-mailu a bez telefonu — zákazník si je doplní na aktivačním
  // odkazu (/cesta/aktivace), kde si zároveň nastaví heslo. Bez e-mailu hledáme
  // existující účet podle kontaktu, ať z opakovaného odeslání odkazu nevznikne druhý.
  let acc = maEmail
    ? await prisma.lmAccount.findUnique({ where: { email } })
    : await prisma.lmAccount.findFirst({ where: { compounder_lead_id: lead.id }, orderBy: { created_at: 'desc' } });
  const name = s(lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || (maEmail ? email : '') || s(lead.phone, 40) || 'Zákazník', 120);
  let created = false;
  if (!acc) {
    acc = await prisma.lmAccount.create({ data: { email: maEmail ? email : null, name, phone: s(lead.phone, 40) || null, password_hash: SETUP_PREFIX + crypto.randomBytes(12).toString('hex'), plan: 'economy', compounder_lead_id: lead.id } });
    created = true;
  } else {
    const data = {};
    if (!acc.plan || acc.plan === 'free' || acc.plan === 'beginner') data.plan = 'economy';
    if (!acc.compounder_lead_id) data.compounder_lead_id = lead.id;
    // Co jsme se o kontaktu mezitím dozvěděli, doplníme (nikdy nepřepisujeme vyplněné).
    if (!acc.email && maEmail) data.email = email;
    if (!acc.phone && s(lead.phone, 40)) data.phone = s(lead.phone, 40);
    if (Object.keys(data).length) acc = await prisma.lmAccount.update({ where: { id: acc.id }, data });
  }
  if (acc.disabled) return { ok: false, reason: 'disabled' };
  const needsPassword = String(acc.password_hash || '').startsWith(SETUP_PREFIX);
  let token = null;
  if (needsPassword) {
    token = newToken();
    await prisma.lmAccount.update({ where: { id: acc.id }, data: { reset_token_hash: sha(token), reset_expires_at: new Date(Date.now() + 30 * 86400e3) } });
  }
  // Co po zákazníkovi bude aktivační stránka chtít — ať to obchodník ví dopředu.
  return { ok: true, created, needsPassword, token, account_id: acc.id, plan: acc.plan, needs_email: !acc.email, needs_phone: !acc.phone };
};
