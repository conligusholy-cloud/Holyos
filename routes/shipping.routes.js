// =============================================================================
// HolyOS — Doprava (agenda) routes
// Fronta požadavků na dopravu k eshop objednávkám (kurýr do zahraničí).
// Řešitel poptá cenu, zapíše náklad + provizi, potvrdí → cena se promítne do
// objednávky (shipping_excl) a odemkne fakturaci.
// Mountováno pod /api/shipping, vyžaduje interní login (requireAuth).
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const REQ_STATUSES = ['new', 'quoting', 'quoted', 'confirmed', 'cancelled'];

function round2(n) { return Math.round(Number(n) * 100) / 100; }
function calcSell(cost, markupPct) {
  return round2(Number(cost || 0) * (1 + Number(markupPct || 0) / 100));
}

// ─── Nastavení: výchozí provize (%) ──────────────────────────────────────────
router.get('/settings', async (req, res, next) => {
  try {
    const s = await prisma.eshopSettings.findUnique({
      where: { id: 1 },
      select: { shipping_markup_pct: true },
    });
    res.json({ shipping_markup_pct: s ? Number(s.shipping_markup_pct) : 0 });
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  shipping_markup_pct: z.union([z.number(), z.string()]).transform(v => Number(v)),
});
router.put('/settings', async (req, res, next) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const pct = parsed.data.shipping_markup_pct;
    if (!Number.isFinite(pct) || pct < 0 || pct > 999) return res.status(400).json({ error: 'Provize musí být 0–999 %.' });
    const s = await prisma.eshopSettings.upsert({
      where: { id: 1 },
      create: { id: 1, shipping_markup_pct: pct },
      update: { shipping_markup_pct: pct },
      select: { shipping_markup_pct: true },
    });
    res.json({ shipping_markup_pct: Number(s.shipping_markup_pct) });
  } catch (err) { next(err); }
});

// ─── Seznam požadavků ─────────────────────────────────────────────────────────
router.get('/requests', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const where = {};
    if (status && REQ_STATUSES.includes(status)) where.status = status;
    if (q) {
      where.order = {
        OR: [
          { order_number: { contains: q, mode: 'insensitive' } },
          { ship_to_name: { contains: q, mode: 'insensitive' } },
          { ship_to_company: { contains: q, mode: 'insensitive' } },
        ],
      };
    }
    const items = await prisma.shippingRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      include: {
        assignee: { select: { id: true, first_name: true, last_name: true } },
        order: {
          select: {
            id: true, order_number: true, status: true, currency: true,
            ship_to_name: true, ship_to_company: true, ship_to_country: true,
            subtotal_excl: true, shipping_excl: true, shipping_price_status: true,
            invoice_id: true, created_at: true,
          },
        },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

// ─── Detail ───────────────────────────────────────────────────────────────────
router.get('/requests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await prisma.shippingRequest.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, first_name: true, last_name: true } },
        order: {
          include: {
            items: { orderBy: { id: 'asc' } },
            company: { select: { id: true, name: true } },
            shipping_method: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!r) return res.status(404).json({ error: 'Požadavek nenalezen' });
    res.json(r);
  } catch (err) { next(err); }
});

// ─── Vytvoření (manuální) ──────────────────────────────────────────────────────
const createSchema = z.object({ order_id: z.number().int().positive() });
router.post('/requests', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const order = await prisma.shopOrder.findUnique({ where: { id: parsed.data.order_id }, select: { id: true, currency: true } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    const existing = await prisma.shippingRequest.findFirst({
      where: { order_id: order.id, status: { not: 'cancelled' } },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: 'Pro tuto objednávku už požadavek existuje.', request_id: existing.id });
    const settings = await prisma.eshopSettings.findUnique({ where: { id: 1 }, select: { shipping_markup_pct: true } });
    const markup = settings ? Number(settings.shipping_markup_pct) : 0;
    const created = await prisma.shippingRequest.create({
      data: {
        order_id: order.id,
        currency: order.currency,
        markup_pct: markup,
        created_by: req.user && req.user.id ? req.user.id : null,
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// ─── Úprava (poptávka, náklad, provize, řešitel, stav) ─────────────────────────
const patchSchema = z.object({
  status: z.enum(REQ_STATUSES).optional(),
  carrier: z.string().max(120).optional().nullable(),
  quote_note: z.string().max(4000).optional().nullable(),
  cost_excl: z.union([z.number(), z.string()]).optional(),
  markup_pct: z.union([z.number(), z.string()]).optional(),
  assigned_to: z.number().int().positive().optional().nullable(),
});
router.patch('/requests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const current = await prisma.shippingRequest.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Požadavek nenalezen' });
    if (current.status === 'confirmed') return res.status(409).json({ error: 'Potvrzený požadavek už nelze upravovat.' });

    const data = {};
    if (parsed.data.carrier !== undefined) data.carrier = parsed.data.carrier;
    if (parsed.data.quote_note !== undefined) data.quote_note = parsed.data.quote_note;
    if (parsed.data.assigned_to !== undefined) data.assigned_to = parsed.data.assigned_to;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;

    const cost = parsed.data.cost_excl !== undefined ? Number(parsed.data.cost_excl) : Number(current.cost_excl);
    const markup = parsed.data.markup_pct !== undefined ? Number(parsed.data.markup_pct) : Number(current.markup_pct);
    if (parsed.data.cost_excl !== undefined) {
      if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'Neplatný náklad dopravy.' });
      data.cost_excl = round2(cost);
    }
    if (parsed.data.markup_pct !== undefined) {
      if (!Number.isFinite(markup) || markup < 0 || markup > 999) return res.status(400).json({ error: 'Provize musí být 0–999 %.' });
      data.markup_pct = round2(markup);
    }
    if (parsed.data.cost_excl !== undefined || parsed.data.markup_pct !== undefined) {
      data.sell_excl = calcSell(cost, markup);
    }
    if (parsed.data.status === 'quoted' && !current.quoted_at) data.quoted_at = new Date();

    const updated = await prisma.shippingRequest.update({ where: { id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── Potvrzení ceny → promítnout do objednávky ─────────────────────────────────
router.post('/requests/:id/confirm', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const reqRow = await prisma.shippingRequest.findUnique({ where: { id } });
    if (!reqRow) return res.status(404).json({ error: 'Požadavek nenalezen' });
    if (reqRow.status === 'confirmed') return res.status(409).json({ error: 'Cena už byla potvrzena.' });
    const sell = calcSell(reqRow.cost_excl, reqRow.markup_pct);
    if (!(sell >= 0)) return res.status(400).json({ error: 'Nejprve zadej platnou cenu dopravy.' });

    const order = await prisma.shopOrder.findUnique({
      where: { id: reqRow.order_id },
      select: { id: true, subtotal_excl: true, payment_fee_excl: true, vat_pct: true },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });

    const totalExcl = round2(Number(order.subtotal_excl) + sell + Number(order.payment_fee_excl));
    const totalIncl = round2(totalExcl * (1 + Number(order.vat_pct) / 100));

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const r = await tx.shippingRequest.update({
        where: { id },
        data: { status: 'confirmed', sell_excl: sell, confirmed_at: now, quoted_at: reqRow.quoted_at || now },
      });
      await tx.shopOrder.update({
        where: { id: order.id },
        data: {
          shipping_excl: sell,
          shipping_price_status: 'defined',
          total_excl: totalExcl,
          total_incl_vat: totalIncl,
          tracking_carrier: reqRow.carrier || undefined,
        },
      });
      return r;
    });
    res.json({ ...result, order_total_excl: totalExcl, order_total_incl_vat: totalIncl });
  } catch (err) { next(err); }
});

module.exports = router;
