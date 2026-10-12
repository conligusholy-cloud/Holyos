// HolyOS — Softwarová podpora strojů: měsíční automatická fakturace (cs/en).
// Připojeno pod /api/compounder/software-subscriptions (viz compounder.routes.js).
'use strict';
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const schema = z.object({
  kiosk_code: z.string().min(1).max(40),
  contract_number: z.string().max(80).optional().nullable(),
  company_id: z.number().int().optional().nullable(),
  buyer_ico: z.string().max(20).optional().nullable(),
  buyer_dic: z.string().max(30).optional().nullable(),
  customer_name: z.string().max(255).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  amount: z.number().min(0).optional(),
  currency: z.string().max(3).optional(),
  vat_regime: z.enum(['standard', 'reverse_charge', 'outside_scope']).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  language: z.enum(['cs', 'en']).optional(),
  active: z.boolean().optional(),
  auto_send: z.boolean().optional(),
  billing_day: z.number().int().min(1).max(28).optional(),
  note: z.string().max(2000).optional().nullable(),
});

// Bankovní účty pro fakturaci (CZK / EUR) — používají se i u servisních faktur.
router.get('/accounts', async (req, res, next) => {
  try { res.json(await require('../services/accountant/billing-accounts').getAccounts()); } catch (err) { next(err); }
});
router.put('/accounts', async (req, res, next) => {
  try {
    const f = z.object({ account: z.string().max(60).optional().nullable(), iban: z.string().max(40).optional().nullable(), bic: z.string().max(20).optional().nullable() }).optional();
    const p = z.object({ CZK: f, EUR: f }).safeParse(req.body || {});
    if (!p.success) return res.status(400).json({ error: 'Neplatná data' });
    const ba = require('../services/accountant/billing-accounts');
    const v = ba.normalize(p.data);
    if (v.EUR.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v.EUR.iban)) return res.status(400).json({ error: 'EUR účet: neplatný IBAN.' });
    if (v.CZK.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v.CZK.iban)) return res.status(400).json({ error: 'CZK účet: neplatný IBAN.' });
    res.json(await ba.setAccounts(v, req.user && req.user.id));
  } catch (err) { next(err); }
});

// GET /api/compounder/software-subscriptions
router.get('/', async (req, res, next) => {
  try {
    res.json(await prisma.softwareSubscription.findMany({ orderBy: { created_at: 'desc' } }));
  } catch (err) { next(err); }
});

// POST — vytvoření/upsert dle kódu stroje
router.post('/', async (req, res, next) => {
  try {
    const p = schema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Neplatná data' });
    const d = p.data;
    const data = {
      kiosk_code: d.kiosk_code.trim(), contract_number: (d.contract_number || '').trim() || null,
      company_id: d.company_id || null, buyer_ico: d.buyer_ico || null, buyer_dic: d.buyer_dic || null,
      customer_name: d.customer_name || null, email: d.email || null,
      amount: d.amount != null ? d.amount : 60, currency: (d.currency || 'EUR').toUpperCase().slice(0, 3),
      vat_regime: d.vat_regime || 'standard', vat_rate: d.vat_rate != null ? d.vat_rate : 21,
      language: d.language || 'cs', active: d.active !== false, auto_send: !!d.auto_send,
      billing_day: d.billing_day != null ? d.billing_day : 1, note: d.note || null,
      created_by_user_id: (req.user && req.user.id) || null,
    };
    const sub = await prisma.softwareSubscription.upsert({ where: { kiosk_code: data.kiosk_code }, update: data, create: data });
    res.status(201).json(sub);
  } catch (err) { next(err); }
});

router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const p = schema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Neplatná data' });
    const d = p.data; const data = {};
    ['company_id', 'buyer_ico', 'buyer_dic', 'customer_name', 'email', 'contract_number', 'note'].forEach(function (k) { if (d[k] !== undefined) data[k] = d[k] || null; });
    ['amount', 'vat_rate', 'billing_day'].forEach(function (k) { if (d[k] !== undefined) data[k] = d[k]; });
    if (d.currency !== undefined) data.currency = String(d.currency || 'EUR').toUpperCase().slice(0, 3);
    if (d.vat_regime !== undefined) data.vat_regime = d.vat_regime;
    if (d.language !== undefined) data.language = d.language;
    ['active', 'auto_send'].forEach(function (k) { if (d[k] !== undefined) data[k] = !!d[k]; });
    res.json(await prisma.softwareSubscription.update({ where: { id: Number(req.params.id) }, data }));
  } catch (err) { next(err); }
});

router.delete('/:id(\\d+)', async (req, res, next) => {
  try { await prisma.softwareSubscription.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); }
  catch (err) { next(err); }
});

// POST /test-email — ukázková faktura na zadanou adresu (nic se nevystaví)
router.post('/test-email', async (req, res, next) => {
  try {
    const b = req.body || {};
    const to = String(b.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Zadej platný e-mail, na který se má test poslat.' });
    const { sendTestEmail } = require('../services/compounder/software-billing-worker');
    const r = await sendTestEmail({
      kiosk_code: String(b.kiosk_code || 'TEST'), customer_name: b.customer_name, buyer_ico: b.buyer_ico, buyer_dic: b.buyer_dic,
      contract_number: b.contract_number, amount: Number(b.amount) || 60, currency: b.currency || 'EUR',
      vat_regime: b.vat_regime || 'standard', vat_rate: b.vat_rate != null ? Number(b.vat_rate) : 21, language: b.language === 'en' ? 'en' : 'cs',
    }, to);
    if (!r.sent) return res.status(502).json({ error: 'Testovací e-mail se nepodařilo odeslat', reason: r.error || r.skipped || 'unknown' });
    res.json({ ok: true, sent_to: r.to, sent_from: r.from, via: r.via, total: r.invoice_total, currency: r.currency });
  } catch (err) { next(err); }
});

// POST /send-invoice/:invoiceId — ruční odeslání vystavené faktury
router.post('/send-invoice/:invoiceId(\\d+)', async (req, res, next) => {
  try {
    const { sendInvoiceEmail } = require('../services/compounder/software-billing-worker');
    const to = String((req.body && req.body.to) || '').trim() || undefined;
    const r = await sendInvoiceEmail(Number(req.params.invoiceId), { to });
    if (!r.sent) return res.status(502).json({ error: 'E-mail se nepodařilo odeslat', reason: r.error || r.skipped || 'unknown' });
    res.json({ ok: true, sent_to: r.to, sent_from: r.from, via: r.via });
  } catch (err) { next(err); }
});

// POST /:id/bill-now — vystaví fakturu za běžný měsíc hned
router.post('/:id(\\d+)/bill-now', async (req, res, next) => {
  try {
    const sub = await prisma.softwareSubscription.findUnique({ where: { id: Number(req.params.id) } });
    if (!sub) return res.status(404).json({ error: 'Nenalezeno' });
    const { billSubscription } = require('../services/compounder/software-billing-worker');
    res.json(await billSubscription(sub, { force: true }));
  } catch (err) { next(err); }
});

module.exports = router;
