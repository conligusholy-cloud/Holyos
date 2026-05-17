// =============================================================================
// HolyOS — Servis (interní admin) routes
// CRUD pro znalostní bázi: kategorie, spotřebiče, články, partneři, chat audit.
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── Pomocné funkce ────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diakritika
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || ('a-' + Date.now());
}

// Markdown → plain text pro fulltext search (jednoduchá heuristika; jen pro lookup,
// ne pro rendering). Odstraní # ## ## headers, **bold**, *italic*, [text](link), `code`.
function stripMarkdown(md) {
  if (!md) return '';
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── KATEGORIE ─────────────────────────────────────────────────────────────

// GET /api/service/categories
router.get('/categories', async (req, res, next) => {
  try {
    const items = await prisma.serviceCategory.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });
    res.json(items);
  } catch (err) { next(err); }
});

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  sort_order: z.number().int().optional(),
  description: z.string().optional().nullable(),
});

router.post('/categories', async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const data = parsed.data;
    const cat = await prisma.serviceCategory.create({
      data: { ...data, slug: slugify(data.name) },
    });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Kategorie s tímto jménem už existuje' });
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
    const cat = await prisma.serviceCategory.update({ where: { id }, data });
    res.json(cat);
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceCategory.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── SPOTŘEBIČE (ServiceAppliance) ─────────────────────────────────────────

// GET /api/service/appliances?product_id=...&q=...
router.get('/appliances', async (req, res, next) => {
  try {
    const productId = req.query.product_id ? parseInt(req.query.product_id, 10) : null;
    const q = (req.query.q || '').toString().trim();

    const where = {};
    if (productId) {
      where.product_links = { some: { product_id: productId } };
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { manufacturer: { contains: q, mode: 'insensitive' } },
        { model_code: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.serviceAppliance.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        product_links: { select: { product_id: true, position: true, quantity: true } },
        _count: { select: { articles: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/appliances/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = await prisma.serviceAppliance.findUnique({
      where: { id },
      include: {
        product_links: true,
        articles: {
          include: { article: { select: { id: true, title: true, kind: true, status: true } } },
        },
      },
    });
    if (!item) return res.status(404).json({ error: 'Spotřebič nenalezen' });
    res.json(item);
  } catch (err) { next(err); }
});

const applianceSchema = z.object({
  name: z.string().min(1).max(255),
  manufacturer: z.string().max(255).optional().nullable(),
  model_code: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
  manual_url: z.string().max(500).optional().nullable(),
  photo_url: z.string().max(500).optional().nullable(),
  material_id: z.number().int().optional().nullable(),
  // Volitelně rovnou linkneme na produkty: [{ product_id, position?, quantity? }]
  product_links: z.array(z.object({
    product_id: z.number().int(),
    position: z.string().max(255).optional().nullable(),
    quantity: z.number().int().optional(),
  })).optional(),
});

router.post('/appliances', async (req, res, next) => {
  try {
    const parsed = applianceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { product_links, ...data } = parsed.data;

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.serviceAppliance.create({ data });
      if (product_links && product_links.length) {
        await tx.serviceProductAppliance.createMany({
          data: product_links.map(pl => ({
            appliance_id: a.id,
            product_id: pl.product_id,
            position: pl.position || null,
            quantity: pl.quantity || 1,
          })),
          skipDuplicates: true,
        });
      }
      return a;
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.put('/appliances/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = applianceSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const { product_links, ...data } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.serviceAppliance.update({ where: { id }, data });
      if (Array.isArray(product_links)) {
        // Replace links
        await tx.serviceProductAppliance.deleteMany({ where: { appliance_id: id } });
        if (product_links.length) {
          await tx.serviceProductAppliance.createMany({
            data: product_links.map(pl => ({
              appliance_id: id,
              product_id: pl.product_id,
              position: pl.position || null,
              quantity: pl.quantity || 1,
            })),
            skipDuplicates: true,
          });
        }
      }
      return a;
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/appliances/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceAppliance.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── ČLÁNKY (ServiceArticle) ───────────────────────────────────────────────

// GET /api/service/articles?q=...&kind=...&status=...&category_id=...&product_id=...&appliance_id=...
router.get('/articles', async (req, res, next) => {
  try {
    const { q, kind, status, visibility, category_id, product_id, appliance_id, tag } = req.query;
    const where = {};
    if (kind) where.kind = String(kind);
    if (status) where.status = String(status);
    if (visibility) where.visibility = String(visibility);
    if (category_id) where.category_id = parseInt(category_id, 10);
    if (product_id) where.products = { some: { product_id: parseInt(product_id, 10) } };
    if (appliance_id) where.appliances = { some: { appliance_id: parseInt(appliance_id, 10) } };
    if (q) {
      const qs = String(q).trim();
      where.OR = [
        { title: { contains: qs, mode: 'insensitive' } },
        { summary: { contains: qs, mode: 'insensitive' } },
        { body_search: { contains: qs, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.serviceArticle.findMany({
      where,
      orderBy: [{ updated_at: 'desc' }],
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        products: { select: { product_id: true } },
        appliances: { select: { appliance_id: true } },
        _count: { select: { attachments: true } },
      },
      take: 200,
    });
    // tag filter (post-filter, tags je Json array)
    const filtered = tag ? items.filter(a => Array.isArray(a.tags) && a.tags.includes(String(tag))) : items;
    res.json(filtered);
  } catch (err) { next(err); }
});

router.get('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = await prisma.serviceArticle.findUnique({
      where: { id },
      include: {
        category: true,
        products: true,
        appliances: { include: { appliance: { select: { id: true, name: true, manufacturer: true, model_code: true } } } },
        attachments: { orderBy: { sort_order: 'asc' } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Článek nenalezen' });
    res.json(item);
  } catch (err) { next(err); }
});

const articleSchema = z.object({
  title: z.string().min(1).max(500),
  kind: z.enum(['GUIDE', 'CASE', 'CHECKLIST', 'FAQ']).optional(),
  summary: z.string().max(1000).optional().nullable(),
  body_md: z.string().min(1),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['internal', 'partner']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  category_id: z.number().int().optional().nullable(),
  author_person_id: z.number().int().optional().nullable(),
  product_ids: z.array(z.number().int()).optional(),
  appliance_ids: z.array(z.number().int()).optional(),
});

router.post('/articles', async (req, res, next) => {
  try {
    const parsed = articleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { product_ids, appliance_ids, ...data } = parsed.data;

    const slug = slugify(data.title) + '-' + Date.now().toString(36);
    const body_search = stripMarkdown(data.body_md);
    const author_person_id = data.author_person_id || (req.user && req.user.person && req.user.person.id) || null;

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.serviceArticle.create({
        data: {
          ...data,
          slug,
          body_search,
          author_person_id,
          tags: data.tags || [],
          published_at: data.status === 'published' ? new Date() : null,
        },
      });
      if (product_ids && product_ids.length) {
        await tx.serviceArticleProduct.createMany({
          data: product_ids.map(pid => ({ article_id: a.id, product_id: pid })),
          skipDuplicates: true,
        });
      }
      if (appliance_ids && appliance_ids.length) {
        await tx.serviceArticleAppliance.createMany({
          data: appliance_ids.map(aid => ({ article_id: a.id, appliance_id: aid })),
          skipDuplicates: true,
        });
      }
      return a;
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.put('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = articleSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { product_ids, appliance_ids, ...data } = parsed.data;

    if (data.body_md) data.body_search = stripMarkdown(data.body_md);
    if (data.title) data.slug = slugify(data.title) + '-' + id.toString(36);

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.serviceArticle.findUnique({ where: { id }, select: { status: true, published_at: true } });
      if (!current) throw Object.assign(new Error('Článek nenalezen'), { status: 404 });

      const updateData = { ...data };
      // Auto-set published_at při prvním přechodu na published
      if (data.status === 'published' && current.status !== 'published') {
        updateData.published_at = new Date();
      }

      const a = await tx.serviceArticle.update({ where: { id }, data: updateData });
      if (Array.isArray(product_ids)) {
        await tx.serviceArticleProduct.deleteMany({ where: { article_id: id } });
        if (product_ids.length) {
          await tx.serviceArticleProduct.createMany({
            data: product_ids.map(pid => ({ article_id: id, product_id: pid })),
            skipDuplicates: true,
          });
        }
      }
      if (Array.isArray(appliance_ids)) {
        await tx.serviceArticleAppliance.deleteMany({ where: { article_id: id } });
        if (appliance_ids.length) {
          await tx.serviceArticleAppliance.createMany({
            data: appliance_ids.map(aid => ({ article_id: id, appliance_id: aid })),
            skipDuplicates: true,
          });
        }
      }
      return a;
    });
    res.json(updated);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.delete('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceArticle.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Přílohy (zjednodušená verze — URL referencí, file upload jde přes /api/storage/upload)
const attachmentSchema = z.object({
  title: z.string().min(1).max(255),
  url: z.string().max(500).optional().nullable(),
  file_path: z.string().max(500).optional().nullable(),
  mime_type: z.string().max(80).optional().nullable(),
  size_bytes: z.number().int().optional().nullable(),
  sort_order: z.number().int().optional(),
});

router.post('/articles/:id/attachments', async (req, res, next) => {
  try {
    const article_id = parseInt(req.params.id, 10);
    const parsed = attachmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const att = await prisma.serviceArticleAttachment.create({
      data: { ...parsed.data, article_id },
    });
    res.status(201).json(att);
  } catch (err) { next(err); }
});

router.delete('/articles/:articleId/attachments/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceArticleAttachment.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PARTNEŘI (PartnerAccount) ────────────────────────────────────────────

// GET /api/service/partners
router.get('/partners', async (req, res, next) => {
  try {
    const items = await prisma.partnerAccount.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        products: { select: { product_id: true, serial_no: true } },
        _count: { select: { chat_sessions: true } },
      },
    });
    res.json(items.map(p => {
      const { password_hash, ...safe } = p;
      return safe;
    }));
  } catch (err) { next(err); }
});

const partnerSchema = z.object({
  username: z.string().min(3).max(100),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  display_name: z.string().min(1).max(255),
  password: z.string().min(6).optional(), // jen při create
  company_id: z.number().int().optional().nullable(),
  contact_person_id: z.number().int().optional().nullable(),
  language: z.string().max(5).optional(),
  active: z.boolean().optional(),
  product_ids: z.array(z.number().int()).optional(),
});

router.post('/partners', async (req, res, next) => {
  try {
    const parsed = partnerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { password, product_ids, ...data } = parsed.data;
    if (!password) return res.status(400).json({ error: 'Heslo je povinné při založení účtu' });

    const password_hash = await bcrypt.hash(password, 12);

    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.partnerAccount.create({ data: { ...data, password_hash } });
      if (product_ids && product_ids.length) {
        await tx.partnerProductAccess.createMany({
          data: product_ids.map(pid => ({ partner_id: p.id, product_id: pid })),
          skipDuplicates: true,
        });
      }
      return p;
    });
    const { password_hash: _, ...safe } = created;
    res.status(201).json(safe);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username už existuje' });
    next(err);
  }
});

router.put('/partners/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = partnerSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const { password, product_ids, ...data } = parsed.data;

    if (password) data.password_hash = await bcrypt.hash(password, 12);

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.partnerAccount.update({ where: { id }, data });
      if (Array.isArray(product_ids)) {
        await tx.partnerProductAccess.deleteMany({ where: { partner_id: id } });
        if (product_ids.length) {
          await tx.partnerProductAccess.createMany({
            data: product_ids.map(pid => ({ partner_id: id, product_id: pid })),
            skipDuplicates: true,
          });
        }
      }
      return p;
    });
    const { password_hash, ...safe } = updated;
    res.json(safe);
  } catch (err) { next(err); }
});

router.delete('/partners/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.partnerAccount.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── CHAT AUDIT — read-only přehled konverzací s Hugem ────────────────────

// GET /api/service/chat-sessions?partner_id=...&needs_attention=true
router.get('/chat-sessions', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partner_id) where.partner_id = parseInt(req.query.partner_id, 10);
    if (req.query.needs_attention === 'true') where.needs_attention = true;
    if (req.query.status) where.status = String(req.query.status);

    const items = await prisma.serviceChatSession.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: 200,
      include: {
        partner: { select: { id: true, username: true, display_name: true, company: { select: { name: true } } } },
        _count: { select: { messages: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/chat-sessions/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const session = await prisma.serviceChatSession.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, username: true, display_name: true, company: { select: { name: true } } } },
        messages: {
          orderBy: { created_at: 'asc' },
          include: { citations: { include: { article: { select: { id: true, title: true, slug: true } } } } },
        },
      },
    });
    if (!session) return res.status(404).json({ error: 'Session nenalezena' });
    res.json(session);
  } catch (err) { next(err); }
});

module.exports = router;
