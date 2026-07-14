// =============================================================================
// HolyOS — Modul Site Development (řízení expanze)
// =============================================================================
// CRUD pro lokality / pozemky (Site) + kontakty + historie komunikace +
// fotografie + dokumenty. Vyhledávání, filtrování, porovnání lokalit pro
// rozhodnutí o umístění prádlomatu.
//
// Mount: /api/sites v app.js.
// Všechny endpointy vyžadují JWT (requireAuth).

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// ─── Konstanty ──────────────────────────────────────────────────────────────
const SITE_TYPES   = ['rent', 'purchase', 'other'];
const SITE_STATUSES = ['lead', 'researching', 'negotiating', 'contract', 'operational', 'rejected', 'lost'];
const COMM_CHANNELS = ['call', 'email', 'meeting', 'sms', 'note'];
const DOC_TYPES     = ['contract', 'offer', 'cadastre', 'technical', 'other'];

// Úložiště pro fotky a dokumenty (Railway persistent volume)
const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PHOTOS_DIR = path.join(DATA_ROOT, 'site-photos');
const DOCS_DIR   = path.join(DATA_ROOT, 'site-docs');
for (const d of [PHOTOS_DIR, DOCS_DIR]) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
}

// ─── Auth pro všechny endpointy ─────────────────────────────────────────────
router.use(requireAuth);

// ─── Pomocné funkce ─────────────────────────────────────────────────────────

// Vrátí person_id přihlášeného uživatele (nebo null pokud jen User bez Person).
function actorPersonId(req) {
  return req.user && req.user.person ? req.user.person.id : null;
}

// Sanitizace decimal — vrací string nebo null. Prisma Decimal akceptuje string.
function toDecimal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

// Statistiky pro horní lištu (počty po statusech, agregace nákladů).
async function buildStats() {
  const [total, byStatus, byType, avgRent] = await Promise.all([
    prisma.site.count(),
    prisma.site.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.site.groupBy({ by: ['site_type'], _count: { _all: true } }),
    prisma.site.aggregate({
      _avg: { rent_monthly: true },
      where: { rent_monthly: { not: null }, status: { notIn: ['rejected', 'lost'] } },
    }),
  ]);
  const statusMap = Object.fromEntries(byStatus.map(r => [r.status, r._count._all]));
  const typeMap   = Object.fromEntries(byType.map(r => [r.site_type, r._count._all]));
  return {
    total,
    active: total - (statusMap.rejected || 0) - (statusMap.lost || 0),
    by_status: statusMap,
    by_type: typeMap,
    avg_rent: avgRent._avg.rent_monthly ? Number(avgRent._avg.rent_monthly) : null,
  };
}

// ─── GET /api/sites ─────────────────────────────────────────────────────────
// Filtry: q (full-text), status, site_type, city, assigned_to_id.
// Stránkování: page (1..n), per_page (default 50, max 200).
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const status = req.query.status || '';
    const site_type = req.query.site_type || '';
    const city = (req.query.city || '').trim();
    const assignedTo = req.query.assigned_to_id ? parseInt(req.query.assigned_to_id, 10) : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 50));

    const where = {};
    if (status && SITE_STATUSES.includes(status)) where.status = status;
    if (site_type && SITE_TYPES.includes(site_type)) where.site_type = site_type;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (assignedTo) where.assigned_to_id = assignedTo;
    // Zdroj: 'public' = jen nabídky z veřejného webu (bestseries.global), 'internal' = jen interní.
    const source = (req.query.source || '').trim();
    if (source === 'public') where.public_source = { not: null };
    else if (source === 'internal') where.public_source = null;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { owner_name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { cadastral_area: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total, stats] = await Promise.all([
      prisma.site.findMany({
        where,
        include: {
          assigned_to: { select: { id: true, first_name: true, last_name: true } },
          created_by:  { select: { id: true, first_name: true, last_name: true } },
          company:     { select: { id: true, name: true } },
          _count: { select: { contacts: true, communications: true, photos: true, documents: true } },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.site.count({ where }),
      buildStats(),
    ]);

    res.json({ items, total, page, per_page: perPage, stats });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sites/:id ─────────────────────────────────────────────────────
// Vrací detail se všemi relacemi (kontakty, komunikace, fotky, dokumenty).
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const site = await prisma.site.findUnique({
      where: { id },
      include: {
        assigned_to: { select: { id: true, first_name: true, last_name: true } },
        created_by:  { select: { id: true, first_name: true, last_name: true } },
        company:     { select: { id: true, name: true, ico: true } },
        contacts: { orderBy: [{ is_primary: 'desc' }, { id: 'asc' }] },
        communications: {
          orderBy: { occurred_at: 'desc' },
          include: { author: { select: { id: true, first_name: true, last_name: true } } },
        },
        photos: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
        documents: { orderBy: { created_at: 'desc' } },
      },
    });
    if (!site) return res.status(404).json({ error: 'Lokalita nenalezena' });
    res.json(site);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sites ────────────────────────────────────────────────────────
const siteCreateSchema = z.object({
  name: z.string().min(1, 'Název je povinný').max(255),
  site_type: z.enum(SITE_TYPES).optional(),
  status: z.enum(SITE_STATUSES).optional(),
  description: z.string().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  zip: z.string().max(10).optional().nullable(),
  country: z.string().max(60).optional().nullable(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  map_link: z.string().optional().nullable(),
  owner_name: z.string().max(255).optional().nullable(),
  owner_phone: z.string().max(40).optional().nullable(),
  owner_email: z.string().max(255).optional().nullable(),
  owner_note: z.string().optional().nullable(),
  company_id: z.number().int().nullable().optional(),
  rent_monthly: z.union([z.number(), z.string()]).nullable().optional(),
  rent_currency: z.string().max(3).optional().nullable(),
  deposit: z.union([z.number(), z.string()]).nullable().optional(),
  energy_deposit: z.union([z.number(), z.string()]).nullable().optional(),
  energy_monthly: z.union([z.number(), z.string()]).nullable().optional(),
  other_costs_monthly: z.union([z.number(), z.string()]).nullable().optional(),
  purchase_price: z.union([z.number(), z.string()]).nullable().optional(),
  contract_terms: z.string().optional().nullable(),
  contract_start: z.string().optional().nullable(),
  contract_end: z.string().optional().nullable(),
  area_m2: z.union([z.number(), z.string()]).nullable().optional(),
  ceiling_height_m: z.union([z.number(), z.string()]).nullable().optional(),
  electricity_kw: z.union([z.number(), z.string()]).nullable().optional(),
  water_supply: z.boolean().nullable().optional(),
  sewage: z.boolean().nullable().optional(),
  parking: z.boolean().nullable().optional(),
  capacity_note: z.string().optional().nullable(),
  cadastral_area: z.string().max(255).optional().nullable(),
  cadastral_parcel: z.string().max(120).optional().nullable(),
  cadastral_lv: z.string().max(40).optional().nullable(),
  cadastral_link: z.string().optional().nullable(),
  score: z.number().int().min(0).max(100).nullable().optional(),
  pros: z.string().optional().nullable(),
  cons: z.string().optional().nullable(),
  assigned_to_id: z.number().int().nullable().optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = siteCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });
    const d = parsed.data;

    const site = await prisma.site.create({
      data: {
        name: d.name,
        site_type: d.site_type || 'rent',
        status: d.status || 'lead',
        description: d.description ?? null,
        address: d.address ?? null,
        city: d.city ?? null,
        zip: d.zip ?? null,
        country: d.country ?? 'CZ',
        latitude: d.latitude ?? null,
        longitude: d.longitude ?? null,
        map_link: d.map_link ?? null,
        owner_name: d.owner_name ?? null,
        owner_phone: d.owner_phone ?? null,
        owner_email: d.owner_email ?? null,
        owner_note: d.owner_note ?? null,
        company_id: d.company_id ?? null,
        rent_monthly: toDecimal(d.rent_monthly),
        rent_currency: d.rent_currency ?? 'CZK',
        deposit: toDecimal(d.deposit),
        energy_deposit: toDecimal(d.energy_deposit),
        energy_monthly: toDecimal(d.energy_monthly),
        other_costs_monthly: toDecimal(d.other_costs_monthly),
        purchase_price: toDecimal(d.purchase_price),
        contract_terms: d.contract_terms ?? null,
        contract_start: d.contract_start ? new Date(d.contract_start) : null,
        contract_end: d.contract_end ? new Date(d.contract_end) : null,
        area_m2: toDecimal(d.area_m2),
        ceiling_height_m: toDecimal(d.ceiling_height_m),
        electricity_kw: toDecimal(d.electricity_kw),
        water_supply: d.water_supply ?? null,
        sewage: d.sewage ?? null,
        parking: d.parking ?? null,
        capacity_note: d.capacity_note ?? null,
        cadastral_area: d.cadastral_area ?? null,
        cadastral_parcel: d.cadastral_parcel ?? null,
        cadastral_lv: d.cadastral_lv ?? null,
        cadastral_link: d.cadastral_link ?? null,
        score: d.score ?? null,
        pros: d.pros ?? null,
        cons: d.cons ?? null,
        assigned_to_id: d.assigned_to_id ?? null,
        created_by_id: actorPersonId(req),
      },
    });

    res.status(201).json(site);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/sites/:id ─────────────────────────────────────────────────────
const siteUpdateSchema = siteCreateSchema.partial().extend({
  rejection_reason: z.string().optional().nullable(),
  pradlomat_ref: z.string().max(255).optional().nullable(),
});

router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = siteUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });
    const d = parsed.data;

    // Sestav update objekt jen z polí, která dorazila (partial update).
    const upd = {};
    const passthrough = [
      'name','site_type','status','description','address','city','zip','country',
      'map_link','owner_name','owner_phone','owner_email','owner_note',
      'rent_currency','contract_terms','capacity_note','cadastral_area',
      'cadastral_parcel','cadastral_lv','cadastral_link','pros','cons',
      'rejection_reason','pradlomat_ref',
    ];
    for (const k of passthrough) if (k in d) upd[k] = d[k] ?? null;

    const decimals = [
      'rent_monthly','deposit','energy_deposit','energy_monthly',
      'other_costs_monthly','purchase_price','area_m2','ceiling_height_m','electricity_kw',
    ];
    for (const k of decimals) if (k in d) upd[k] = toDecimal(d[k]);

    if ('latitude'  in d) upd.latitude  = d.latitude  ?? null;
    if ('longitude' in d) upd.longitude = d.longitude ?? null;
    if ('water_supply' in d) upd.water_supply = d.water_supply ?? null;
    if ('sewage'       in d) upd.sewage       = d.sewage       ?? null;
    if ('parking'      in d) upd.parking      = d.parking      ?? null;
    if ('score'        in d) upd.score        = d.score        ?? null;
    if ('company_id'      in d) upd.company_id      = d.company_id      ?? null;
    if ('assigned_to_id'  in d) upd.assigned_to_id  = d.assigned_to_id  ?? null;

    if ('contract_start' in d) upd.contract_start = d.contract_start ? new Date(d.contract_start) : null;
    if ('contract_end'   in d) upd.contract_end   = d.contract_end   ? new Date(d.contract_end)   : null;

    const site = await prisma.site.update({ where: { id }, data: upd });
    res.json(site);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lokalita nenalezena' });
    next(err);
  }
});

// ─── DELETE /api/sites/:id ──────────────────────────────────────────────────
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.site.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lokalita nenalezena' });
    next(err);
  }
});

// ─── POST /api/sites/import — hromadné založení ─────────────────────────────
// Vstup: { items: [{ name, address?, city?, site_type?, owner_name?, owner_phone?, owner_email?, rent_monthly?, note? }, ...] }
// Pro rychlé vložení seznamu (CSV/Excel parsing dělá frontend, server přebírá hotové objekty).
router.post('/import', async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Chybí items[]' });
    if (items.length > 500) return res.status(400).json({ error: 'Najednou max. 500 lokalit' });

    const actor = actorPersonId(req);
    const created = await prisma.$transaction(items.map(it => prisma.site.create({
      data: {
        name: String(it.name || 'Bez názvu').slice(0, 255),
        site_type: SITE_TYPES.includes(it.site_type) ? it.site_type : 'rent',
        status: 'lead',
        address: it.address ? String(it.address).slice(0, 500) : null,
        city: it.city ? String(it.city).slice(0, 120) : null,
        zip: it.zip ? String(it.zip).slice(0, 10) : null,
        owner_name: it.owner_name ? String(it.owner_name).slice(0, 255) : null,
        owner_phone: it.owner_phone ? String(it.owner_phone).slice(0, 40) : null,
        owner_email: it.owner_email ? String(it.owner_email).slice(0, 255) : null,
        rent_monthly: toDecimal(it.rent_monthly),
        description: it.note ? String(it.note) : null,
        created_by_id: actor,
      },
    })));

    res.status(201).json({ created: created.length, items: created });
  } catch (err) {
    next(err);
  }
});

// ─── KONTAKTY ───────────────────────────────────────────────────────────────

router.post('/:id(\\d+)/contacts', async (req, res, next) => {
  try {
    const siteId = parseInt(req.params.id, 10);
    const schema = z.object({
      name: z.string().min(1).max(255),
      role: z.string().max(120).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      email: z.string().max(255).optional().nullable(),
      company: z.string().max(255).optional().nullable(),
      note: z.string().optional().nullable(),
      is_primary: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });

    // Pokud je nový kontakt primární, zbylé na lokalitě hodíme na false.
    if (parsed.data.is_primary) {
      await prisma.siteContact.updateMany({ where: { site_id: siteId, is_primary: true }, data: { is_primary: false } });
    }

    const c = await prisma.siteContact.create({ data: { ...parsed.data, site_id: siteId } });
    res.status(201).json(c);
  } catch (err) {
    next(err);
  }
});

router.put('/contacts/:cid(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.cid, 10);
    const schema = z.object({
      name: z.string().min(1).max(255).optional(),
      role: z.string().max(120).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      email: z.string().max(255).optional().nullable(),
      company: z.string().max(255).optional().nullable(),
      note: z.string().optional().nullable(),
      is_primary: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });

    if (parsed.data.is_primary) {
      const existing = await prisma.siteContact.findUnique({ where: { id } });
      if (existing) {
        await prisma.siteContact.updateMany({
          where: { site_id: existing.site_id, is_primary: true, NOT: { id } },
          data: { is_primary: false },
        });
      }
    }

    const c = await prisma.siteContact.update({ where: { id }, data: parsed.data });
    res.json(c);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Kontakt nenalezen' });
    next(err);
  }
});

router.delete('/contacts/:cid(\\d+)', async (req, res, next) => {
  try {
    await prisma.siteContact.delete({ where: { id: parseInt(req.params.cid, 10) } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Kontakt nenalezen' });
    next(err);
  }
});

// ─── KOMUNIKACE ─────────────────────────────────────────────────────────────

router.post('/:id(\\d+)/communications', async (req, res, next) => {
  try {
    const siteId = parseInt(req.params.id, 10);
    const schema = z.object({
      channel: z.enum(COMM_CHANNELS).optional(),
      subject: z.string().max(500).optional().nullable(),
      body: z.string().min(1, 'Tělo komunikace je povinné'),
      occurred_at: z.string().optional().nullable(),
      followup_at: z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });

    const c = await prisma.siteCommunication.create({
      data: {
        site_id: siteId,
        channel: parsed.data.channel || 'note',
        subject: parsed.data.subject ?? null,
        body: parsed.data.body,
        occurred_at: parsed.data.occurred_at ? new Date(parsed.data.occurred_at) : new Date(),
        followup_at: parsed.data.followup_at ? new Date(parsed.data.followup_at) : null,
        author_id: actorPersonId(req),
      },
      include: { author: { select: { id: true, first_name: true, last_name: true } } },
    });

    // Aktualizace updated_at na rodičovské lokalitě (touch).
    await prisma.site.update({ where: { id: siteId }, data: { updated_at: new Date() } }).catch(() => {});

    res.status(201).json(c);
  } catch (err) {
    next(err);
  }
});

router.put('/communications/:cid(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.cid, 10);
    const schema = z.object({
      channel: z.enum(COMM_CHANNELS).optional(),
      subject: z.string().max(500).optional().nullable(),
      body: z.string().min(1).optional(),
      occurred_at: z.string().optional().nullable(),
      followup_at: z.string().optional().nullable(),
      followup_done: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });

    const data = { ...parsed.data };
    if (data.occurred_at) data.occurred_at = new Date(data.occurred_at);
    if ('followup_at' in data) data.followup_at = data.followup_at ? new Date(data.followup_at) : null;

    const c = await prisma.siteCommunication.update({ where: { id }, data });
    res.json(c);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Komunikace nenalezena' });
    next(err);
  }
});

router.delete('/communications/:cid(\\d+)', async (req, res, next) => {
  try {
    await prisma.siteCommunication.delete({ where: { id: parseInt(req.params.cid, 10) } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Komunikace nenalezena' });
    next(err);
  }
});

// ─── FOTOGRAFIE — multipart není připojený, takže přijímáme base64 z frontendu
// (stejný pattern jako Vehicle servisní fotky a SitePhoto u prodejen).
// Pro jednu fotku použij { data_url, caption?, sort_order? }. data_url je
// data:image/...;base64,XXXX (frontend musí komprimovat/scale-down).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:id(\\d+)/photos', async (req, res, next) => {
  try {
    const siteId = parseInt(req.params.id, 10);
    const schema = z.object({
      data_url: z.string().min(10),
      caption: z.string().max(500).optional().nullable(),
      sort_order: z.number().int().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });

    const m = /^data:([^;]+);base64,(.+)$/.exec(parsed.data.data_url);
    if (!m) return res.status(400).json({ error: 'Očekávám data URL (data:image/...;base64,...)' });
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Fotka je větší než 8 MB' });

    const ext = mime.split('/')[1] || 'jpg';
    const filename = `site-${siteId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(PHOTOS_DIR, filename);
    fs.writeFileSync(filePath, buf);

    const photo = await prisma.sitePhoto.create({
      data: {
        site_id: siteId,
        file_path: `site-photos/${filename}`,
        url: `/api/sites/photos/${filename}`,
        caption: parsed.data.caption ?? null,
        mime_type: mime,
        size_bytes: buf.length,
        sort_order: parsed.data.sort_order ?? 0,
      },
    });
    res.status(201).json(photo);
  } catch (err) {
    next(err);
  }
});

// Servírování fotky podle filename. Bez auth pro UI — soubor je veřejně
// nedohádatelný (timestamp+random) a zabraňuje nutnosti Bearer tokenu v <img>.
// Pokud bude potřeba, lze obalit do requireAuth nebo signed URL.
router.get('/photos/:filename', (req, res, next) => {
  try {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!filename) return res.status(400).end();
    const filePath = path.join(PHOTOS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

router.delete('/photos/:pid(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.pid, 10);
    const photo = await prisma.sitePhoto.findUnique({ where: { id } });
    if (!photo) return res.status(404).json({ error: 'Fotka nenalezena' });
    // Smazat soubor (best-effort).
    try {
      const full = path.join(DATA_ROOT, photo.file_path);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch (e) { /* ignore */ }
    await prisma.sitePhoto.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── DOKUMENTY (zatím jen metadata + external_url) ──────────────────────────
// Pro nahrávání PDF/docx použijeme stejný base64 pattern jako fotky — později
// (zatím postačí external_url na SharePoint).

router.post('/:id(\\d+)/documents', async (req, res, next) => {
  try {
    const siteId = parseInt(req.params.id, 10);
    const schema = z.object({
      doc_type: z.enum(DOC_TYPES).optional(),
      title: z.string().min(1).max(500),
      external_url: z.string().optional().nullable(),
      note: z.string().optional().nullable(),
      signed_at: z.string().optional().nullable(),
      valid_from: z.string().optional().nullable(),
      valid_to: z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });

    const doc = await prisma.siteDocument.create({
      data: {
        site_id: siteId,
        doc_type: parsed.data.doc_type || 'other',
        title: parsed.data.title,
        external_url: parsed.data.external_url ?? null,
        note: parsed.data.note ?? null,
        signed_at: parsed.data.signed_at ? new Date(parsed.data.signed_at) : null,
        valid_from: parsed.data.valid_from ? new Date(parsed.data.valid_from) : null,
        valid_to: parsed.data.valid_to ? new Date(parsed.data.valid_to) : null,
      },
    });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

router.delete('/documents/:did(\\d+)', async (req, res, next) => {
  try {
    await prisma.siteDocument.delete({ where: { id: parseInt(req.params.did, 10) } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dokument nenalezen' });
    next(err);
  }
});

// ─── Pomocné: seznam možných hodnot pro UI ──────────────────────────────────
router.get('/meta/enums', (req, res) => {
  res.json({
    site_types: SITE_TYPES,
    statuses: SITE_STATUSES,
    comm_channels: COMM_CHANNELS,
    doc_types: DOC_TYPES,
  });
});

module.exports = router;
