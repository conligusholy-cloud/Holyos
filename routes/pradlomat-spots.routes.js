// =============================================================================
// HolyOS — Předjednaná místa pro prádlomat
// =============================================================================
// Samostatný koncept (ZÁMĚRNĚ oddělený od Site / bestseries.global):
//   • Veřejný přehled na pradlomaty.info/location — místa, která už máme
//     předjednaná a nabízíme je zájemcům/provozovatelům (mapa + karty + detail
//     + formulář "Mám zájem").
//   • Interní správa v Prodejních objednávkách (záložka Předjednaná místa).
//
// Mount: /api/pradlomat-spots v app.js.
//   Veřejné endpointy (/public/...) jsou BEZ auth (deklarované nad requireAuth).
//   Interní endpointy vyžadují JWT (requireAuth).
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const SPOT_STATUSES = ['draft', 'published', 'reserved', 'taken', 'archived'];
const NOMINATIM_UA = 'HolyOS-Pradlomaty/1.0 (+https://pradlomaty.info; tomas.holy@bestseries.cz)';

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || null;
}

function actorPersonId(req) {
  return req.user && req.user.person ? req.user.person.id : null;
}

// Diakritika pryč, mezery→pomlčky, jen [a-z0-9-].
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'misto';
}

// Vytvoří unikátní kód (slug + případně číselná přípona).
async function uniqueCode(base) {
  let code = slugify(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.pradlomatSpot.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
    i += 1;
    code = `${slugify(base)}-${i}`;
  }
}

// Serializace Decimalů → number (aby na frontendu nebyly stringy).
function num(v) { return v == null ? null : Number(v); }

// Veřejná podoba místa (jen to, co má vidět návštěvník webu).
function toPublic(s) {
  return {
    code: s.code,
    title: s.title,
    city: s.city,
    region: s.region,
    country: s.country,
    address: s.show_address ? s.address : null,
    latitude: num(s.latitude),
    longitude: num(s.longitude),
    public_description: s.public_description,
    highlight: s.highlight,
    area_m2: num(s.area_m2),
    rent_monthly: num(s.rent_monthly),
    rent_currency: s.rent_currency,
    footfall_note: s.footfall_note,
    availability_note: s.availability_note,
    cover_image_url: s.cover_image_url,
    gallery: Array.isArray(s.gallery) ? s.gallery : [],
    status: s.status,
  };
}

// Interní podoba (vše).
function toAdmin(s) {
  return {
    id: s.id,
    code: s.code,
    title: s.title,
    status: s.status,
    is_public: s.is_public,
    city: s.city,
    region: s.region,
    country: s.country,
    address: s.address,
    show_address: s.show_address,
    latitude: num(s.latitude),
    longitude: num(s.longitude),
    public_description: s.public_description,
    highlight: s.highlight,
    area_m2: num(s.area_m2),
    rent_monthly: num(s.rent_monthly),
    rent_currency: s.rent_currency,
    footfall_note: s.footfall_note,
    availability_note: s.availability_note,
    cover_image_url: s.cover_image_url,
    gallery: Array.isArray(s.gallery) ? s.gallery : [],
    owner_name: s.owner_name,
    owner_phone: s.owner_phone,
    owner_email: s.owner_email,
    internal_notes: s.internal_notes,
    electricity_kw: num(s.electricity_kw),
    water_supply: s.water_supply,
    sewage: s.sewage,
    assigned_to_id: s.assigned_to_id,
    created_by_id: s.created_by_id,
    sort_order: s.sort_order,
    created_at: s.created_at,
    updated_at: s.updated_at,
    inquiries_count: s._count ? s._count.inquiries : undefined,
    new_inquiries: s._count ? undefined : s.new_inquiries,
  };
}

// Notifikace o nové poptávce — majitelům (push + zvonek), fire-and-forget.
const SPOT_NOTIFY_LINK = '/modules/prodejni-objednavky/index.html';
async function notifyOwners({ title, body }) {
  try {
    const emails = (process.env.COMPOUNDER_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const persons = await prisma.person.findMany({
      where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
      select: { id: true, user_id: true },
    });
    if (!persons.length) return;
    let notifyPerson = null, createNotification = null;
    try { notifyPerson = require('../services/push/expo-push').notifyPerson; } catch (e) { /* push nedostupný */ }
    try { createNotification = require('./notifications.routes').createNotification; } catch (e) { /* zvonek nedostupný */ }
    for (const p of persons) {
      if (notifyPerson) {
        Promise.resolve(notifyPerson(prisma, p.id, { title, body, data: { link: SPOT_NOTIFY_LINK }, sound: 'default' }))
          .catch((e) => console.warn('[spots] push', p.id, e && e.message));
      }
      if (p.user_id && createNotification) {
        createNotification({ userId: p.user_id, type: 'system', title, body, link: SPOT_NOTIFY_LINK })
          .catch((e) => console.warn('[spots] zvonek', p.user_id, e && e.message));
      }
    }
  } catch (e) {
    console.error('[spots] notifyOwners:', e && e.message);
  }
}

// =============================================================================
// VEŘEJNÉ ENDPOINTY (bez auth) — pro web pradlomaty.info/location
// =============================================================================

// GET /api/pradlomat-spots/public — seznam zveřejněných míst.
router.get('/public', async (req, res, next) => {
  try {
    const spots = await prisma.pradlomatSpot.findMany({
      where: { is_public: true, status: { in: ['published', 'reserved'] } },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
    });
    res.json(spots.map(toPublic));
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots/public/:code — detail jednoho místa.
router.get('/public/:code', async (req, res, next) => {
  try {
    const s = await prisma.pradlomatSpot.findUnique({ where: { code: String(req.params.code || '') } });
    if (!s || !s.is_public || !['published', 'reserved'].includes(s.status)) {
      return res.status(404).json({ error: 'Místo nenalezeno' });
    }
    res.json(toPublic(s));
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/public/:code/inquiry — poptávka "Mám zájem".
const inquirySchema = z.object({
  name: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  message: z.string().trim().max(4000).optional(),
});
router.post('/public/:code/inquiry', async (req, res, next) => {
  try {
    const parsed = inquirySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný formulář' });
    const d = parsed.data;
    if (!d.phone && !d.email) return res.status(400).json({ error: 'Zadejte telefon nebo e-mail.' });

    const spot = await prisma.pradlomatSpot.findUnique({ where: { code: String(req.params.code || '') } });
    if (!spot || !spot.is_public) return res.status(404).json({ error: 'Místo nenalezeno' });

    await prisma.pradlomatSpotInquiry.create({
      data: {
        spot_id: spot.id,
        name: d.name || null,
        phone: d.phone || null,
        email: d.email || null,
        message: d.message || null,
        source: 'pradlomaty.info/location',
      },
    });

    notifyOwners({
      title: 'Nová poptávka místa',
      body: `${d.name || d.phone || d.email || 'Zájemce'} — ${spot.title}`,
    });

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// INTERNÍ ENDPOINTY (vyžadují přihlášení)
// =============================================================================
router.use(requireAuth);

// GET /api/pradlomat-spots/geocode?q=adresa — proxy na Nominatim.
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'cs' } });
    if (!r.ok) return res.json([]);
    const arr = await r.json();
    res.json((Array.isArray(arr) ? arr : []).map((x) => ({
      display_name: x.display_name,
      lat: Number(x.lat),
      lon: Number(x.lon),
      city: (x.address && (x.address.city || x.address.town || x.address.village)) || null,
      country: (x.address && x.address.country) || null,
    })));
  } catch (e) {
    res.json([]);
  }
});

// GET /api/pradlomat-spots — seznam všech (správa).
router.get('/', async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const where = {};
    if (status && SPOT_STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { owner_name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const spots = await prisma.pradlomatSpot.findMany({
      where,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
      include: { _count: { select: { inquiries: true } } },
    });
    // Kolik nových poptávek u každého místa.
    const newCounts = await prisma.pradlomatSpotInquiry.groupBy({
      by: ['spot_id'], where: { status: 'new' }, _count: { _all: true },
    });
    const newMap = {}; newCounts.forEach((c) => { newMap[c.spot_id] = c._count._all; });
    res.json(spots.map((s) => Object.assign(toAdmin(s), { new_inquiries: newMap[s.id] || 0 })));
  } catch (err) { next(err); }
});

// Validace pro create/update.
const spotSchema = z.object({
  title: z.string().trim().min(1).max(255),
  code: z.string().trim().max(80).optional(),
  status: z.enum(['draft', 'published', 'reserved', 'taken', 'archived']).optional(),
  is_public: z.boolean().optional(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(60).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  show_address: z.boolean().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  public_description: z.string().trim().max(8000).optional().nullable(),
  highlight: z.string().trim().max(160).optional().nullable(),
  area_m2: z.number().optional().nullable(),
  rent_monthly: z.number().optional().nullable(),
  rent_currency: z.string().trim().max(3).optional().nullable(),
  footfall_note: z.string().trim().max(255).optional().nullable(),
  availability_note: z.string().trim().max(255).optional().nullable(),
  cover_image_url: z.string().trim().max(500).optional().nullable(),
  gallery: z.array(z.string()).optional().nullable(),
  owner_name: z.string().trim().max(255).optional().nullable(),
  owner_phone: z.string().trim().max(40).optional().nullable(),
  owner_email: z.string().trim().max(255).optional().nullable(),
  internal_notes: z.string().trim().max(8000).optional().nullable(),
  electricity_kw: z.number().optional().nullable(),
  water_supply: z.boolean().optional().nullable(),
  sewage: z.boolean().optional().nullable(),
  assigned_to_id: z.number().int().optional().nullable(),
  sort_order: z.number().int().optional(),
});

function emptyToNull(v) { return v === '' ? null : v; }

// POST /api/pradlomat-spots — vytvoření.
router.post('/', async (req, res, next) => {
  try {
    const parsed = spotSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.issues });
    const d = parsed.data;
    const code = d.code ? await uniqueCode(d.code) : await uniqueCode(d.city ? `${d.city}-${d.title}` : d.title);
    // Pojistka: zveřejnit lze jen se statusem published/reserved.
    let is_public = !!d.is_public;
    const status = d.status || 'draft';
    if (is_public && !['published', 'reserved'].includes(status)) is_public = false;

    const created = await prisma.pradlomatSpot.create({
      data: {
        code,
        title: d.title,
        status,
        is_public,
        city: emptyToNull(d.city), region: emptyToNull(d.region), country: emptyToNull(d.country) || 'CZ',
        address: emptyToNull(d.address), show_address: !!d.show_address,
        latitude: d.latitude ?? null, longitude: d.longitude ?? null,
        public_description: emptyToNull(d.public_description), highlight: emptyToNull(d.highlight),
        area_m2: d.area_m2 ?? null, rent_monthly: d.rent_monthly ?? null,
        rent_currency: emptyToNull(d.rent_currency) || 'CZK',
        footfall_note: emptyToNull(d.footfall_note), availability_note: emptyToNull(d.availability_note),
        cover_image_url: emptyToNull(d.cover_image_url), gallery: d.gallery || undefined,
        owner_name: emptyToNull(d.owner_name), owner_phone: emptyToNull(d.owner_phone),
        owner_email: emptyToNull(d.owner_email), internal_notes: emptyToNull(d.internal_notes),
        electricity_kw: d.electricity_kw ?? null, water_supply: d.water_supply ?? null, sewage: d.sewage ?? null,
        assigned_to_id: d.assigned_to_id ?? null,
        created_by_id: actorPersonId(req),
        sort_order: d.sort_order ?? 0,
      },
    });
    res.status(201).json(toAdmin(created));
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots/:id — detail + poptávky.
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const s = await prisma.pradlomatSpot.findUnique({
      where: { id: Number(req.params.id) },
      include: { inquiries: { orderBy: { created_at: 'desc' } } },
    });
    if (!s) return res.status(404).json({ error: 'Místo nenalezeno' });
    const out = toAdmin(s);
    out.inquiries = s.inquiries;
    res.json(out);
  } catch (err) { next(err); }
});

// PUT /api/pradlomat-spots/:id — úprava.
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const parsed = spotSchema.partial().safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.issues });
    const d = parsed.data;
    const existing = await prisma.pradlomatSpot.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Místo nenalezeno' });

    const data = {};
    const setIf = (key, val) => { if (val !== undefined) data[key] = val; };
    setIf('title', d.title);
    if (d.code !== undefined && d.code && d.code !== existing.code) data.code = await uniqueCode(d.code);
    setIf('status', d.status);
    setIf('city', emptyToNull(d.city)); setIf('region', emptyToNull(d.region));
    if (d.country !== undefined) data.country = emptyToNull(d.country) || 'CZ';
    setIf('address', emptyToNull(d.address)); setIf('show_address', d.show_address);
    setIf('latitude', d.latitude); setIf('longitude', d.longitude);
    setIf('public_description', emptyToNull(d.public_description)); setIf('highlight', emptyToNull(d.highlight));
    setIf('area_m2', d.area_m2); setIf('rent_monthly', d.rent_monthly);
    if (d.rent_currency !== undefined) data.rent_currency = emptyToNull(d.rent_currency) || 'CZK';
    setIf('footfall_note', emptyToNull(d.footfall_note)); setIf('availability_note', emptyToNull(d.availability_note));
    setIf('cover_image_url', emptyToNull(d.cover_image_url));
    if (d.gallery !== undefined) data.gallery = d.gallery || [];
    setIf('owner_name', emptyToNull(d.owner_name)); setIf('owner_phone', emptyToNull(d.owner_phone));
    setIf('owner_email', emptyToNull(d.owner_email)); setIf('internal_notes', emptyToNull(d.internal_notes));
    setIf('electricity_kw', d.electricity_kw); setIf('water_supply', d.water_supply); setIf('sewage', d.sewage);
    setIf('assigned_to_id', d.assigned_to_id); setIf('sort_order', d.sort_order);

    // Pojistka viditelnosti: is_public jen s published/reserved.
    if (d.is_public !== undefined) data.is_public = !!d.is_public;
    const finalStatus = data.status || existing.status;
    const finalPublic = data.is_public !== undefined ? data.is_public : existing.is_public;
    if (finalPublic && !['published', 'reserved'].includes(finalStatus)) data.is_public = false;

    const updated = await prisma.pradlomatSpot.update({ where: { id: existing.id }, data });
    res.json(toAdmin(updated));
  } catch (err) { next(err); }
});

// DELETE /api/pradlomat-spots/:id — smazání (i s poptávkami přes onDelete: Cascade).
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    await prisma.pradlomatSpot.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    if (err && err.code === 'P2025') return res.status(404).json({ error: 'Místo nenalezeno' });
    next(err);
  }
});

// PUT /api/pradlomat-spots/inquiries/:iid — změna stavu poptávky.
router.put('/inquiries/:iid(\\d+)', async (req, res, next) => {
  try {
    const status = String((req.body && req.body.status) || '').trim();
    if (!['new', 'handled'].includes(status)) return res.status(400).json({ error: 'Neplatný stav' });
    const upd = await prisma.pradlomatSpotInquiry.update({
      where: { id: Number(req.params.iid) }, data: { status },
    });
    res.json(upd);
  } catch (err) {
    if (err && err.code === 'P2025') return res.status(404).json({ error: 'Poptávka nenalezena' });
    next(err);
  }
});

module.exports = router;
