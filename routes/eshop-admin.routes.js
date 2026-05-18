// =============================================================================
// HolyOS — Spare Parts Shop (admin) routes
// CRUD pro kategorie, ceníky, dopravu, platby, objednávky a nastavení eshopu.
// Mountováno pod /api/eshop-admin, vyžaduje interní login (requireAuth).
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── Pomocné funkce ────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || ('a-' + Date.now());
}

// Pole pro Material.select v list/detail — bezpečný subset (žádné historické / Factorify pole)
const materialEshopSelect = {
  id: true,
  code: true,
  name: true,
  unit: true,
  barcode: true,
  photo_url: true,
  current_stock: true,
  sells_on_eshop: true,
  eshop_warehouse_id: true,
  eshop_description: true,
  eshop_image_path: true,
  eshop_category_id: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// KATEGORIE (eshop_categories)
// ═══════════════════════════════════════════════════════════════════════════

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional().nullable(),
  description: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
  parent_id: z.number().int().optional().nullable(),
});

router.get('/categories', async (req, res, next) => {
  try {
    const items = await prisma.eshopCategory.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { materials: true, children: true } } },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const data = parsed.data;
    const cat = await prisma.eshopCategory.create({
      data: { ...data, slug: slugify(data.name) },
    });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Kategorie s tímto jménem nebo slugem už existuje' });
    next(err);
  }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const data = { ...parsed.data };
    if (data.name) data.slug = slugify(data.name);
    const cat = await prisma.eshopCategory.update({ where: { id }, data });
    res.json(cat);
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.eshopCategory.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÍKY (eshop_pricelists) + položky ceníku
// ═══════════════════════════════════════════════════════════════════════════

const pricelistSchema = z.object({
  name: z.string().min(1).max(255),
  currency: z.string().length(3).optional(),
  vat_pct: z.union([z.number(), z.string()]).optional(),
  active: z.boolean().optional(),
  description: z.string().optional().nullable(),
});

router.get('/pricelists', async (req, res, next) => {
  try {
    const items = await prisma.eshopPricelist.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { items: true, companies: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/pricelists/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pl = await prisma.eshopPricelist.findUnique({
      where: { id },
      include: {
        companies: { select: { id: true, name: true, ico: true } },
        items: {
          orderBy: { id: 'asc' },
          include: { material: { select: { id: true, code: true, name: true, unit: true } } },
        },
      },
    });
    if (!pl) return res.status(404).json({ error: 'Ceník nenalezen' });
    res.json(pl);
  } catch (err) { next(err); }
});

router.post('/pricelists', async (req, res, next) => {
  try {
    const parsed = pricelistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const pl = await prisma.eshopPricelist.create({ data: parsed.data });
    res.status(201).json(pl);
  } catch (err) { next(err); }
});

router.put('/pricelists/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = pricelistSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const pl = await prisma.eshopPricelist.update({ where: { id }, data: parsed.data });
    res.json(pl);
  } catch (err) { next(err); }
});

router.delete('/pricelists/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Detekce: firma na ceník navázaná → 409
    const used = await prisma.company.count({ where: { eshop_pricelist_id: id } });
    if (used > 0) return res.status(409).json({ error: `Ceník je přiřazený k ${used} firmám, nelze smazat.` });
    await prisma.eshopPricelist.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Položky ceníku ────────────────────────────────────────────────────────

const pricelistItemSchema = z.object({
  material_id: z.number().int(),
  price_excl_vat: z.union([z.number(), z.string()]),
});

router.post('/pricelists/:id/items', async (req, res, next) => {
  try {
    const pricelist_id = parseInt(req.params.id, 10);
    const parsed = pricelistItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const item = await prisma.eshopPricelistItem.create({
      data: {
        pricelist_id,
        material_id: parsed.data.material_id,
        price_excl_vat: parsed.data.price_excl_vat,
      },
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Tento Material už v ceníku je. Použij PUT pro úpravu ceny.' });
    next(err);
  }
});

router.put('/pricelists/:pricelistId/items/:itemId', async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId, 10);
    const parsed = pricelistItemSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const item = await prisma.eshopPricelistItem.update({
      where: { id: itemId },
      data: parsed.data,
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/pricelists/:pricelistId/items/:itemId', async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId, 10);
    await prisma.eshopPricelistItem.delete({ where: { id: itemId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Hromadný import položek ceníku — paste-text z Excelu (tab/čárka/středník separator).
// Formát: "kod_materialu<tab>cena_bez_dph" per řádek. Header se pozná podle toho,
// že 2. sloupec první řádky není parsovatelný jako číslo — řádek se přeskočí.
// Update-or-insert chování — pro existující (pricelist, material) přepíše cenu.
const csvImportSchema = z.object({
  csv: z.string().min(1).max(500000), // 500 KB raw text
});

router.post('/pricelists/:id/import-csv', async (req, res, next) => {
  try {
    const pricelist_id = parseInt(req.params.id, 10);
    const pl = await prisma.eshopPricelist.findUnique({ where: { id: pricelist_id }, select: { id: true } });
    if (!pl) return res.status(404).json({ error: 'Ceník nenalezen' });
    const parsed = csvImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });

    const lines = parsed.data.csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(/[\t,;]/).map(s => s.trim().replace(/^"(.*)"$/, '$1'));
      if (parts.length < 2) { result.errors.push({ line: i + 1, error: 'málo polí', raw: line }); continue; }
      const code = parts[0];
      const priceStr = parts[1].replace(/\s/g, '').replace(',', '.'); // CZ čárka → tečka
      const price = parseFloat(priceStr);
      if (Number.isNaN(price)) {
        if (i === 0) { result.skipped++; continue; } // pravděpodobně header
        result.errors.push({ line: i + 1, error: 'cena není číslo', raw: line });
        continue;
      }
      if (price < 0) { result.errors.push({ line: i + 1, error: 'záporná cena', raw: line }); continue; }
      const m = await prisma.material.findUnique({ where: { code }, select: { id: true } });
      if (!m) { result.errors.push({ line: i + 1, error: `kód "${code}" nenalezen`, raw: line }); continue; }

      try {
        const existing = await prisma.eshopPricelistItem.findUnique({
          where: { pricelist_id_material_id: { pricelist_id, material_id: m.id } },
        });
        if (existing) {
          await prisma.eshopPricelistItem.update({
            where: { id: existing.id },
            data: { price_excl_vat: price },
          });
          result.updated++;
        } else {
          await prisma.eshopPricelistItem.create({
            data: { pricelist_id, material_id: m.id, price_excl_vat: price },
          });
          result.inserted++;
        }
      } catch (e) {
        result.errors.push({ line: i + 1, error: e.message, raw: line });
      }
    }

    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOPRAVA (eshop_shipping_methods)
// ═══════════════════════════════════════════════════════════════════════════

const shippingSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  price_excl_vat: z.union([z.number(), z.string()]),
  vat_pct: z.union([z.number(), z.string()]).optional(),
  free_above_amount: z.union([z.number(), z.string()]).optional().nullable(),
  currency: z.string().length(3).optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

router.get('/shipping-methods', async (req, res, next) => {
  try {
    const items = await prisma.eshopShippingMethod.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/shipping-methods', async (req, res, next) => {
  try {
    const parsed = shippingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const sm = await prisma.eshopShippingMethod.create({ data: parsed.data });
    res.status(201).json(sm);
  } catch (err) { next(err); }
});

router.put('/shipping-methods/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = shippingSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const sm = await prisma.eshopShippingMethod.update({ where: { id }, data: parsed.data });
    res.json(sm);
  } catch (err) { next(err); }
});

router.delete('/shipping-methods/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Detekce: existuje objednávka s touto dopravou → 409
    const used = await prisma.shopOrder.count({ where: { shipping_method_id: id } });
    if (used > 0) return res.status(409).json({ error: `Tato doprava je použitá na ${used} objednávkách, nelze smazat. Deaktivuj přes active=false.` });
    await prisma.eshopShippingMethod.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PLATBY (eshop_payment_methods)
// ═══════════════════════════════════════════════════════════════════════════

const paymentSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  description: z.string().optional().nullable(),
  fee_excl_vat: z.union([z.number(), z.string()]).optional(),
  vat_pct: z.union([z.number(), z.string()]).optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

router.get('/payment-methods', async (req, res, next) => {
  try {
    const items = await prisma.eshopPaymentMethod.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/payment-methods', async (req, res, next) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const pm = await prisma.eshopPaymentMethod.create({ data: parsed.data });
    res.status(201).json(pm);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Platba s tímto kódem už existuje' });
    next(err);
  }
});

router.put('/payment-methods/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = paymentSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const pm = await prisma.eshopPaymentMethod.update({ where: { id }, data: parsed.data });
    res.json(pm);
  } catch (err) { next(err); }
});

router.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const used = await prisma.shopOrder.count({ where: { payment_method_id: id } });
    if (used > 0) return res.status(409).json({ error: `Tato platba je použitá na ${used} objednávkách, nelze smazat. Deaktivuj přes active=false.` });
    await prisma.eshopPaymentMethod.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// OBJEDNÁVKY (eshop_orders) — list / detail / patch (admin workflow)
// ═══════════════════════════════════════════════════════════════════════════

const ORDER_STATUSES = ['new', 'confirmed', 'picking', 'shipped', 'delivered', 'closed', 'cancelled'];

router.get('/orders', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const partnerId = req.query.partner_id ? parseInt(String(req.query.partner_id), 10) : null;
    const companyId = req.query.company_id ? parseInt(String(req.query.company_id), 10) : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);

    const where = {};
    if (status) where.status = status;
    if (partnerId) where.partner_id = partnerId;
    if (companyId) where.company_id = companyId;
    if (from || to) where.created_at = {};
    if (from) where.created_at.gte = from;
    if (to) where.created_at.lte = to;
    if (q) {
      where.OR = [
        { order_number: { contains: q, mode: 'insensitive' } },
        { ship_to_name: { contains: q, mode: 'insensitive' } },
        { ship_to_company: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orders = await prisma.shopOrder.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        partner: { select: { id: true, username: true, display_name: true, email: true } },
        company: { select: { id: true, name: true, ico: true } },
        shipping_method: { select: { id: true, name: true } },
        payment_method: { select: { id: true, name: true, code: true } },
        _count: { select: { items: true } },
      },
    });
    res.json(orders);
  } catch (err) { next(err); }
});

// CSV export objednávek — pro účetní. Filtr identický s /orders, ale vrací
// text/csv attachment s detailem položek (jeden řádek per item × order).
router.get('/orders/export.csv', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where = {};
    if (status) where.status = status;
    if (from || to) where.created_at = {};
    if (from) where.created_at.gte = from;
    if (to) where.created_at.lte = to;

    const orders = await prisma.shopOrder.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        partner: { select: { display_name: true, email: true } },
        company: { select: { name: true, ico: true, dic: true } },
        shipping_method: { select: { name: true } },
        payment_method: { select: { name: true, code: true } },
        items: { orderBy: { id: 'asc' } },
      },
    });

    // CSV escape — text musí být v uvozovkách, vnitřní " se zdvojí
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[,;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = [
      'Cislo', 'Datum', 'Stav', 'Partner', 'PartnerEmail', 'Firma', 'IC', 'DIC',
      'Adresa', 'Mesto', 'PSC', 'Zeme',
      'Doprava', 'Platba', 'Mena',
      'Pol_Kod', 'Pol_Nazev', 'Pol_Mnozstvi', 'Pol_Jednotka', 'Pol_CenaJednotka', 'Pol_CenaCelkem',
      'Mezisoucet', 'CenaDopravy', 'PoplPlatby', 'CelkemBezDPH', 'DPH%', 'CelkemSDPH',
      'Tracking', 'Dopravce', 'Poznamka',
    ].join(';');

    const rows = [header];
    for (const o of orders) {
      const baseRow = [
        o.order_number,
        new Date(o.created_at).toISOString().slice(0, 10),
        o.status,
        o.partner ? o.partner.display_name : '',
        o.partner ? (o.partner.email || '') : '',
        o.company ? o.company.name : (o.ship_to_company || ''),
        o.company ? (o.company.ico || '') : '',
        o.company ? (o.company.dic || '') : '',
        o.ship_to_address, o.ship_to_city, o.ship_to_zip, o.ship_to_country,
        o.shipping_method ? o.shipping_method.name : '',
        o.payment_method ? o.payment_method.name : '',
        o.currency,
      ];
      const trailing = [
        Number(o.subtotal_excl).toFixed(2),
        Number(o.shipping_excl).toFixed(2),
        Number(o.payment_fee_excl).toFixed(2),
        Number(o.total_excl).toFixed(2),
        Number(o.vat_pct).toFixed(2),
        Number(o.total_incl_vat).toFixed(2),
        o.tracking_number || '',
        o.tracking_carrier || '',
        o.customer_note || '',
      ];
      if (o.items.length === 0) {
        rows.push([...baseRow, '', '', '', '', '', '', ...trailing].map(esc).join(';'));
      } else {
        for (const it of o.items) {
          rows.push([
            ...baseRow,
            it.material_code, it.material_name,
            Number(it.quantity).toFixed(3), it.unit,
            Number(it.unit_price_excl).toFixed(2),
            Number(it.total_excl).toFixed(2),
            ...trailing,
          ].map(esc).join(';'));
        }
      }
    }

    const filename = `eshop-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM pro Excel CZ — aby správně rozpoznal UTF-8
    res.send('\uFEFF' + rows.join('\n'));
  } catch (err) { next(err); }
});

router.get('/orders/stats', async (req, res, next) => {
  // Statistika po stavech — pro dashboard tile v admin UI.
  try {
    const groups = await prisma.shopOrder.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out = {};
    ORDER_STATUSES.forEach(s => { out[s] = 0; });
    groups.forEach(g => { out[g.status] = g._count._all; });
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const o = await prisma.shopOrder.findUnique({
      where: { id },
      include: {
        partner: true,
        company: true,
        shipping_method: true,
        payment_method: true,
        items: {
          orderBy: { id: 'asc' },
          include: { material: { select: { id: true, code: true, name: true, unit: true, photo_url: true } } },
        },
      },
    });
    if (!o) return res.status(404).json({ error: 'Objednávka nenalezena' });
    res.json(o);
  } catch (err) { next(err); }
});

// Změna stavu objednávky + tracking. Workflow je liberální — admin může
// přepnout do libovolného povoleného stavu. Audit timestamps se nastavují
// automaticky podle cílového stavu.
const orderPatchSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  tracking_number: z.string().max(100).optional().nullable(),
  tracking_carrier: z.string().max(60).optional().nullable(),
  cancel_reason: z.string().max(255).optional().nullable(),
});

router.patch('/orders/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = orderPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const data = { ...parsed.data };
    if (data.status) {
      const now = new Date();
      if (data.status === 'confirmed' && !data.confirmed_at) data.confirmed_at = now;
      if (data.status === 'picking'   && !data.picked_at)    data.picked_at = now;
      if (data.status === 'shipped'   && !data.shipped_at)   data.shipped_at = now;
      if (data.status === 'delivered' && !data.delivered_at) data.delivered_at = now;
      if (data.status === 'closed'    && !data.closed_at)    data.closed_at = now;
      if (data.status === 'cancelled' && !data.cancelled_at) data.cancelled_at = now;
    }
    const o = await prisma.shopOrder.update({
      where: { id },
      data,
      include: { items: true, partner: { select: { id: true, display_name: true } } },
    });
    res.json(o);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALS — eshop nastavení (flag, sklad, kategorie, popis, obrázek)
// ═══════════════════════════════════════════════════════════════════════════

const materialEshopSchema = z.object({
  sells_on_eshop: z.boolean().optional(),
  eshop_warehouse_id: z.number().int().optional().nullable(),
  eshop_description: z.string().optional().nullable(),
  eshop_image_path: z.string().max(500).optional().nullable(),
  eshop_category_id: z.number().int().optional().nullable(),
});

// Helper pro list Materials s filtrem na eshop — výpis pro tab Katalog.
router.get('/materials', async (req, res, next) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const onlyEshop = req.query.only_eshop === '1' || req.query.only_eshop === 'true';
    const categoryId = req.query.category_id ? parseInt(String(req.query.category_id), 10) : null;
    const limit = Math.min(parseInt(String(req.query.limit || '200'), 10), 1000);

    const where = { status: 'active' };
    if (onlyEshop) where.sells_on_eshop = true;
    if (categoryId) where.eshop_category_id = categoryId;
    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.material.findMany({
      where,
      orderBy: [{ sells_on_eshop: 'desc' }, { name: 'asc' }],
      take: limit,
      select: {
        ...materialEshopSelect,
        eshop_category: { select: { id: true, name: true } },
        eshop_warehouse: { select: { id: true, name: true, code: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

// Hromadná editace eshop nastavení — admin Katalog tab "vybrané položky" akce.
// Akce: enable / disable / set_category (value: int|null) / set_warehouse (value: int|null)
const bulkEshopSchema = z.object({
  material_ids: z.array(z.number().int()).min(1).max(500),
  action: z.enum(['enable', 'disable', 'set_category', 'set_warehouse']),
  value: z.number().int().nullable().optional(),
});

router.post('/materials/bulk-eshop', async (req, res, next) => {
  try {
    const parsed = bulkEshopSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { material_ids, action, value } = parsed.data;

    let data = {};
    if (action === 'enable') data = { sells_on_eshop: true };
    else if (action === 'disable') data = { sells_on_eshop: false };
    else if (action === 'set_category') data = { eshop_category_id: value || null };
    else if (action === 'set_warehouse') data = { eshop_warehouse_id: value || null };

    const result = await prisma.material.updateMany({
      where: { id: { in: material_ids } },
      data,
    });
    res.json({ updated: result.count, action, ids: material_ids.length });
  } catch (err) { next(err); }
});

router.patch('/materials/:id/eshop', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = materialEshopSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const m = await prisma.material.update({
      where: { id },
      data: parsed.data,
      select: {
        ...materialEshopSelect,
        eshop_category: { select: { id: true, name: true } },
        eshop_warehouse: { select: { id: true, name: true, code: true } },
      },
    });
    res.json(m);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY — přiřazení / zrušení ceníku
// ═══════════════════════════════════════════════════════════════════════════

router.get('/companies', async (req, res, next) => {
  // List firem s přidělenými ceníky — pro tab "Přiřazení ceníků".
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const onlyAssigned = req.query.only_assigned === '1';
    const onlyUnassigned = req.query.only_unassigned === '1';

    const where = { active: true };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { ico: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (onlyAssigned) where.eshop_pricelist_id = { not: null };
    if (onlyUnassigned) where.eshop_pricelist_id = null;

    const items = await prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true, name: true, ico: true, dic: true, country: true,
        eshop_pricelist_id: true,
        eshop_pricelist: { select: { id: true, name: true, currency: true, active: true } },
        _count: { select: { partner_accounts: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

const assignSchema = z.object({
  pricelist_id: z.number().int().nullable(), // null = odebrat
});

router.post('/companies/:id/pricelist', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const co = await prisma.company.update({
      where: { id },
      data: { eshop_pricelist_id: parsed.data.pricelist_id },
      select: {
        id: true, name: true, eshop_pricelist_id: true,
        eshop_pricelist: { select: { id: true, name: true, currency: true } },
      },
    });
    res.json(co);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// NASTAVENÍ (singleton EshopSettings, id=1)
// ═══════════════════════════════════════════════════════════════════════════

const settingsSchema = z.object({
  notification_email: z.string().email().optional().nullable(),
  notification_person_id: z.number().int().optional().nullable(),
  default_currency: z.string().length(3).optional(),
  default_vat_pct: z.union([z.number(), z.string()]).optional(),
  reservation_hours: z.number().int().min(1).max(720).optional(),
  footer_html: z.string().optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  contact_phone: z.string().max(40).optional().nullable(),
});

router.get('/settings', async (req, res, next) => {
  try {
    // Singleton — vždy id=1 (seed migrace); pokud chybí, vrátíme prázdný objekt.
    const s = await prisma.eshopSettings.findUnique({
      where: { id: 1 },
      include: {
        notification_person: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
    });
    res.json(s || { id: null });
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const s = await prisma.eshopSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...parsed.data },
      update: parsed.data,
      include: {
        notification_person: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
    });
    res.json(s);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATISTIKY (dashboard)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/stats/dashboard', async (req, res, next) => {
  try {
    // Period: default posledních 90 dnů, lze přepsat ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
    const to = req.query.to ? new Date(String(req.query.to)) : now;

    // Pouze NE-cancelled objednávky se počítají jako "skutečné"
    const baseWhere = {
      created_at: { gte: from, lte: to },
      status: { not: 'cancelled' },
    };

    // 1) Souhrn — počet, celkový revenue, průměr objednávky
    const [totalAgg, statusGroups] = await Promise.all([
      prisma.shopOrder.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { total_incl_vat: true },
        _avg: { total_incl_vat: true },
      }),
      prisma.shopOrder.groupBy({
        by: ['status'],
        where: { created_at: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ]);

    const statusCounts = { new: 0, confirmed: 0, picking: 0, shipped: 0, delivered: 0, closed: 0, cancelled: 0 };
    statusGroups.forEach(g => { statusCounts[g.status] = g._count._all; });

    // 2) Top-selling položky — agregace přes ShopOrderItem
    const topItemsRaw = await prisma.shopOrderItem.groupBy({
      by: ['material_id', 'material_code', 'material_name'],
      where: { order: baseWhere },
      _sum: { quantity: true, total_excl: true },
      orderBy: { _sum: { total_excl: 'desc' } },
      take: 10,
    });
    const topItems = topItemsRaw.map(t => ({
      material_id: t.material_id,
      code: t.material_code,
      name: t.material_name,
      qty: Number(t._sum.quantity || 0),
      revenue: Number(t._sum.total_excl || 0),
    }));

    // 3) Revenue per měsíc (posledních 12 měsíců) — Postgres date_trunc
    // Prisma nemá nativní date_trunc, použijeme raw SQL
    const monthly = await prisma.$queryRaw`
      SELECT
        TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') as month,
        COUNT(*)::int as order_count,
        COALESCE(SUM(total_incl_vat), 0)::numeric as revenue
      FROM eshop_orders
      WHERE status != 'cancelled' AND created_at >= ${new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)}
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at) ASC
    `;
    const revenueByMonth = monthly.map(m => ({
      month: m.month,
      orders: Number(m.order_count),
      revenue: Number(m.revenue),
    }));

    // 4) Top firmy (kdo nejvíc nakupuje)
    const topCompaniesRaw = await prisma.shopOrder.groupBy({
      by: ['company_id'],
      where: { ...baseWhere, company_id: { not: null } },
      _count: { _all: true },
      _sum: { total_incl_vat: true },
      orderBy: { _sum: { total_incl_vat: 'desc' } },
      take: 10,
    });
    const companyIds = topCompaniesRaw.map(t => t.company_id).filter(Boolean);
    const companies = companyIds.length
      ? await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, ico: true } })
      : [];
    const companyMap = new Map(companies.map(c => [c.id, c]));
    const topCompanies = topCompaniesRaw.map(t => ({
      company_id: t.company_id,
      name: companyMap.get(t.company_id) ? companyMap.get(t.company_id).name : '(neznámá)',
      orders: t._count._all,
      revenue: Number(t._sum.total_incl_vat || 0),
    }));

    // 5) Conversion — kolik Hugo sessions / kolik objednávek (period)
    let conversion = null;
    try {
      const [sessions, partnersWithOrders] = await Promise.all([
        prisma.serviceChatSession.count({ where: { created_at: { gte: from, lte: to } } }),
        prisma.shopOrder.findMany({
          where: baseWhere,
          select: { partner_id: true },
          distinct: ['partner_id'],
        }),
      ]);
      conversion = {
        hugo_sessions: sessions,
        partners_with_orders: partnersWithOrders.length,
        rate: sessions > 0 ? Math.round((partnersWithOrders.length / sessions) * 10000) / 100 : 0,
      };
    } catch (e) {
      conversion = { error: e.message };
    }

    // 6) Low-stock alert — Material.sells_on_eshop=true + current_stock < min_stock
    // (Prisma raw, protože column-vs-column srovnání není v Prisma where podporováno)
    const lowStockRaw = await prisma.$queryRaw`
      SELECT m.id, m.code, m.name, m.unit,
             m.current_stock::numeric as current_stock,
             m.min_stock::numeric as min_stock,
             m.eshop_warehouse_id
      FROM materials m
      WHERE m.sells_on_eshop = TRUE
        AND m.status = 'active'
        AND m.min_stock IS NOT NULL
        AND m.current_stock < m.min_stock
      ORDER BY (m.min_stock - m.current_stock) DESC
      LIMIT 20
    `;
    const lowStock = lowStockRaw.map(m => ({
      id: m.id,
      code: m.code,
      name: m.name,
      unit: m.unit,
      current_stock: Number(m.current_stock),
      min_stock: Number(m.min_stock),
      shortage: Number(m.min_stock) - Number(m.current_stock),
    }));

    res.json({
      period: { from, to },
      summary: {
        total_orders: totalAgg._count._all || 0,
        total_revenue: Number(totalAgg._sum.total_incl_vat || 0),
        avg_order_value: Number(totalAgg._avg.total_incl_vat || 0),
        cancelled: statusCounts.cancelled,
      },
      status_counts: statusCounts,
      top_items: topItems,
      revenue_by_month: revenueByMonth,
      top_companies: topCompanies,
      conversion,
      low_stock: lowStock,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP — Warehouses a Persons (pro selecty v UI)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/warehouses', async (req, res, next) => {
  try {
    const items = await prisma.warehouse.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, type: true },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/people', async (req, res, next) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const where = { active: true };
    if (q) {
      where.OR = [
        { first_name: { contains: q, mode: 'insensitive' } },
        { last_name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const items = await prisma.person.findMany({
      where,
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
      take: 50,
      select: { id: true, first_name: true, last_name: true, email: true },
    });
    res.json(items);
  } catch (err) { next(err); }
});

module.exports = router;
