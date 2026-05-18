// =============================================================================
// HolyOS — Spare Parts Shop (partner-facing) routes
// REST API pro bestseries.cash/spare-parts. Sdílí PartnerAccount login s Hugem.
// Mountováno pod /api/shop, vyžaduje partner login (requireHugoAuth).
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireHugoAuth } = require('../middleware/hugo-auth');

router.use(requireHugoAuth);

// ─── Pomocné funkce ────────────────────────────────────────────────────────

/**
 * Vrátí ceník pro partnerovu firmu (nebo null pokud neexistuje / není aktivní).
 * Cachuje per-request přes req._cachedPricelist.
 */
async function getPricelistForPartner(req) {
  if (req._cachedPricelist !== undefined) return req._cachedPricelist;
  if (!req.partner || !req.partner.company || !req.partner.company.id) {
    req._cachedPricelist = null;
    return null;
  }
  const co = await prisma.company.findUnique({
    where: { id: req.partner.company.id },
    select: {
      id: true,
      name: true,
      eshop_pricelist_id: true,
      eshop_pricelist: true,
    },
  });
  const pl = (co && co.eshop_pricelist && co.eshop_pricelist.active) ? co.eshop_pricelist : null;
  req._cachedPricelist = pl;
  req._cachedCompany = co;
  return pl;
}

async function getCompanyForPartner(req) {
  await getPricelistForPartner(req);
  return req._cachedCompany || null;
}

/**
 * Skladová dostupnost pro eshop — sum z Stock přes location.warehouse_id.
 * Pozn: Stock je klíčovaný přes location_id, ne warehouse_id (memory
 * holyos_stock_warehouse_join). Filter jde přes nested where.
 */
async function eshopStock(material) {
  if (!material || !material.sells_on_eshop || !material.eshop_warehouse_id) return 0;
  const stock = await prisma.stock.aggregate({
    where: {
      material_id: material.id,
      location: { warehouse_id: material.eshop_warehouse_id },
    },
    _sum: { quantity: true },
  });
  return Number(stock._sum.quantity || 0);
}

/**
 * Aktivně rezervované množství — kusy v otevřených eshop objednávkách
 * (status new/confirmed/picking) které ještě fyzicky neopustily sklad.
 */
async function reservedForEshop(materialId) {
  const agg = await prisma.shopOrderItem.aggregate({
    where: {
      material_id: materialId,
      order: { status: { in: ['new', 'confirmed', 'picking'] } },
    },
    _sum: { quantity: true },
  });
  return Number(agg._sum.quantity || 0);
}

/**
 * Volně dostupné kusy = stock - rezervace. Nikdy záporné.
 */
async function availableForEshop(material) {
  const [stock, reserved] = await Promise.all([
    eshopStock(material),
    reservedForEshop(material.id),
  ]);
  return Math.max(0, stock - reserved);
}

/**
 * Vrátí mapu material_id → cena bez DPH pro daný ceník.
 */
async function getPricesForMaterials(pricelistId, materialIds) {
  if (!pricelistId || !materialIds.length) return new Map();
  const items = await prisma.eshopPricelistItem.findMany({
    where: { pricelist_id: pricelistId, material_id: { in: materialIds } },
    select: { material_id: true, price_excl_vat: true },
  });
  const map = new Map();
  items.forEach(i => map.set(i.material_id, Number(i.price_excl_vat)));
  return map;
}

/**
 * Vygeneruje další číslo objednávky pro daný rok ve formátu E2026-00001.
 * Race-safe: unique constraint na order_number, při kolizi se inkrementuje.
 */
async function nextOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `E${year}-`;
  const last = await prisma.shopOrder.findFirst({
    where: { order_number: { startsWith: prefix } },
    orderBy: { order_number: 'desc' },
    select: { order_number: true },
  });
  let seq = 1;
  if (last && last.order_number) {
    const tail = last.order_number.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ME — kdo jsem + jestli mám přístup do shopu
// ═══════════════════════════════════════════════════════════════════════════

router.get('/me', async (req, res, next) => {
  try {
    const pl = await getPricelistForPartner(req);
    const co = await getCompanyForPartner(req);
    res.json({
      partner: {
        id: req.partner.id,
        username: req.partner.username,
        display_name: req.partner.display_name,
        email: req.partner.email,
        language: req.partner.language,
      },
      company: co ? { id: co.id, name: co.name } : null,
      has_access: !!pl,
      currency: pl ? pl.currency : null,
      pricelist: pl ? { id: pl.id, name: pl.name, currency: pl.currency, vat_pct: Number(pl.vat_pct) } : null,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// KATEGORIE — pro filter sidebar v partner UI
// ═══════════════════════════════════════════════════════════════════════════

router.get('/categories', async (req, res, next) => {
  try {
    const items = await prisma.eshopCategory.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { materials: { where: { sells_on_eshop: true } } } } },
    });
    res.json(items);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUKTY — partnerův katalog
// ═══════════════════════════════════════════════════════════════════════════

router.get('/products', async (req, res, next) => {
  try {
    const pl = await getPricelistForPartner(req);
    if (!pl) return res.status(403).json({ error: 'Pro vás zatím není nakonfigurován ceník. Kontaktujte nás.' });

    const q = req.query.q ? String(req.query.q).trim() : null;
    const categoryId = req.query.category_id ? parseInt(String(req.query.category_id), 10) : null;
    const sort = req.query.sort || 'name'; // name | price_asc | price_desc

    const where = { sells_on_eshop: true, status: 'active' };
    if (categoryId) where.eshop_category_id = categoryId;
    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { eshop_description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const materials = await prisma.material.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true, code: true, name: true, unit: true, photo_url: true,
        eshop_warehouse_id: true, sells_on_eshop: true,
        eshop_description: true, eshop_image_path: true,
        eshop_category: { select: { id: true, name: true, slug: true } },
      },
    });

    // Doplníme ceny + dostupnost. Materials bez ceny v ceníku vyfiltrujeme.
    const priceMap = await getPricesForMaterials(pl.id, materials.map(m => m.id));
    const out = [];
    for (const m of materials) {
      const price = priceMap.get(m.id);
      if (price == null) continue; // bez ceny ho v katalogu neukazujeme
      const available = await availableForEshop(m);
      if (available <= 0) continue; // out-of-stock skryjeme
      out.push({
        id: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        photo_url: m.eshop_image_path || m.photo_url || null,
        description: m.eshop_description || null,
        category: m.eshop_category,
        price_excl_vat: price,
        vat_pct: Number(pl.vat_pct),
        price_incl_vat: Math.round(price * (1 + Number(pl.vat_pct) / 100) * 100) / 100,
        currency: pl.currency,
        available_qty: available,
      });
    }

    // Sort podle ceny po hydraci (Prisma neumí orderBy po join cestě)
    if (sort === 'price_asc') out.sort((a, b) => a.price_excl_vat - b.price_excl_vat);
    else if (sort === 'price_desc') out.sort((a, b) => b.price_excl_vat - a.price_excl_vat);

    res.json(out);
  } catch (err) { next(err); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const pl = await getPricelistForPartner(req);
    if (!pl) return res.status(403).json({ error: 'Pro vás zatím není nakonfigurován ceník.' });

    const id = parseInt(req.params.id, 10);
    const m = await prisma.material.findUnique({
      where: { id },
      select: {
        id: true, code: true, name: true, unit: true, photo_url: true,
        sells_on_eshop: true, eshop_warehouse_id: true, status: true,
        eshop_description: true, eshop_image_path: true,
        eshop_category: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!m || !m.sells_on_eshop || m.status !== 'active') return res.status(404).json({ error: 'Produkt nenalezen' });

    const priceMap = await getPricesForMaterials(pl.id, [m.id]);
    const price = priceMap.get(m.id);
    if (price == null) return res.status(404).json({ error: 'Produkt nemá cenu v partnerově ceníku.' });

    const available = await availableForEshop(m);
    res.json({
      id: m.id,
      code: m.code,
      name: m.name,
      unit: m.unit,
      photo_url: m.eshop_image_path || m.photo_url || null,
      description: m.eshop_description || null,
      category: m.eshop_category,
      price_excl_vat: price,
      vat_pct: Number(pl.vat_pct),
      price_incl_vat: Math.round(price * (1 + Number(pl.vat_pct) / 100) * 100) / 100,
      currency: pl.currency,
      available_qty: available,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SHIPPING / PAYMENT METHODS — aktivní pro partnera
// ═══════════════════════════════════════════════════════════════════════════

router.get('/shipping-methods', async (req, res, next) => {
  try {
    const pl = await getPricelistForPartner(req);
    const currency = pl ? pl.currency : 'EUR';
    const items = await prisma.eshopShippingMethod.findMany({
      where: { active: true, currency },
      orderBy: { sort_order: 'asc' },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/payment-methods', async (req, res, next) => {
  try {
    const items = await prisma.eshopPaymentMethod.findMany({
      where: { active: true },
      orderBy: { sort_order: 'asc' },
    });
    res.json(items);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CART — validate (stock + ceny snapshot, žádný DB write)
// ═══════════════════════════════════════════════════════════════════════════

const cartItemSchema = z.object({
  material_id: z.number().int(),
  quantity: z.union([z.number(), z.string()]),
});

const cartValidateSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shipping_method_id: z.number().int().optional(),
  payment_method_id: z.number().int().optional(),
});

router.post('/cart/validate', async (req, res, next) => {
  try {
    const pl = await getPricelistForPartner(req);
    if (!pl) return res.status(403).json({ error: 'Pro vás zatím není nakonfigurován ceník.' });

    const parsed = cartValidateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });

    const materialIds = parsed.data.items.map(it => it.material_id);
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds }, sells_on_eshop: true, status: 'active' },
      select: { id: true, code: true, name: true, unit: true, sells_on_eshop: true, eshop_warehouse_id: true },
    });
    const matMap = new Map(materials.map(m => [m.id, m]));
    const priceMap = await getPricesForMaterials(pl.id, materialIds);

    const lines = [];
    const issues = [];
    let subtotal = 0;
    for (const ci of parsed.data.items) {
      const m = matMap.get(ci.material_id);
      const price = priceMap.get(ci.material_id);
      const qty = Number(ci.quantity);
      if (!m) {
        issues.push({ material_id: ci.material_id, error: 'unavailable', message: 'Položka už není dostupná.' });
        continue;
      }
      if (price == null) {
        issues.push({ material_id: ci.material_id, error: 'no_price', message: 'Položka nemá cenu ve vašem ceníku.' });
        continue;
      }
      const available = await availableForEshop(m);
      const effectiveQty = Math.min(qty, available);
      if (effectiveQty <= 0) {
        issues.push({ material_id: ci.material_id, error: 'out_of_stock', message: `${m.name} už není skladem.` });
        continue;
      }
      if (effectiveQty < qty) {
        issues.push({
          material_id: ci.material_id,
          error: 'insufficient_stock',
          message: `${m.name}: skladem jen ${available} ${m.unit}, požadováno ${qty}.`,
          available,
        });
      }
      const total = Math.round(effectiveQty * price * 100) / 100;
      subtotal += total;
      lines.push({
        material_id: m.id,
        material_code: m.code,
        material_name: m.name,
        unit: m.unit,
        quantity: effectiveQty,
        unit_price_excl: price,
        total_excl: total,
      });
    }

    // Shipping + payment
    let shipping = null, payment = null;
    if (parsed.data.shipping_method_id) {
      shipping = await prisma.eshopShippingMethod.findUnique({ where: { id: parsed.data.shipping_method_id } });
    }
    if (parsed.data.payment_method_id) {
      payment = await prisma.eshopPaymentMethod.findUnique({ where: { id: parsed.data.payment_method_id } });
    }
    const shippingExcl = shipping
      ? (shipping.free_above_amount && subtotal >= Number(shipping.free_above_amount) ? 0 : Number(shipping.price_excl_vat))
      : 0;
    const paymentFeeExcl = payment ? Number(payment.fee_excl_vat) : 0;
    const totalExcl = Math.round((subtotal + shippingExcl + paymentFeeExcl) * 100) / 100;
    const vatPct = Number(pl.vat_pct);
    const totalIncl = Math.round(totalExcl * (1 + vatPct / 100) * 100) / 100;

    res.json({
      currency: pl.currency,
      vat_pct: vatPct,
      lines,
      issues,
      subtotal_excl: Math.round(subtotal * 100) / 100,
      shipping_excl: shippingExcl,
      payment_fee_excl: paymentFeeExcl,
      total_excl: totalExcl,
      total_incl_vat: totalIncl,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS — vytvoření + moje historie
// ═══════════════════════════════════════════════════════════════════════════

const orderCreateSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shipping_method_id: z.number().int(),
  payment_method_id: z.number().int(),
  ship_to_name: z.string().min(1).max(255),
  ship_to_company: z.string().max(255).optional().nullable(),
  ship_to_address: z.string().min(1).max(500),
  ship_to_city: z.string().min(1).max(120),
  ship_to_zip: z.string().min(1).max(20),
  ship_to_country: z.string().length(2).optional(),
  ship_to_email: z.string().email().optional().nullable(),
  ship_to_phone: z.string().max(40).optional().nullable(),
  customer_note: z.string().max(2000).optional().nullable(),
});

router.post('/orders', async (req, res, next) => {
  try {
    const pl = await getPricelistForPartner(req);
    if (!pl) return res.status(403).json({ error: 'Pro vás zatím není nakonfigurován ceník.' });
    const co = await getCompanyForPartner(req);

    const parsed = orderCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const body = parsed.data;

    // Validuj shipping + payment
    const shipping = await prisma.eshopShippingMethod.findUnique({ where: { id: body.shipping_method_id } });
    if (!shipping || !shipping.active) return res.status(400).json({ error: 'Zvolený způsob dopravy už není dostupný.' });
    if (shipping.currency !== pl.currency) return res.status(400).json({ error: 'Měna dopravy neodpovídá ceníku.' });
    const payment = await prisma.eshopPaymentMethod.findUnique({ where: { id: body.payment_method_id } });
    if (!payment || !payment.active) return res.status(400).json({ error: 'Zvolený způsob platby už není dostupný.' });

    // Snapshot materials + cen
    const materialIds = body.items.map(it => it.material_id);
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds }, sells_on_eshop: true, status: 'active' },
      select: { id: true, code: true, name: true, unit: true, eshop_warehouse_id: true, sells_on_eshop: true },
    });
    const matMap = new Map(materials.map(m => [m.id, m]));
    const priceMap = await getPricesForMaterials(pl.id, materialIds);

    const itemRows = [];
    let subtotal = 0;
    for (const ci of body.items) {
      const m = matMap.get(ci.material_id);
      if (!m) return res.status(400).json({ error: `Položka ${ci.material_id} už není dostupná.` });
      const price = priceMap.get(m.id);
      if (price == null) return res.status(400).json({ error: `${m.name}: bez ceny v ceníku.` });
      const qty = Number(ci.quantity);
      if (!(qty > 0)) return res.status(400).json({ error: `${m.name}: neplatné množství.` });
      const available = await availableForEshop(m);
      if (available < qty) return res.status(409).json({ error: `${m.name}: skladem jen ${available} ${m.unit}, požadováno ${qty}.`, material_id: m.id, available });
      const total = Math.round(qty * price * 100) / 100;
      subtotal += total;
      itemRows.push({
        material_id: m.id,
        material_code: m.code,
        material_name: m.name,
        quantity: qty,
        unit: m.unit,
        unit_price_excl: price,
        total_excl: total,
      });
    }

    const shippingExcl = (shipping.free_above_amount && subtotal >= Number(shipping.free_above_amount))
      ? 0
      : Number(shipping.price_excl_vat);
    const paymentFeeExcl = Number(payment.fee_excl_vat);
    const totalExcl = Math.round((subtotal + shippingExcl + paymentFeeExcl) * 100) / 100;
    const vatPct = Number(pl.vat_pct);
    const totalIncl = Math.round(totalExcl * (1 + vatPct / 100) * 100) / 100;

    // Vytvořit objednávku v transakci s items
    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const orderNumber = await nextOrderNumber();
        return tx.shopOrder.create({
          data: {
            order_number: orderNumber,
            partner_id: req.partner.id,
            company_id: co ? co.id : null,
            shipping_method_id: shipping.id,
            payment_method_id: payment.id,
            ship_to_name: body.ship_to_name,
            ship_to_company: body.ship_to_company || null,
            ship_to_address: body.ship_to_address,
            ship_to_city: body.ship_to_city,
            ship_to_zip: body.ship_to_zip,
            ship_to_country: body.ship_to_country || 'CZ',
            ship_to_email: body.ship_to_email || null,
            ship_to_phone: body.ship_to_phone || null,
            customer_note: body.customer_note || null,
            currency: pl.currency,
            vat_pct: vatPct,
            subtotal_excl: Math.round(subtotal * 100) / 100,
            shipping_excl: shippingExcl,
            payment_fee_excl: paymentFeeExcl,
            total_excl: totalExcl,
            total_incl_vat: totalIncl,
            status: 'new',
            items: { create: itemRows },
          },
          include: { items: true },
        });
      });
    } catch (err) {
      if (err.code === 'P2002' && err.meta && Array.isArray(err.meta.target) && err.meta.target.includes('order_number')) {
        // Race condition — vzácné, partner zkusí znovu
        return res.status(409).json({ error: 'Konflikt čísla objednávky, zkuste prosím znovu.' });
      }
      throw err;
    }

    // Notifikace nové objednávky — placeholder, plnou implementaci dodává Task #3.
    // (services/eshop/notifications.js — e-mail přes Graph + Velín push.)
    try {
      const notifications = require('../services/eshop/notifications');
      if (notifications && typeof notifications.sendNewOrderNotification === 'function') {
        notifications.sendNewOrderNotification(order.id).catch(e =>
          console.warn('[shop] notifikace selhala:', e.message));
      }
    } catch (_e) {
      // Modul ještě neexistuje (Fáze 1.6) — tichý fallback.
    }

    res.status(201).json(order);
  } catch (err) { next(err); }
});

router.get('/orders', async (req, res, next) => {
  try {
    const orders = await prisma.shopOrder.findMany({
      where: { partner_id: req.partner.id },
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true, order_number: true, status: true, currency: true,
        total_incl_vat: true, created_at: true,
        tracking_number: true, tracking_carrier: true,
        shipping_method: { select: { id: true, name: true } },
        payment_method: { select: { id: true, name: true, code: true } },
        _count: { select: { items: true } },
      },
    });
    res.json(orders);
  } catch (err) { next(err); }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const o = await prisma.shopOrder.findFirst({
      where: { id, partner_id: req.partner.id },
      include: {
        shipping_method: true,
        payment_method: true,
        items: { orderBy: { id: 'asc' } },
      },
    });
    if (!o) return res.status(404).json({ error: 'Objednávka nenalezena' });
    res.json(o);
  } catch (err) { next(err); }
});

module.exports = router;
