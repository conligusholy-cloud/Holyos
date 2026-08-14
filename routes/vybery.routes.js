// =============================================================================
// HolyOS — Výběry (withdrawals)
// Veřejná stránka bestseries.cash/vybery: zákazník zadá e-mail, ověří se proti
// Black listu (compounder_blocklist = seznam OPRÁVNĚNÝCH osob k výběru), a když
// je oprávněn, přijde mu magic-link do jeho účtu, kde podává požadavky a vidí stavy.
// Admin (heslo z env) spravuje požadavky a jejich stavy v pipeline.
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { prisma } = require('../config/database');
const { sendMail } = require('../services/email');

// ── Stavy výběru (pipeline dle zadání) ──────────────────────────────────────
const STATUSES = [
  'novy', 'hledani_pohybu', 'parovani', 'parovani_platby', 'platba_prirazena',
  'autorizace', 'rucni_kontrola', 'platebni_prikaz', 'vyplaceni', 'vyplaceno', 'zamitnuto',
];
const STATUS_LABELS = {
  novy: 'Nový požadavek', hledani_pohybu: 'Hledání pohybu', parovani: 'Párování',
  parovani_platby: 'Párování platby', platba_prirazena: 'Platba přiřazena',
  autorizace: 'Autorizace', rucni_kontrola: 'Ruční kontrola', platebni_prikaz: 'Platební příkaz',
  vyplaceni: 'Vyplácení', vyplaceno: 'Vyplaceno', zamitnuto: 'Zamítnuto',
};

// ── Tokeny (HMAC) ───────────────────────────────────────────────────────────
function secret() { return process.env.COMPOUNDER_TOKEN_SECRET || process.env.JWT_SECRET || 'holyos-vybery-secret'; }
function sig(payload) { return crypto.createHmac('sha256', secret()).update(payload).digest('base64url'); }
function safeEq(a, b) {
  const ba = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

// Zákaznický token: b64(email).exp.sig — default 30 dní.
function makeCustomerToken(email, ttlMs) {
  const em = normEmail(email);
  const b = Buffer.from(em).toString('base64url');
  const exp = Date.now() + (ttlMs || 30 * 24 * 3600 * 1000);
  return b + '.' + exp + '.' + sig('vybery:' + em + ':' + exp);
}
function verifyCustomerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const p = token.split('.');
  if (p.length !== 3) return null;
  let em = '';
  try { em = Buffer.from(p[0], 'base64url').toString('utf8'); } catch (e) { return null; }
  const exp = Number(p[1]);
  if (!em || !Number.isInteger(exp) || Date.now() > exp) return null;
  return safeEq(p[2], sig('vybery:' + em + ':' + exp)) ? em : null;
}
// Admin token: 'a'.exp.sig — default 12 h.
function makeAdminToken(ttlMs) {
  const exp = Date.now() + (ttlMs || 12 * 3600 * 1000);
  return 'a.' + exp + '.' + sig('vybery-admin:' + exp);
}
function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const p = token.split('.');
  if (p.length !== 3 || p[0] !== 'a') return false;
  const exp = Number(p[1]);
  if (!Number.isInteger(exp) || Date.now() > exp) return false;
  return safeEq(p[2], sig('vybery-admin:' + exp));
}

// ── Oprávnění: e-mail musí být v Black listu (compounder_blocklist) ──────────
async function isAuthorized(email) {
  const em = normEmail(email);
  if (!em) return false;
  try {
    const rows = await prisma.compounderBlocklist.findMany({ select: { email: true } });
    return rows.some((r) => normEmail(r.email) === em);
  } catch (e) { return false; }
}

function baseUrl() { return (process.env.SHARE_BASE_URL || process.env.VYBERY_BASE_URL || 'https://bestseries.cash').replace(/\/+$/, ''); }

// ── VEŘEJNÉ: žádost o přístup — ověří e-mail a pošle magic-link ─────────────
router.post('/request-access', async (req, res, next) => {
  try {
    const email = normEmail(req.body && req.body.email);
    if (!email || email.indexOf('@') < 0) return res.status(400).json({ ok: false, error: 'Zadejte platný e-mail.' });
    const ok = await isAuthorized(email);
    if (!ok) return res.json({ ok: true, authorized: false });
    // Oprávněn → pošli odkaz do účtu.
    const token = makeCustomerToken(email);
    const link = baseUrl() + '/vybery?t=' + encodeURIComponent(token);
    const from = process.env.VYBERY_MAIL_FROM || process.env.COMPOUNDER_MAIL_FROM || null;
    let sent = false;
    if (from) {
      try {
        await sendMail({
          to: email, from,
          fromName: process.env.VYBERY_MAIL_FROM_NAME || 'Best Series Výběry',
          replyTo: from,
          brand: 'vybery',
          subject: 'Přístup k výběrům — Best Series',
          preheader: 'Odkaz k zadání a přehledu vašich výběrů.',
          body: 'Dobrý den,\n\nk zadání a přehledu vašich požadavků na výběr použijte tlačítko níže. Odkaz je platný 30 dní a je určen jen pro vás.\n\nPokud jste o přístup nežádali, e-mail ignorujte.',
          link, linkLabel: 'Otevřít mé výběry',
        });
        sent = true;
      } catch (e) { console.error('[vybery] Odeslání e-mailu selhalo:', e.message); }
    } else {
      console.warn('[vybery] Chybí VYBERY_MAIL_FROM/COMPOUNDER_MAIL_FROM — e-mail neodeslán. Odkaz:', link);
    }
    res.json({ ok: true, authorized: true, sent });
  } catch (err) { next(err); }
});

// ── VEŘEJNÉ: můj účet — seznam mých výběrů (token) ──────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const email = verifyCustomerToken(String(req.query.t || ''));
    if (!email) return res.status(401).json({ ok: false, error: 'Neplatný nebo prošlý odkaz.' });
    const rows = await prisma.withdrawalRequest.findMany({
      where: { email }, orderBy: { created_at: 'desc' }, take: 500,
      select: { id: true, amount: true, withdrawal_number: true, note: true, status: true, created_at: true, updated_at: true },
    });
    res.json({ ok: true, email, statuses: STATUS_LABELS, requests: rows });
  } catch (err) { next(err); }
});

// ── VEŘEJNÉ: podání nového požadavku na výběr ───────────────────────────────
router.post('/me/request', async (req, res, next) => {
  try {
    const b = req.body || {};
    const email = verifyCustomerToken(String(b.t || ''));
    if (!email) return res.status(401).json({ ok: false, error: 'Neplatný nebo prošlý odkaz.' });
    const amount = (b.amount === '' || b.amount == null) ? null : Number(b.amount);
    if (amount != null && (!isFinite(amount) || amount < 0)) return res.status(400).json({ ok: false, error: 'Neplatná částka.' });
    const withdrawal_number = String(b.withdrawal_number || '').trim().slice(0, 120) || null;
    const note = String(b.note || '').trim().slice(0, 2000) || null;
    if (amount == null && !withdrawal_number && !note) return res.status(400).json({ ok: false, error: 'Vyplňte alespoň částku nebo číslo výběru.' });
    const now = new Date().toISOString();
    const created = await prisma.withdrawalRequest.create({
      data: {
        email, amount, withdrawal_number, note, status: 'novy',
        status_log: [{ at: now, status: 'novy', by: 'zákazník' }],
      },
      select: { id: true, amount: true, withdrawal_number: true, note: true, status: true, created_at: true, updated_at: true },
    });
    // Notifikace do adminu (volitelně e-mailem provozovateli).
    try {
      const admTo = process.env.VYBERY_NOTIFY_TO; const from = process.env.VYBERY_MAIL_FROM || process.env.COMPOUNDER_MAIL_FROM || null;
      if (admTo && from) {
        await sendMail({ to: admTo, from, fromName: process.env.VYBERY_MAIL_FROM_NAME || 'Best Series Výběry', brand: 'vybery', subject: 'Nový požadavek na výběr', body: `Nový výběr od ${email}\nČástka: ${amount != null ? amount : '—'}\nČíslo výběru: ${withdrawal_number || '—'}\nPoznámka: ${note || '—'}` });
      }
    } catch (e) { /* notifikace neblokuje */ }
    res.status(201).json({ ok: true, request: created });
  } catch (err) { next(err); }
});

// ── ADMIN: přihlášení heslem (env VYBERY_ADMIN_PASSWORD) ────────────────────
router.post('/admin/login', async (req, res, next) => {
  try {
    const pw = String((req.body && req.body.password) || '');
    const expected = process.env.VYBERY_ADMIN_PASSWORD || '';
    if (!expected) return res.status(503).json({ ok: false, error: 'Admin není nakonfigurován (chybí VYBERY_ADMIN_PASSWORD).' });
    if (!pw || !safeEq(pw, expected)) return res.status(401).json({ ok: false, error: 'Neplatné heslo.' });
    res.json({ ok: true, token: makeAdminToken() });
  } catch (err) { next(err); }
});

function requireAdmin(req, res) {
  const tok = String((req.query && req.query.token) || (req.body && req.body.token) || req.headers['x-vybery-admin'] || '');
  if (!verifyAdminToken(tok)) { res.status(401).json({ ok: false, error: 'Nepřihlášeno.' }); return false; }
  return true;
}

// ── ADMIN: seznam požadavků ─────────────────────────────────────────────────
router.get('/admin/list', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const where = {};
    if (req.query.status && STATUSES.includes(String(req.query.status))) where.status = String(req.query.status);
    if (req.query.search) {
      const q = String(req.query.search);
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { withdrawal_number: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.withdrawalRequest.findMany({ where, orderBy: { created_at: 'desc' }, take: 1000 });
    res.json({ ok: true, statuses: STATUS_LABELS, statusOrder: STATUSES, requests: rows });
  } catch (err) { next(err); }
});

// ── ADMIN: změna stavu ──────────────────────────────────────────────────────
router.post('/admin/:id/status', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'Neplatné ID' });
    const status = String((req.body && req.body.status) || '');
    if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Neplatný stav.' });
    const cur = await prisma.withdrawalRequest.findUnique({ where: { id }, select: { status_log: true } });
    if (!cur) return res.status(404).json({ ok: false, error: 'Nenalezeno' });
    const log = Array.isArray(cur.status_log) ? cur.status_log : [];
    log.unshift({ at: new Date().toISOString(), status, by: 'admin' });
    const updated = await prisma.withdrawalRequest.update({ where: { id }, data: { status, status_log: log } });
    res.json({ ok: true, request: updated });
  } catch (err) { next(err); }
});

module.exports = router;
