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
const pub = (a) => ({ id: a.id, email: a.email, name: a.name, phone: a.phone, company: a.company, plan: a.plan, v: a.token_version, verified: !!a.email_verified_at, created_at: a.created_at });
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
    const acc = exist ? await prisma.lmAccount.update({ where: { id: exist.id }, data }) : await prisma.lmAccount.create({ data: Object.assign({ email }, data) });
    const leadId = await linkLead(acc, b.sid);
    if (!exist) notifyOwners(acc, leadId);
    console.log('[lm-accounts] registrace #' + acc.id + (exist ? ' (znovu, neověřený)' : ''));
    res.json({ ok: true, verify_token: token, account: pub(acc) });
  } catch (err) { next(err); }
});
// POST /verify {token} → ověří e-mail
router.post('/verify', async (req, res, next) => {
  try {
    const t = s((req.body || {}).token, 100); if (t.length < 20) return res.status(400).json({ error: 'Neplatný odkaz.' });
    const acc = await prisma.lmAccount.findFirst({ where: { verify_token_hash: sha(t) } });
    if (!acc || acc.disabled) return res.status(404).json({ error: 'Odkaz je neplatný nebo už byl použit.' });
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { email_verified_at: acc.email_verified_at || new Date(), verify_token_hash: null, last_login_at: new Date(), login_count: { increment: 1 } } });
    res.json({ ok: true, account: pub(upd) });
  } catch (err) { next(err); }
});
// POST /login {email,password}
router.post('/login', async (req, res, next) => {
  try {
    const b = req.body || {}; const email = s(b.email, 160).toLowerCase();
    const acc = EMAIL_RE.test(email) ? await prisma.lmAccount.findUnique({ where: { email } }) : null;
    const ok = acc && !acc.disabled && await bcrypt.compare(String(b.password || ''), acc.password_hash);
    if (!ok) return res.status(401).json({ error: 'Nesprávný e-mail nebo heslo.' });
    if (!acc.email_verified_at) {
      const token = newToken();
      await prisma.lmAccount.update({ where: { id: acc.id }, data: { verify_token_hash: sha(token) } });
      return res.status(403).json({ error: 'not_verified', verify_token: token, account: pub(acc) });
    }
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { last_login_at: new Date(), login_count: { increment: 1 } } });
    res.json({ ok: true, account: pub(upd) });
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
    res.json({ ok: true, token, account: pub(acc) });
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
    res.json({ ok: true, account: pub(upd) });
  } catch (err) { next(err); }
});
// GET /:id/session?v= → platnost relace (účet existuje, není zablokovaný, verze tokenu sedí)
router.get('/:id(\\d+)/session', async (req, res, next) => {
  try {
    const acc = await prisma.lmAccount.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!acc || acc.disabled || !acc.email_verified_at || String(acc.token_version) !== String(req.query.v)) return res.status(401).json({ error: 'Relace neplatná' });
    res.json({ ok: true, account: pub(acc) });
  } catch (err) { next(err); }
});
// POST /:id/profile {name,phone,company}
router.post('/:id(\\d+)/profile', async (req, res, next) => {
  try {
    const b = req.body || {}; const name = s(b.name, 120), phone = s(b.phone, 40), company = s(b.company, 160);
    if (name.length < 2) return res.status(400).json({ error: 'Vyplňte jméno.' });
    const upd = await prisma.lmAccount.update({ where: { id: parseInt(req.params.id, 10) }, data: { name, phone: phone || null, company: company || null } });
    res.json({ ok: true, account: pub(upd) });
  } catch (err) { next(err); }
});
// POST /:id/password {old,password} → změna hesla (odhlásí ostatní zařízení)
router.post('/:id(\\d+)/password', async (req, res, next) => {
  try {
    const b = req.body || {}; const pe = pwErr(b.password); if (pe) return res.status(400).json({ error: pe });
    const acc = await prisma.lmAccount.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!acc || !(await bcrypt.compare(String(b.old || ''), acc.password_hash))) return res.status(400).json({ error: 'Současné heslo nesouhlasí.' });
    const upd = await prisma.lmAccount.update({ where: { id: acc.id }, data: { password_hash: await bcrypt.hash(String(b.password), 12), token_version: { increment: 1 } } });
    res.json({ ok: true, account: pub(upd) });
  } catch (err) { next(err); }
});

module.exports = router;
