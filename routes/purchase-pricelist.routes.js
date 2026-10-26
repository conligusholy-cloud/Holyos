// =============================================================================
// HolyOS — Nákupní ceník (dodavatelé, ceny a dodací lhůty zboží)
// =============================================================================
// Nad modelem SupplierPriceList (+ SupplierPriceListItem = množstevní tiery).
// Jedno zboží může mít více dodavatelů; jedna nabídka = dodavatel × zboží × platnost.
// Primární nabídka se zrcadlí do polí zboží (supplier_id, unit_price, lead_time_days),
// aby dál fungovala stávající logika objednávek, nákupního asistenta a plánování.
// Mount: /api/wh/pricelist
// =============================================================================

const express = require('express');
const { z } = require('zod');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

router.use(requireAuth);

// ---------- Pomocné funkce ----------

const num = (v) => (v === null || v === undefined ? null : Number(v));

// Prázdný řetězec / null / undefined → null, jinak číslo
const optNum = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : v),
  z.coerce.number().nullable()
);
const optDate = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : v),
  z.string().nullable()
);

const tierSchema = z.object({
  quantity_min: optNum.refine((v) => v === null || v >= 0, 'Minimální množství nesmí být záporné'),
  price: z.coerce.number({ error: 'Cena musí být číslo' }).min(0, 'Cena nesmí být záporná'),
  currency: z.preprocess((v) => (v ? String(v).trim().toUpperCase() : 'CZK'), z.string().length(3, 'Měna musí mít 3 znaky')),
  min_order_quantity: optNum,
  delivery_time_days: optNum.refine((v) => v === null || v >= 0, 'Doba dodání nesmí být záporná'),
  additional_cost: optNum,
});

const offerSchema = z.object({
  supplier_id: z.coerce.number({ error: 'Vyber dodavatele' }).int('Vyber dodavatele').positive('Vyber dodavatele'),
  valid_from: optDate,
  valid_to: optDate,
  is_primary: z.boolean().optional(),
  is_valid: z.boolean().optional(),
  note: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  country_of_origin: z.preprocess((v) => (v ? String(v).trim().toUpperCase().slice(0, 2) : null), z.string().nullable().optional()),
  supplier_part_no: z.preprocess((v) => (v ? String(v).trim().slice(0, 100) : null), z.string().nullable().optional()),
  tiers: z.array(tierSchema).min(1, 'Zadej alespoň jednu cenu'),
});

function parseDateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Základní tier = nejnižší minimální množství (null = 0)
function baseTier(items) {
  if (!items || !items.length) return null;
  return [...items].sort((a, b) => (num(a.quantity_min) || 0) - (num(b.quantity_min) || 0))[0];
}

function serializeOffer(l) {
  const items = (l.items || []).slice().sort((a, b) => (num(a.quantity_min) || 0) - (num(b.quantity_min) || 0));
  const base = baseTier(items);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expired = !!(l.valid_to && new Date(l.valid_to) < today);
  const future = !!(l.valid_from && new Date(l.valid_from) > today);
  return {
    id: l.id,
    material_id: l.material_id,
    supplier_id: l.supplier_id,
    supplier_name: l.supplier ? l.supplier.name : null,
    is_primary: !!l.is_primary,
    is_valid: !!l.is_valid,
    valid_from: l.valid_from,
    valid_to: l.valid_to,
    expired,
    future,
    active: !!l.is_valid && !expired && !future,
    note: l.note,
    country_of_origin: l.country_of_origin,
    supplier_part_no: (items.find((i) => i.supplier_part_no) || {}).supplier_part_no || null,
    price: base ? num(base.price) : null,
    currency: base ? base.currency : null,
    delivery_days: base ? base.delivery_time_days : null,
    moq: base ? num(base.min_order_quantity) : null,
    tiers: items.map((i) => ({
      id: i.id,
      quantity_min: num(i.quantity_min),
      price: num(i.price),
      currency: i.currency,
      additional_cost: num(i.additional_cost),
      min_order_quantity: num(i.min_order_quantity),
      delivery_time_days: i.delivery_time_days,
      supplier_part_no: i.supplier_part_no,
    })),
  };
}

const offerInclude = { supplier: { select: { id: true, name: true } }, items: true };

// Zrcadlí primární (platnou) nabídku do karty zboží. Vrací, co se změnilo (pro UI).
async function syncPrimary(materialId) {
  const primary = await prisma.supplierPriceList.findFirst({
    where: { material_id: materialId, is_primary: true, is_valid: true },
    include: { items: true },
    orderBy: { id: 'desc' },
  });
  if (!primary) return null;
  const base = baseTier(primary.items);
  const data = { supplier_id: primary.supplier_id };
  if (base && base.currency === 'CZK') data.unit_price = num(base.price);
  if (base && base.delivery_time_days !== null && base.delivery_time_days !== undefined) data.lead_time_days = base.delivery_time_days;
  await prisma.material.update({ where: { id: materialId }, data });
  return data;
}

async function audit(req, action, entityId, description, extra) {
  try {
    await logAudit({ action, entity: 'supplier_price_list', entity_id: entityId, description, changes: extra || null, user: req.user });
  } catch (e) { console.warn('[pricelist] audit selhal:', e.message); }
}

function validationError(res, parsed) {
  const first = parsed.error.issues[0];
  return res.status(400).json({ error: (first && first.message) || 'Neplatná data', issues: parsed.error.issues });
}

// ---------- GET /api/wh/pricelist — přehled ceníku (zboží × dodavatelé) ----------
// Query: q (kód/název zboží), supplier_id, only_active=1 (výchozí), no_offer=1 (zboží bez ceníku), limit, offset
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const supplierId = req.query.supplier_id ? parseInt(req.query.supplier_id) : null;
    const onlyActive = req.query.only_active !== '0';
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 300, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const where = {};
    if (supplierId) where.supplier_id = supplierId;
    if (q) where.material = { OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] };
    if (onlyActive) {
      where.is_valid = true;
      where.AND = [
        { OR: [{ valid_from: null }, { valid_from: { lte: today } }] },
        { OR: [{ valid_to: null }, { valid_to: { gte: today } }] },
      ];
    }

    // Stránkujeme po zboží: nejdřív id zboží s nabídkou, pak jejich nabídky
    const mats = await prisma.supplierPriceList.findMany({
      where, select: { material_id: true }, distinct: ['material_id'],
      orderBy: { material: { code: 'asc' } }, skip: offset, take: limit,
    });
    const total = (await prisma.supplierPriceList.findMany({ where, select: { material_id: true }, distinct: ['material_id'] })).length;
    const ids = mats.map((m) => m.material_id);

    const lists = ids.length ? await prisma.supplierPriceList.findMany({
      where: { ...where, material_id: { in: ids } },
      include: { ...offerInclude, material: { select: { id: true, code: true, name: true, unit: true } } },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
    }) : [];

    const groups = new Map();
    for (const l of lists) {
      if (!groups.has(l.material_id)) groups.set(l.material_id, { material: l.material, offers: [] });
      groups.get(l.material_id).offers.push(serializeOffer(l));
    }
    const items = ids.map((id) => groups.get(id)).filter(Boolean).map((g) => {
      // Nejlevnější (v CZK) a nejrychlejší nabídka mezi aktivními
      const act = g.offers.filter((o) => o.active && o.price !== null);
      const czk = act.filter((o) => o.currency === 'CZK');
      const cheapest = czk.length > 1 ? czk.reduce((a, b) => (b.price < a.price ? b : a)) : null;
      const withDays = act.filter((o) => o.delivery_days !== null && o.delivery_days !== undefined);
      const fastest = withDays.length > 1 ? withDays.reduce((a, b) => (b.delivery_days < a.delivery_days ? b : a)) : null;
      g.offers.forEach((o) => { o.cheapest = !!(cheapest && cheapest.id === o.id); o.fastest = !!(fastest && fastest.id === o.id); });
      return g;
    });
    res.json({ total, limit, offset, items });
  } catch (err) { next(err); }
});

// ---------- GET /api/wh/pricelist/material/:materialId — nabídky jednoho zboží ----------
router.get('/material/:materialId', async (req, res, next) => {
  try {
    const materialId = parseInt(req.params.materialId);
    const lists = await prisma.supplierPriceList.findMany({
      where: { material_id: materialId }, include: offerInclude,
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
    });
    res.json(lists.map(serializeOffer));
  } catch (err) { next(err); }
});

// ---------- POST /api/wh/pricelist/material/:materialId — nová nabídka dodavatele ----------
router.post('/material/:materialId', async (req, res, next) => {
  try {
    const materialId = parseInt(req.params.materialId);
    const parsed = offerSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    const d = parsed.data;

    const material = await prisma.material.findUnique({ where: { id: materialId }, select: { id: true, name: true } });
    if (!material) return res.status(404).json({ error: 'Zboží nenalezeno' });
    const supplier = await prisma.company.findUnique({ where: { id: d.supplier_id }, select: { id: true, name: true } });
    if (!supplier) return res.status(400).json({ error: 'Dodavatel nenalezen' });

    const existing = await prisma.supplierPriceList.count({ where: { material_id: materialId, is_primary: true, is_valid: true } });
    const makePrimary = d.is_primary === true || existing === 0; // první nabídka je automaticky primární

    const created = await prisma.$transaction(async (tx) => {
      if (makePrimary) await tx.supplierPriceList.updateMany({ where: { material_id: materialId }, data: { is_primary: false } });
      return tx.supplierPriceList.create({
        data: {
          supplier_id: d.supplier_id, material_id: materialId,
          valid_from: parseDateOnly(d.valid_from), valid_to: parseDateOnly(d.valid_to),
          is_primary: makePrimary, is_valid: d.is_valid !== false,
          country_of_origin: d.country_of_origin || null, note: d.note || null,
          items: { create: d.tiers.map((t) => ({
            quantity_min: t.quantity_min, price: t.price, currency: t.currency,
            additional_cost: t.additional_cost, additional_cost_currency: t.additional_cost !== null ? t.currency : null,
            min_order_quantity: t.min_order_quantity, delivery_time_days: t.delivery_time_days === null ? null : Math.round(t.delivery_time_days),
            supplier_part_no: d.supplier_part_no || null,
          })) },
        },
        include: offerInclude,
      });
    });
    const sync = makePrimary ? await syncPrimary(materialId) : null;
    await audit(req, 'create', created.id, `Nákupní ceník: ${material.name} — dodavatel ${supplier.name}`);
    res.status(201).json({ offer: serializeOffer(created), material_sync: sync });
  } catch (err) { next(err); }
});

// ---------- PUT /api/wh/pricelist/:id — úprava nabídky (včetně nahrazení tierů) ----------
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = offerSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    const d = parsed.data;

    const before = await prisma.supplierPriceList.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, material: { select: { name: true } } } });
    if (!before) return res.status(404).json({ error: 'Nabídka nenalezena' });
    const supplier = await prisma.company.findUnique({ where: { id: d.supplier_id }, select: { id: true } });
    if (!supplier) return res.status(400).json({ error: 'Dodavatel nenalezen' });

    const updated = await prisma.$transaction(async (tx) => {
      if (d.is_primary === true) await tx.supplierPriceList.updateMany({ where: { material_id: before.material_id, id: { not: id } }, data: { is_primary: false } });
      await tx.supplierPriceListItem.deleteMany({ where: { price_list_id: id } });
      return tx.supplierPriceList.update({
        where: { id },
        data: {
          supplier_id: d.supplier_id,
          valid_from: parseDateOnly(d.valid_from), valid_to: parseDateOnly(d.valid_to),
          is_primary: d.is_primary === undefined ? before.is_primary : d.is_primary,
          is_valid: d.is_valid === undefined ? before.is_valid : d.is_valid,
          country_of_origin: d.country_of_origin || null, note: d.note || null,
          items: { create: d.tiers.map((t) => ({
            quantity_min: t.quantity_min, price: t.price, currency: t.currency,
            additional_cost: t.additional_cost, additional_cost_currency: t.additional_cost !== null ? t.currency : null,
            min_order_quantity: t.min_order_quantity, delivery_time_days: t.delivery_time_days === null ? null : Math.round(t.delivery_time_days),
            supplier_part_no: d.supplier_part_no || null,
          })) },
        },
        include: offerInclude,
      });
    });
    const sync = updated.is_primary ? await syncPrimary(before.material_id) : null;
    await audit(req, 'update', id, `Nákupní ceník upraven: ${before.material.name} — ${updated.supplier ? updated.supplier.name : ''}`);
    res.json({ offer: serializeOffer(updated), material_sync: sync });
  } catch (err) { next(err); }
});

// ---------- POST /api/wh/pricelist/:id/primary — nastavit jako primární ----------
router.post('/:id/primary', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const l = await prisma.supplierPriceList.findUnique({ where: { id }, select: { id: true, material_id: true } });
    if (!l) return res.status(404).json({ error: 'Nabídka nenalezena' });
    await prisma.$transaction([
      prisma.supplierPriceList.updateMany({ where: { material_id: l.material_id }, data: { is_primary: false } }),
      prisma.supplierPriceList.update({ where: { id }, data: { is_primary: true, is_valid: true } }),
    ]);
    const sync = await syncPrimary(l.material_id);
    await audit(req, 'update', id, 'Nákupní ceník: nastaven primární dodavatel');
    res.json({ ok: true, material_sync: sync });
  } catch (err) { next(err); }
});

// ---------- DELETE /api/wh/pricelist/:id ----------
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const l = await prisma.supplierPriceList.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, material: { select: { name: true } } } });
    if (!l) return res.status(404).json({ error: 'Nabídka nenalezena' });
    await prisma.supplierPriceList.delete({ where: { id } }); // položky se smažou kaskádně
    let sync = null;
    if (l.is_primary) {
      // Po smazání primární povýšit nejnovější zbývající platnou nabídku
      const next = await prisma.supplierPriceList.findFirst({ where: { material_id: l.material_id, is_valid: true }, orderBy: { id: 'desc' } });
      if (next) {
        await prisma.supplierPriceList.update({ where: { id: next.id }, data: { is_primary: true } });
        sync = await syncPrimary(l.material_id);
      }
    }
    await audit(req, 'delete', id, `Nákupní ceník smazán: ${l.material.name} — ${l.supplier ? l.supplier.name : ''}`);
    res.json({ ok: true, material_sync: sync });
  } catch (err) { next(err); }
});

module.exports = router;
